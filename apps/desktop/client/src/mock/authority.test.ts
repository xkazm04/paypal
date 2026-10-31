// T11 mock parity: the browser mock gates every command from the Rust authority table
// (bindings/authority.ts), and answers the same label x lock x token x selected-deal matrix the
// runtime's conformance test checks (crates/table-runtime/src/authority_tests.rs).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTHORITY, AUTHORITY_MANIFEST, EVENT_AUDIENCE, type CommandAuthority } from '@bindings/authority';
import { AGREED_OR_LATER, PRE_CAPTURE, TERMINAL, THROUGH_AGREED, WITHDRAWABLE } from '@bindings/dealStates';
import type { CommandName, EventName, WindowLabel } from '../lib/contract';
import { WalletError } from '../lib/contract';
import { GateError, mockBackend, resetMockState } from './backend';
import { buildMockState } from './fixtures';

type Outcome = 'PERMISSION' | 'LOCKED' | 'admitted';
type Token = 'none' | 'wrong' | 'valid';
const LABELS: WindowLabel[] = ['main', 'tumbler', 'approval'];

/** What the table says one cell must answer (the same rule as the Rust conformance test). */
function expected(a: CommandAuthority, label: WindowLabel, token: Token, locked: boolean, onSelected: boolean): Outcome {
  if (!a.labels.includes(label) || (a.token && token !== 'valid')) return 'PERMISSION';
  if (a.unlock && locked) return 'LOCKED';
  const bound = a.selection === 'required' || (a.selection === 'in_approval' && label === 'approval');
  return bound && !onSelected ? 'PERMISSION' : 'admitted';
}

const COMMANDS = Object.keys(AUTHORITY) as CommandName[];

describe('authority table (browser mock)', () => {
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear(); resetMockState();
    // approval_open asks the browser for a window; jsdom has none.
    vi.spyOn(window, 'open').mockReturnValue(null);
  });

  it('gates every command exactly as the authority table says, for every label, lock and token', async () => {
    const deals = buildMockState(Math.floor(Date.now() / 1000)).deals;
    const selected = deals[0]!.deal.id;
    const other = deals[1]!.deal.id;
    const mismatches: string[] = [];
    let cells = 0;
    const windowFor = (label: WindowLabel, locked: boolean) => {
      const page = label === 'approval' ? `/approval.html?deal=${selected}` : `/${label === 'main' ? 'index' : label}.html?x=1`;
      history.replaceState(null, '', `${page}${locked ? '&locked=1' : ''}`);
      // The gate is judged, not the file picker: a command that waits on the person's file gets a cancelled pick.
      return mockBackend(label, { pick: async () => null, save: () => undefined });
    };
    // Built as each window would be (URL params at load). Main and the Tumbler hold no selection,
    // so they serve every command; an approval window is rebuilt per command (a replayed renewal
    // rebinds it to a new deal).
    const backends = new Map<string, ReturnType<typeof mockBackend>>();
    for (const locked of [true, false]) for (const label of ['main', 'tumbler'] as WindowLabel[]) backends.set(`${label}/${locked}`, windowFor(label, locked));
    for (const cmd of COMMANDS) {
      const a: CommandAuthority = AUTHORITY[cmd];
      for (const locked of [true, false]) backends.set(`approval/${locked}`, windowFor('approval', locked));
      const token = await backends.get('approval/false')!.invoke('approval_token', null);
      const runs: Promise<void>[] = [];
      for (const locked of [true, false]) {
        for (const label of LABELS) {
          for (const t of ['none', 'wrong', 'valid'] as Token[]) {
            const bound = a.selection === 'required' || (a.selection === 'in_approval' && label === 'approval');
            for (const onSelected of bound ? [true, false] : [true]) {
              const b = backends.get(`${label}/${locked}`)!;
              const opts = t === 'none' ? undefined : { token: t === 'valid' ? token : 'not-the-token' };
              const args = { deal_id: onSelected ? selected : other } as never;
              const want = expected(a, label, t, locked, onSelected);
              cells += 1;
              runs.push(b.invoke(cmd, args, opts).then(
                () => 'admitted' as Outcome,
                (e: unknown) => (e instanceof GateError ? (e.code as Outcome) : 'admitted'),
              ).then((got) => {
                if (got !== want) mismatches.push(`${cmd} from ${label} (${t} token, ${locked ? 'locked' : 'unlocked'}, ${onSelected ? 'selected' : 'another'} deal): got ${got}, table says ${want}`);
              }));
            }
          }
        }
      }
      await Promise.all(runs);
    }
    expect(mismatches).toEqual([]);
    expect(cells).toBeGreaterThan(1000);
  }, 60_000);

  it('a refusal by a handler after the gate is never a gate refusal in disguise', async () => {
    // GateError is a WalletError, so the UI renders both the same way.
    history.replaceState(null, '', '/index.html');
    const main = mockBackend('main');
    const e = await main.invoke('deal_capture', { deal_id: 'x' } as never).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(GateError);
    expect(e).toBeInstanceOf(WalletError);
    expect((e as WalletError).code).toBe('PERMISSION');
  });

  it('keeps the release set approval-only and reports the table fingerprint in settings', async () => {
    for (const cmd of COMMANDS) {
      const a: CommandAuthority = AUTHORITY[cmd];
      if (a.release || a.token || a.unlock) expect(a.labels, cmd).toEqual(['approval']);
      if (a.tier === 'decision') expect([a.token, a.unlock, a.selection], cmd).toEqual([true, true, 'required']);
    }
    for (const cmd of ['counterparty_note', 'counterparty_list', 'deal_transcript'] as CommandName[]) {
      expect(AUTHORITY[cmd].labels, cmd).not.toContain('tumbler');
    }
    expect(AUTHORITY_MANIFEST).toMatch(/^[0-9a-f]{64}$/);
    history.replaceState(null, '', '/tumbler.html');
    const s = await mockBackend('tumbler').invoke('get_settings', null);
    expect(s.authority_manifest).toBe(AUTHORITY_MANIFEST);
  });

  it('refuses every owner decision as Rust decide() does: stale terms or attempt, a MISMATCH, a BLOCK (void included)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    try {
      const id = buildMockState(Math.floor(Date.now() / 1000)).deals.find((d) => d.display.label === 'D-0190')!.deal.id;
      history.replaceState(null, '', `/approval.html?deal=${id}`);
      const a = mockBackend('approval');
      const call = async <T,>(p: Promise<T>): Promise<T | WalletError> => {
        const r = p.then((v) => v, (e: unknown) => e as WalletError);
        await vi.advanceTimersByTimeAsync(50);
        return r;
      };
      const token = await call(a.invoke('approval_token', null)) as string;
      const s = await call(a.invoke('approval_summary', { deal_id: id }));
      if (s instanceof WalletError) throw s;
      const args = { deal_id: id, attempt: s.attempt, terms_hash: s.terms_hash, checks_hash: s.checks_hash };
      // A void on another terms hash or attempt is stale, as in Rust.
      expect(await call(a.invoke('deal_void', { ...args, terms_hash: s.checks_hash }, { token }))).toMatchObject({ code: 'INVALID' });
      expect(await call(a.invoke('deal_void', { ...args, attempt: 2 }, { token }))).toMatchObject({ code: 'INVALID' });
      // Under a BLOCK no decision is taken, not even the void.
      a.world.deal('D-0190')!.deal.shield = 'BLOCK';
      for (const cmd of ['deal_void', 'deal_capture', 'deal_countersign', 'shield_release', 'rescue_approve', 'open_paypal_in_browser'] as const) {
        expect(await call(a.invoke(cmd, args, { token })), cmd).toMatchObject({ code: 'INVALID' });
      }
      expect(a.world.deal('D-0190')!.deal.state).toBe('AUTHORIZED');
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers can_release as Rust summary() does on every state, kind, side and mode', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    try {
      const id = buildMockState(Math.floor(Date.now() / 1000)).deals.find((d) => d.display.label === 'D-0190')!.deal.id;
      history.replaceState(null, '', `/approval.html?deal=${id}`);
      const a = mockBackend('approval');
      const states = [...new Set([...TERMINAL, ...PRE_CAPTURE, ...AGREED_OR_LATER, ...THROUGH_AGREED])];
      expect(states).toHaveLength(21);
      const base = a.world.deal('D-0190')!.deal;
      const wrong: string[] = [];
      for (const state of states) for (const kind of ['purchase', 'haggle', 'shop_order', 'invoice'] as const) for (const side of ['buyer', 'seller'] as const) for (const mode of ['sandbox', 'replay'] as const) {
        a.world.deal('D-0190')!.deal = { ...base, state, kind, side, mode, shield: 'CLEAR' };
        const p = a.invoke('approval_summary', { deal_id: id });
        await vi.advanceTimersByTimeAsync(50);
        const s = await p;
        // service.rs summary(): configured && !locked && supported && !terminal && !MISMATCH && !BLOCK.
        const supported = (side === 'seller' || kind === 'purchase') && kind !== 'invoice' && mode !== 'replay';
        const want = supported && !TERMINAL.has(state) && state !== 'MISMATCH';
        if (s.can_release !== want) wrong.push(`${state}/${kind}/${side}/${mode}: ${s.can_release}`);
      }
      expect(wrong).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('walks away and lets lapse only where Rust does: a withdrawable state, a rescue before its invoice, a gate that offers it', async () => {
    history.replaceState(null, '', '/index.html');
    const main = mockBackend('main');
    const id = (label: string) => main.world.deal(label)!.deal.id;
    const refused = async (cmd: 'deal_withdraw' | 'deal_let_lapse', label: string) =>
      main.invoke(cmd, { deal_id: id(label) }).then(() => 'done', (e: WalletError) => e.code);
    // Rust: transition(state, Withdraw) - a held authorization is voided, never withdrawn; a paid deal has ended.
    for (const label of ['D-0190', 'D-0187', 'D-0176']) {
      const before = main.world.deal(label)!.deal.state;
      expect(WITHDRAWABLE.has(before), label).toBe(false);
      expect(await refused('deal_withdraw', label), label).toBe('INVALID');
      expect(main.world.deal(label)!.deal.state, label).toBe(before);
    }
    // A rescue whose invoice was sent follows PayPal's record (dispatcher.rs Withdraw).
    const sent = buildMockState(Math.floor(Date.now() / 1000)).deals.find((d) => d.deal.kind === 'rescue' && d.deal.state !== 'AGREED' && WITHDRAWABLE.has(d.deal.state))!;
    expect(await refused('deal_withdraw', sent.display.label)).toBe('INVALID');
    // Let lapse: only on a gate card that offers it (D-0199 is a hold, D-0187 has no card).
    expect(await refused('deal_let_lapse', 'D-0199')).toBe('INVALID');
    expect(await refused('deal_let_lapse', 'D-0187')).toBe('INVALID');
    expect(main.world.deal('D-0199')!.attention).not.toBeNull();
    // What Rust allows still works.
    expect(await refused('deal_withdraw', 'D-0193')).toBe('done');
    expect(main.world.deal('D-0193')!.deal.state).toBe('WITHDRAWN');
  });

  it('sends settings:changed only when the snapshot changed, as the actor tick does', async () => {
    const main = mockBackend('main');
    const seen: unknown[] = [];
    await main.listen('settings:changed', (s) => seen.push(s));
    await main.invoke('pause_all_agents', null);
    await main.invoke('pause_all_agents', null);
    expect(seen).toHaveLength(1);
    await main.invoke('resume_all_agents', null);
    await main.invoke('resume_all_agents', null);
    expect(seen).toHaveLength(2);
  });

  it('tells each window what the Rust table says, from the generated audiences', () => {
    // Who hears each event is a row in the Rust authority table; the mock delivers by it.
    const audience: Record<EventName, WindowLabel[]> = EVENT_AUDIENCE;
    expect(audience['settings:changed']).toEqual(['main', 'tumbler', 'approval']);
    expect(audience['approval:summary']).toEqual(['approval']);
    for (const event of ['deal:changed', 'agent:changed', 'pairing:pinned'] as EventName[]) {
      expect(audience[event], event).toEqual(['main']);
    }
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'backend.ts'), 'utf8');
    expect(source).toContain('const TARGETS: Record<EventName, WindowLabel[]> = EVENT_AUDIENCE;');
    // No hand-kept audience list is left beside it.
    expect(source).not.toMatch(/'[a-z]+:[a-z]+': \[/);
  });
});

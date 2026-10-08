// T11 mock parity: the browser mock gates every command from the Rust authority table
// (bindings/authority.ts), and answers the same label x lock x token x selected-deal matrix the
// runtime's conformance test checks (crates/table-runtime/src/authority_tests.rs).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTHORITY, AUTHORITY_MANIFEST, type CommandAuthority } from '@bindings/authority';
import type { CommandName, WindowLabel } from '../lib/contract';
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
      return mockBackend(label);
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
});

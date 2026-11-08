// T5 (approval-window-1): the mock composes the wallet's six-line checklist from its fixtures as
// Rust does, carries its hash in the summary, and refuses a money decision whose hash is missing
// or stale, or taken while a line fails (a release may fail only the shield line).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import { CHECK_FAILED, SUMMARY_CHANGED } from '../lib/words';
import { mockBackend, resetMockState, STORE_KEY } from './backend';
import { buildMockState, fakeUlid } from './fixtures';

const NOW = 1_800_000_000;
function approvalFor(label: string) {
  history.replaceState(null, '', `/approval.html?deal=${fakeUlid(label)}`);
  return mockBackend('approval');
}
const line = (s: ApprovalSummary, id: string) => s.checks.find((c) => c.id === id)!;
const args = (s: ApprovalSummary) => ({ deal_id: s.deal.id, attempt: s.attempt, terms_hash: s.terms_hash, checks_hash: s.checks_hash });

describe('mock approval checklist (parity with the wallet)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW * 1000);
    vi.stubGlobal('BroadcastChannel', undefined);
    localStorage.clear(); sessionStorage.clear(); resetMockState();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('D-0193: six lines in the wallet’s order, none failing, the offer compared with the agreed price', async () => {
    const a = approvalFor('D-0193');
    const s = await a.invoke('approval_summary', { deal_id: fakeUlid('D-0193') });
    expect(s.checks.map((c) => c.id)).toEqual(['amount', 'payee', 'host', 'invoice', 'shield', 'mandate']);
    expect(line(s, 'amount')).toMatchObject({ status: 'pass', text: 'Their latest offer is $329.00, the price you’re approving.' });
    expect(line(s, 'payee').status).toBe('pass');
    expect(line(s, 'host').status).toBe('not_applicable');
    // Maya's $1,000 wallet limit leaves less today than her $900 sourcing rules do (C2).
    expect(line(s, 'mandate')).toMatchObject({ status: 'pass', text: 'Above your ask-me limit of $250.00, so it’s your call. After this, $531.00 of your wallet’s $1,000.00 daily limit is left today.' });
    expect(s.checks.every((c) => c.status !== 'fail')).toBe(true);
    for (const c of s.checks) {
      expect(c.text).not.toMatch(/clause|SETTLE|MISMATCH|paypal\.com/);
      expect(c.detail.length).toBeGreaterThan(0);
    }
  });

  it('D-0199 MISMATCH shows the failing amount line, and D-0198 HOLD fails the shield line', async () => {
    const mismatch = await approvalFor('D-0199').invoke('approval_summary', { deal_id: fakeUlid('D-0199') });
    expect(line(mismatch, 'amount')).toMatchObject({ status: 'fail', text: 'The payment request didn’t match the $329.00 you agreed.' });
    const held = await approvalFor('D-0198').invoke('approval_summary', { deal_id: fakeUlid('D-0198') });
    expect(line(held, 'shield')).toMatchObject({ status: 'fail', text: 'Scam check: paused for you. The price is far above the usual price. Unpause it first.' });
    expect(line(held, 'amount').status).toBe('wait');
    expect(held.checks.filter((c) => c.status === 'fail').map((c) => c.id)).toEqual(['shield']);
  });

  it('a decision without the hash, or with a stale one, is refused and changes nothing', async () => {
    const id = fakeUlid('D-0193');
    const a = approvalFor('D-0193');
    const token = await a.invoke('approval_token', null);
    const s = await a.invoke('approval_summary', { deal_id: id });
    const accept = { ...args(s), counter_hash: s.counter_hash };
    await expect(a.invoke('deal_owner_accept', { ...accept, checks_hash: null }, { token })).rejects.toMatchObject({ code: 'INVALID', message: SUMMARY_CHANGED });
    await expect(a.invoke('deal_owner_accept', { ...accept, checks_hash: s.terms_hash }, { token })).rejects.toMatchObject({ code: 'INVALID', message: SUMMARY_CHANGED });
    expect((await a.invoke('approval_summary', { deal_id: id })).deal.state).toBe('NEGOTIATING');
    expect((await a.invoke('deal_transcript', { deal_id: id })).at(-1)?.typ).toBe('COUNTER');
    const d = await a.invoke('deal_owner_accept', accept, { token });
    expect(d.decided_by).toEqual({ type: 'human', at: NOW });
  });

  it('a failed line refuses the money decision; unpausing may fail only the shield line, then the hash moves on', async () => {
    const id = fakeUlid('D-0198');
    const a = approvalFor('D-0198');
    const token = await a.invoke('approval_token', null);
    const s = await a.invoke('approval_summary', { deal_id: id });
    await expect(a.invoke('deal_countersign', args(s), { token })).rejects.toMatchObject({ code: 'INVALID', message: CHECK_FAILED });
    const released = await a.invoke('shield_release', args(s), { token });
    // As Rust: the release covers these terms and the rule that paused it, as the owner's decision.
    expect(released.shield).toBe('ASK');
    expect(released.shield_rule).toBe('price_over_market');
    expect(released.shield_release).toEqual({ terms_hash: s.terms_hash, rules: ['price_over_market'], at: NOW });
    expect(released.decided_by).toEqual({ type: 'human', at: NOW });
    const after = await a.invoke('approval_summary', { deal_id: id });
    expect(line(after, 'shield')).toMatchObject({ status: 'pass', text: 'Scam check: you let this go on after a pause. The price is far above the usual price. Your decision is the check.' });
    // Released once; nothing is left to release.
    await expect(a.invoke('shield_release', args(after), { token })).rejects.toMatchObject({ code: 'PERMISSION' });
    expect(after.checks_hash).not.toEqual(s.checks_hash);
    // The old hash is now stale: the owner has to read the new checklist first.
    await expect(a.invoke('deal_countersign', args(s), { token })).rejects.toMatchObject({ message: SUMMARY_CHANGED });
    const order = await a.invoke('deal_countersign', args(after), { token });
    expect(order.state).toBe('AWAITING_APPROVAL');
  });

  /** The world with `labels` all agreed `back` seconds ago (their 'agreed' history step and last change), then stored. */
  function agreedAt(labels: string[], back: number, edit?: (w: ReturnType<typeof buildMockState>) => void) {
    const world = buildMockState(NOW);
    for (const l of labels) {
      const d = world.deals.find((x) => x.display.label === l)!;
      d.deal.updated_at = NOW - back;
      world.history = (world.history ?? []).filter((h) => !(h.deal_id === d.deal.id && h.kind === 'agreed'));
      world.history.push({ at: NOW - back, deal_id: d.deal.id, seq: world.history.length + 1, kind: 'agreed', state_after: 'AGREED', authority: { type: 'none' }, paypal: { type: 'none' } } as never);
    }
    edit?.(world);
    localStorage.setItem(STORE_KEY, JSON.stringify(world));
  }
  const mandateLine = async (label: string) => line(await approvalFor(label).invoke('approval_summary', { deal_id: fakeUlid(label) }), 'mandate');

  it('counts toward the daily limit exactly what the ledger’s usage_for counts: agreed or later, released excluded', async () => {
    // D-0193 ($329) under the sourcing rules ($900 a day): with D-0187 ($212) and D-0176 ($455)
    // agreed today beside it. Rust's usage_for counts AGREED_OR_LATER only, so a MISMATCH or a
    // FAILED deal never spends the day's budget.
    agreedAt(['D-0187', 'D-0176'], 600, (w) => { w.deals.find((x) => x.display.label === 'D-0176')!.deal.state = 'FAILED'; });
    expect(await mandateLine('D-0193')).toMatchObject({ status: 'pass' });
    agreedAt(['D-0187', 'D-0176'], 600, (w) => { w.deals.find((x) => x.display.label === 'D-0176')!.deal.state = 'CAPTURED'; });
    expect(await mandateLine('D-0193')).toMatchObject({ status: 'fail', text: 'Outside your rules: the daily limit.' });
  });

  it('counts only the deals agreed on the deal’s agreement day, as usage_for does', async () => {
    // The same two deals, agreed two days ago: they no longer spend today's $900.
    agreedAt(['D-0187', 'D-0176'], 2 * 86400, (w) => { w.deals.find((x) => x.display.label === 'D-0176')!.deal.state = 'CAPTURED'; });
    expect(await mandateLine('D-0193')).toMatchObject({ status: 'pass' });
    const id = fakeUlid('D-0193');
    expect((await approvalFor('D-0193').invoke('approval_summary', { deal_id: id })).can_owner_accept).toBe(true);
  });

  it('the checklist mandate line judges the whole rules as MandatePayload::check does (category, deals a day)', async () => {
    const id = fakeUlid('D-0193');
    expect(await mandateLine('D-0193')).toMatchObject({ status: 'pass' });
    // The table was opened for a category the sourcing rules do not allow (clause 3): the owner
    // accept and the checklist line say the same.
    const world = buildMockState(NOW);
    world.categories = { ...world.categories, [id]: 'compute' };
    localStorage.setItem(STORE_KEY, JSON.stringify(world));
    expect(await mandateLine('D-0193')).toMatchObject({ status: 'fail', text: 'Outside your rules: the limit per deal.' });
    expect((await approvalFor('D-0193').invoke('approval_summary', { deal_id: id })).can_owner_accept).toBe(false);
    // The day's deals under the rules are used up (clause 5: 12 a day).
    const busy = buildMockState(NOW);
    const d187 = busy.deals.find((d) => d.display.label === 'D-0187')!;
    for (let i = 0; i < 12; i++) {
      busy.deals.push({ ...d187, deal: { ...d187.deal, id: `X-${i}`, updated_at: NOW - 60, terms: { ...d187.deal.terms, unit_price: { minor: 1, currency: 'USD' } } } });
      (busy.history ??= []).push({ at: NOW - 60, deal_id: `X-${i}`, seq: busy.history.length + 1, kind: 'agreed', state_after: 'AGREED', authority: { type: 'none' }, paypal: { type: 'none' } } as never);
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(busy));
    expect(await mandateLine('D-0193')).toMatchObject({ status: 'fail', text: 'Outside your rules: the daily limit.' });
    expect((await approvalFor('D-0193').invoke('approval_summary', { deal_id: id })).can_owner_accept).toBe(false);
  });

  /** Rust limits_tests' C2 fixture on D-0193 ($329, asked above $250): its rules at $500 a day,
   *  no other deal today, and `walletOutDay` as the wallet limit (null: none signed). */
  function dailyFiveHundred(walletOutDay: number | null) {
    const world = buildMockState(NOW);
    const d = world.deals.find((x) => x.display.label === 'D-0193')!;
    // Every other deal agreed two days ago: none spends today's budget.
    for (const o of world.deals) {
      if (o === d) continue;
      o.deal.updated_at = NOW - 2 * 86400;
      world.history = (world.history ?? []).map((h) => h.deal_id === o.deal.id && h.kind === 'agreed' ? { ...h, at: NOW - 2 * 86400 } : h);
    }
    world.mandates = world.mandates.map((m) => m.payload.id !== d.deal.mandate_id ? m : {
      ...m, payload: { ...m.payload, clauses: m.payload.clauses.map((c) => c.type === 'velocity' ? { ...c, max_total_day: { minor: 50000, currency: 'USD' as const } } : c) },
    });
    world.envelope = walletOutDay === null || !world.envelope ? null : { ...world.envelope, payload: { ...world.envelope.payload, max_out_day: { minor: walletOutDay, currency: 'USD' } } };
    return { world, d };
  }

  it('C2: the rules line says what today’s budget leaves after this deal, word for word as the wallet does', async () => {
    const id = fakeUlid('D-0193');
    const { world, d } = dailyFiveHundred(null);
    localStorage.setItem(STORE_KEY, JSON.stringify(world));
    const a = approvalFor('D-0193');
    const token = await a.invoke('approval_token', null);
    const s = await a.invoke('approval_summary', { deal_id: id });
    expect(line(s, 'mandate')).toMatchObject({ status: 'pass', text: 'Above your ask-me limit of $250.00, so it’s your call. After this, $171.00 of today’s $500.00 is left.' });
    expect(line(s, 'mandate').detail).toContain('clause 5 max_total_day 500.00 USD − (used today 0.00 USD + this 329.00 USD) = 171.00 USD left');
    expect(line(s, 'mandate').detail).toContain('the day resets at 00:00 UTC');

    // A second $100 deal agrees today under the same rules: $71 left, and the old hash is stale.
    const later = JSON.parse(localStorage.getItem(STORE_KEY)!) as typeof world;
    later.deals.push({ ...d, deal: { ...d.deal, id: 'X-100', state: 'AGREED', updated_at: NOW - 60, terms: { ...d.deal.terms, unit_price: { minor: 10000, currency: 'USD' } } } });
    (later.history ??= []).push({ at: NOW - 60, deal_id: 'X-100', seq: later.history.length + 1, kind: 'agreed', state_after: 'AGREED', authority: { type: 'none' }, paypal: { type: 'none' } } as never);
    localStorage.setItem(STORE_KEY, JSON.stringify(later));
    const b = approvalFor('D-0193');
    const now = await b.invoke('approval_summary', { deal_id: id });
    expect(line(now, 'mandate').text).toBe('Above your ask-me limit of $250.00, so it’s your call. After this, $71.00 of today’s $500.00 is left.');
    await expect(b.invoke('deal_owner_accept', { ...args(s), counter_hash: s.counter_hash }, { token })).rejects.toMatchObject({ code: 'INVALID', message: SUMMARY_CHANGED });
  });

  it('C2: a tighter $400 wallet limit is the one the rules line names', async () => {
    const { world } = dailyFiveHundred(40000);
    localStorage.setItem(STORE_KEY, JSON.stringify(world));
    const m = await mandateLine('D-0193');
    expect(m.text).toBe('Above your ask-me limit of $250.00, so it’s your call. After this, $71.00 of your wallet’s $400.00 daily limit is left today.');
    expect(m.detail).toContain('wallet limit max_out_day 400.00 USD − (used today 0.00 USD + this 329.00 USD) = 71.00 USD left');
    expect(m.detail).toContain('tighter: the wallet limit');
  });

  it('void is the safe direction and needs no checklist hash', async () => {
    const id = fakeUlid('D-0190');
    const a = approvalFor('D-0190');
    const token = await a.invoke('approval_token', null);
    const s = await a.invoke('approval_summary', { deal_id: id });
    const voided = await a.invoke('deal_void', { deal_id: id, attempt: s.attempt, terms_hash: s.terms_hash }, { token });
    expect(voided.state).toBe('VOIDED');
  });
});

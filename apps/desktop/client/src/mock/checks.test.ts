// T5 (approval-window-1): the mock composes the wallet's six-line checklist from its fixtures as
// Rust does, carries its hash in the summary, and refuses a money decision whose hash is missing
// or stale, or taken while a line fails (a release may fail only the shield line).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import { CHECK_FAILED, SUMMARY_CHANGED } from '../lib/words';
import { mockBackend, resetMockState } from './backend';
import { fakeUlid } from './fixtures';

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
    expect(line(s, 'mandate')).toMatchObject({ status: 'pass', text: 'Above your ask-me limit of $250.00, so it’s your call.' });
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

  it('void is the safe direction and needs no checklist hash', async () => {
    const id = fakeUlid('D-0190');
    const a = approvalFor('D-0190');
    const token = await a.invoke('approval_token', null);
    const s = await a.invoke('approval_summary', { deal_id: id });
    const voided = await a.invoke('deal_void', { deal_id: id, attempt: s.attempt, terms_hash: s.terms_hash }, { token });
    expect(voided.state).toBe('VOIDED');
  });
});

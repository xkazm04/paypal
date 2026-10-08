import { describe, expect, it } from 'vitest';
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import type { Deal } from '@bindings/Deal';
import type { H256 } from '@bindings/H256';
import { nextSteps, type NextInput } from './next';

const HASH = Array.from({ length: 32 }, (_, i) => i) as H256;
const usd = (minor: number) => ({ minor, currency: 'USD' as const });

function deal(p: Partial<Deal> = {}): Deal {
  return {
    id: '01JDTESTDEAL0000000000000Q', kind: 'haggle', side: 'buyer', counterparty: 'kp_test',
    terms: { item_ref: 'monitor', qty: 1, unit_price: usd(32900), currency: 'USD', delivery: { type: 'digital_now' } },
    state: 'NEGOTIATING', mandate_id: 'M1', mandate_version: 3, transcript_head: HASH,
    paypal: { order: null, authorization: null, capture: null, subscription: null }, mode: 'sandbox', market: null, shield: 'CLEAR', ...p,
  };
}
const summary = (d: Partial<Deal> = {}, s: Partial<ApprovalSummary> = {}): ApprovalSummary => ({
  deal: deal(d), evidence: { deal_id: 'x', receipt: 'NONE', reconciliation: 'not_applicable' }, attempt: 1, terms_hash: HASH,
  locked: false, can_release: true, can_open_paypal: true, unavailable_reason: null, checks: [], checks_hash: HASH, ...s,
});

type Case = Partial<Omit<NextInput, 'deal' | 'summary'>> & { d?: Partial<Deal>; s?: Partial<ApprovalSummary> };
function next(p: Case = {}) {
  const sm = summary(p.d, p.s);
  const { d: _d, s: _s, ...rest } = p;
  return nextSteps({ kind: 'review', phase: 'ready', deal: sm.deal, summary: sm, who: 'Dan', total: '$329.00', act: null, ...rest });
}
const texts = (r: ReturnType<typeof next>) => (r ?? []).map((x) => x.text);

describe('what happens next is built from the deal and the decision, and says nothing it cannot back', () => {
  it('accepting an offer: you approve, their wallet sends the request, you pay on PayPal', () => {
    const r = next({ kind: 'accept', act: 'accept' });
    expect(texts(r)).toEqual(['You approve the price here', 'Dan’s wallet sends a payment request', 'You pay on PayPal']);
    expect(r?.[0]?.now).toBe(true);
    expect(r?.slice(1).some((x) => x.now)).toBe(false);
  });
  it('locked: the offer is still the question even though Rust withholds can-accept', () => {
    expect(texts(next({ kind: 'accept', act: null, phase: 'locked' }))[0]).toBe('You approve the price here');
  });
  it('paying from a hold: you pay here, they get the money, a receipt is saved', () => {
    const r = next({ kind: 'capture', act: 'capture', who: 'partsco', total: '$64.00', d: { kind: 'purchase', state: 'AUTHORIZED' } });
    expect(texts(r)).toEqual(['You pay here', 'partsco gets $64.00', 'Receipt saved']);
  });
  it('collecting is not paying', () => {
    const r = next({ kind: 'capture', act: 'capture', d: { side: 'seller', state: 'AUTHORIZED' } });
    expect(texts(r)[0]).toBe('You collect $329.00 here');
    expect(texts(r).join(' ')).not.toMatch(/You pay/);
  });
  it('opening PayPal: a haggle waits for their wallet; your own purchase goes on hold first', () => {
    expect(texts(next({ kind: 'approve', act: 'open', d: { state: 'AWAITING_APPROVAL' } }))).toEqual(['You approve $329.00 on PayPal', 'Dan’s wallet collects the payment', 'Receipt saved']);
    expect(texts(next({ kind: 'approve', act: 'open', d: { kind: 'purchase', state: 'AWAITING_APPROVAL' } }))[1]).toBe('You put it on hold here');
  });
  it('approving as the seller differs by state: create the order, or put the money on hold', () => {
    const agreed = next({ kind: 'review', act: 'countersign', d: { side: 'seller', state: 'AGREED' } });
    expect(texts(agreed)).toEqual(['You approve here', 'The PayPal order is created', 'Dan approves it on PayPal']);
    const approved = next({ kind: 'review', act: 'countersign', d: { side: 'seller', state: 'APPROVED' } });
    expect(texts(approved)).toEqual(['You approve here', 'The $329.00 goes on hold at PayPal', 'You collect it, as its own step']);
  });
  it('unpausing pays nothing: it becomes "Check with you" and you still approve the payment', () => {
    const r = next({ kind: 'hold', phase: 'hold', act: 'release', d: { shield: 'HOLD' } });
    expect(texts(r)).toEqual(['You unpause it here', 'It becomes “Check with you”', 'You still approve the payment itself']);
  });
  it('a rescue fix: one real invoice; a replay is never counted, an unavailable sender says so', () => {
    const replay = next({ kind: 'lever', act: 'rescue', total: '$9.60', d: { kind: 'rescue', side: 'seller', state: 'AGREED', mode: 'replay' } });
    expect(texts(replay)[1]).toBe('One $9.60 invoice goes to the subscriber');
    expect(texts(replay)[2]).toBe('Never counted: a replayed failure');
    const off = next({ kind: 'lever', act: 'rescue', d: { kind: 'rescue', side: 'seller', state: 'AGREED' }, s: { unavailable_reason: 'x' } });
    expect(texts(off)).toContain('The invoice can’t be sent right now');
    const live = next({ kind: 'lever', act: 'rescue', total: '$9.60', d: { kind: 'rescue', side: 'seller', state: 'AGREED' } });
    expect(texts(live)).toEqual(['You approve the fix here', 'One $9.60 invoice goes to the subscriber', 'Counted once PayPal shows it paid']);
  });
  it('a mismatch never offers a pay step, and a block never offers a release step', () => {
    const m = next({ kind: 'mismatch', phase: 'mismatch', d: { state: 'MISMATCH' } });
    expect(m?.map((x) => x.by)).toEqual(['stop', 'stop', 'wallet']);
    expect(texts(m).join(' ')).not.toMatch(/You pay|You approve|You collect|unpause/i);
    const b = next({ kind: 'review', phase: 'block', d: { shield: 'BLOCK' } });
    expect(texts(b).join(' ')).not.toMatch(/You unpause|You approve|You pay/i);
    expect(texts(b)).toContain('No money moved');
  });
  it('after the hand-off and while waiting, the first step is the one in progress', () => {
    const inb = next({ kind: 'approve', phase: 'in_browser', act: 'open', d: { state: 'AWAITING_APPROVAL' } });
    expect(inb?.[0]).toMatchObject({ by: 'you', now: true });
    const wait = next({ kind: 'review', phase: 'waiting', d: { state: 'AGREED' } });
    expect(wait?.[0]).toMatchObject({ by: 'them', now: true, text: 'Dan’s wallet makes the PayPal order' });
    const seller = next({ kind: 'review', phase: 'waiting', d: { side: 'seller', state: 'AWAITING_APPROVAL' } });
    expect(seller?.[0]).toMatchObject({ by: 'them', now: true });
  });
  it('nothing is promised once there is nothing left to decide', () => {
    for (const phase of ['checking', 'done', 'stopped'] as const) expect(next({ phase })).toBeNull();
    expect(next({ kind: 'review', act: null })).toBeNull();
  });
  it('every path is two or three short steps', () => {
    const cases = [
      next({ kind: 'accept', act: 'accept' }),
      next({ kind: 'capture', act: 'capture', d: { kind: 'purchase', state: 'AUTHORIZED' } }),
      next({ kind: 'hold', phase: 'hold', act: 'release' }),
      next({ kind: 'mismatch', phase: 'mismatch' }),
      next({ kind: 'review', phase: 'block' }),
    ];
    for (const c of cases) {
      expect(c?.length).toBeGreaterThanOrEqual(2);
      expect(c?.length).toBeLessThanOrEqual(3);
      for (const s of c ?? []) expect(s.text.length).toBeLessThan(48);
    }
  });
});

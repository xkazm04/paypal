import { describe, expect, it } from 'vitest';
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import type { Deal } from '@bindings/Deal';
import type { H256 } from '@bindings/H256';
import { checkStateOf, summarySentence, type Intent, type SaysInput } from './says';
import type { Twin } from './diff';

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
  locked: false, can_release: true, can_open_paypal: true, unavailable_reason: null, ...s,
});
const twin = (op: Twin['op'], left = '$340.00'): Twin => ({ left: { k: 'Most you’ll pay', v: left }, op, right: { k: 'Dan asks', v: '$329.00' }, tone: 'ok' });

function says(p: Partial<SaysInput> & { act?: Intent }) {
  const s = p.summary ?? summary();
  return summarySentence({ kind: 'accept', phase: 'ready', deal: s.deal, summary: s, who: 'Dan', total: '$329.00', settle: null, twin: twin('≥'), act: null, ...p });
}

describe('the approval sentence says what you approve, and never more than the facts', () => {
  it('owner accept: the price, the limit, and that you pay later on PayPal', () => {
    const r = says({ act: 'accept' });
    expect(r.text).toBe('Dan offers $329.00, inside your $340.00 limit. Approving accepts that price; you pay later on PayPal.');
    expect(r.tone).toBe('need');
  });
  it('an offer above the limit says so', () => {
    expect(says({ act: 'accept', twin: twin('<') }).text).toMatch(/above your \$340\.00 limit/);
  });
  it('locked: Rust withholds can-accept but the question is still the same offer', () => {
    expect(says({ act: null, phase: 'locked' }).text).toMatch(/^Dan offers \$329\.00/);
  });
  it('mismatch names both amounts and says nothing can be paid', () => {
    const s = summary({ state: 'MISMATCH' });
    const r = says({ kind: 'mismatch', phase: 'mismatch', summary: s, deal: s.deal, settle: usd(33900) });
    expect(r.text).toBe('Dan asked $339.00 instead of the agreed $329.00. Nothing can be paid.');
    expect(r.tone).toBe('alert');
    expect(says({ kind: 'mismatch', phase: 'mismatch', summary: s, deal: s.deal }).text).toMatch(/Nothing can be paid\.$/);
  });
  it('a block says it cannot be released; a hold says unpausing pays nothing', () => {
    expect(says({ phase: 'block' }).text).toMatch(/can’t be released, and no money moved/);
    expect(says({ phase: 'hold', act: 'release' }).text).toMatch(/Unpausing doesn’t pay anything/);
  });
  it('paying from a hold: pay now, or release and nothing is paid', () => {
    const s = summary({ kind: 'purchase', state: 'AUTHORIZED' });
    const r = says({ kind: 'capture', act: 'capture', summary: s, deal: s.deal, who: 'partsco', total: '$64.00' });
    expect(r.text).toBe('Pay partsco $64.00 now from the money on hold. Releasing cancels the hold and nothing is paid.');
  });
  it('an amount that was never compared is not called a match', () => {
    const s = summary({ kind: 'purchase', state: 'AWAITING_APPROVAL' }, { can_open_paypal: false, locked: true });
    const r = says({ kind: 'approve', act: 'open', summary: s, deal: s.deal, twin: twin('?') });
    expect(r.text).not.toMatch(/matches/);
    expect(r.text).toMatch(/hasn’t compared it/);
    expect(says({ kind: 'approve', act: 'open', summary: s, deal: s.deal, twin: twin('=') }).text).toMatch(/matches the \$329\.00 you agreed/);
  });
  it('a seller’s word alone is never reported as paid', () => {
    const s = summary({ kind: 'haggle', state: 'RECEIPTED' }, { evidence: { deal_id: 'x', receipt: 'SELLER_ATTESTED', reconciliation: 'pending_reporting' } });
    const r = says({ kind: 'approve', phase: 'done', summary: s, deal: s.deal });
    expect(r.text).toMatch(/Dan says the \$329\.00 was paid/);
    expect(r.tone).toBe('calm');
    const v = summary({ kind: 'purchase', state: 'CAPTURED' }, { evidence: { deal_id: 'x', receipt: 'PAYPAL_VERIFIED', reconciliation: 'matched' } });
    expect(says({ kind: 'approve', phase: 'done', summary: v, deal: v.deal }).text).toBe('Paid Dan $329.00. PayPal confirmed it.');
  });
  it('a replay never claims anything real is invoiced', () => {
    const s = summary({ kind: 'rescue', side: 'seller', state: 'FAILED', mode: 'replay' });
    expect(says({ kind: 'lever', act: 'rescue', summary: s, deal: s.deal }).text).toMatch(/invoices nothing real/);
  });
});

describe('diff rows read as checks: unknown is never a pass', () => {
  it('maps tone and relation onto pass / ask / fail / unknown', () => {
    expect(checkStateOf({ rel: '=', tone: 'ok' })).toBe('pass');
    expect(checkStateOf({ rel: '≠', tone: 'bad' })).toBe('fail');
    expect(checkStateOf({ rel: '!', tone: 'hold' })).toBe('ask');
    expect(checkStateOf({ rel: '∉', tone: 'info', word: 'so you’re asked' })).toBe('ask');
    expect(checkStateOf({ rel: '>', tone: 'info', word: 'asks you' })).toBe('ask');
  });
  it('never calls a not-compared or waiting row passed', () => {
    expect(checkStateOf({ rel: '?', tone: 'ok' })).toBe('unknown');
    expect(checkStateOf({ rel: '?', tone: 'info' })).toBe('unknown');
    expect(checkStateOf({ rel: '…', tone: 'wait' })).toBe('unknown');
    expect(checkStateOf({ rel: '=', tone: 'info' })).toBe('unknown');
  });
});

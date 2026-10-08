import { describe, expect, it } from 'vitest';
import type { Clause } from '@bindings/Clause';
import type { Deal } from '@bindings/Deal';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import { buildMockState, usd } from '../../../mock/fixtures';
import {
  attestOf, CLAUSE_NUMBER, decisionLine, envelopeLink, evidenceLabel, latestText, mayWithdraw, milestones, mirrorStrip, readClauses, reconciliationLabel,
  roleFor, stateTone, stepLabel, timelineRows, withdrawWhat,
} from './model';

const NOW = 1_800_000_000;
const world = buildMockState(NOW);
const byLabel = (l: string): Deal => {
  const d = world.deals.find((x) => x.display.label === l);
  if (!d) throw new Error(`fixture ${l} missing`);
  return d.deal;
};
const mk = (o: Partial<Deal>): Deal => ({ ...byLabel('D-0193'), ...o });
const labels = (d: Deal, opts?: Parameters<typeof mirrorStrip>[1]) => mirrorStrip(d, opts).steps.map((s) => s.label);
// Each deal is read against the mandate (and version) it was signed under, as Rust does.
const clausesOf = (d: Deal): Clause[] => world.mandates.find((m) => m.payload.id === d.mandate_id && m.payload.version === d.mandate_version)!.payload.clauses;
const clauses: Clause[] = clausesOf(byLabel('D-0193'));

describe('mirrorStrip: steps per kind', () => {
  it('hides the steps a kind does not have', () => {
    expect(labels(mk({ kind: 'purchase', side: 'buyer', state: 'AUTHORIZED' }))).toEqual(['Agreed', 'Waiting for approval', 'Approved on PayPal', 'On hold', 'Paid', 'Paid, on statement']);
    expect(labels(mk({ kind: 'rescue', side: 'seller', state: 'AGREED' }))).toEqual(['Renewal failed', 'Sending invoice', 'Waiting for subscriber', 'Paid to you, receipt saved']);
    expect(labels(mk({ kind: 'invoice', side: 'seller', state: 'AWAITING_APPROVAL' }))).toEqual(['Waiting for buyer', 'Paid to you', 'Paid to you, on statement']);
    const purchase = labels(mk({ kind: 'purchase', side: 'buyer', state: 'AGREED' }));
    expect(purchase).not.toContain('Negotiating');
    expect(purchase).not.toContain('Connecting');
  });
  it('says the seller attests a buyer haggle capture; the seller sees it paid', () => {
    expect(labels(mk({ kind: 'haggle', side: 'buyer', state: 'NEGOTIATING' }))).toContain('Seller says paid');
    expect(labels(mk({ kind: 'haggle', side: 'buyer', state: 'NEGOTIATING' }))).not.toContain('Paid');
    expect(labels(mk({ kind: 'haggle', side: 'seller', state: 'NEGOTIATING' }))).toContain('Paid to you');
    expect(labels(mk({ kind: 'haggle', side: 'seller', state: 'NEGOTIATING' }))).toContain('On hold');
    expect(stepLabel({ kind: 'shop_order', side: 'seller' }, 'AWAITING_APPROVAL')).toBe('Waiting for buyer');
    expect(stepLabel({ kind: 'rescue', side: 'seller' }, 'AWAITING_APPROVAL')).toBe('Waiting for subscriber');
  });
  it('marks done before, current at, todo after; tone follows who acts', () => {
    const s = mirrorStrip(mk({ state: 'NEGOTIATING', shield: 'CLEAR' }), { needsYou: true });
    expect(s.steps.map((x) => x.status).slice(0, 4)).toEqual(['done', 'done', 'cur', 'todo']);
    expect(s.steps[2]?.tone).toBe('need');
    expect(s.term).toBeNull();
    expect(mirrorStrip(mk({ state: 'NEGOTIATING', shield: 'CLEAR' })).tone).toBe('live');
    expect(mirrorStrip(mk({ kind: 'purchase', state: 'AUTHORIZED', shield: null })).tone).toBe('held');
    expect(mirrorStrip(mk({ kind: 'purchase', state: 'AGREED', shield: 'HOLD' })).tone).toBe('held');
    expect(mirrorStrip(mk({ kind: 'purchase', state: 'CAPTURED', shield: null })).tone).toBe('ok');
    expect(mirrorStrip(mk({ kind: 'rescue', side: 'seller', state: 'AGREED', shield: null })).term).toBeNull();
    expect(mirrorStrip(mk({ kind: 'rescue', side: 'seller', state: 'FAILED', shield: null })).term).toEqual({ label: 'Fix failed', tone: 'bad' });
    // A deal the deadline withdrew lapsed; nobody walked away (the banner says the same).
    expect(mirrorStrip(mk({ state: 'WITHDRAWN', shield: null, decided_by: { type: 'safe_default', deadline: 1 } })).term?.label).toBe('Lapsed');
    expect(mirrorStrip(mk({ state: 'WITHDRAWN', shield: null, decided_by: null })).term?.label).not.toBe('Lapsed');
  });
  it('moves a captured deal onto RECONCILED only when the statement matched', () => {
    const d = mk({ kind: 'purchase', side: 'buyer', state: 'CAPTURED', shield: null });
    expect(mirrorStrip(d).steps.find((s) => s.status === 'cur')?.key).toBe('CAPTURED');
    expect(mirrorStrip(d, { reconciliation: 'pending_reporting' }).steps.find((s) => s.status === 'cur')?.key).toBe('CAPTURED');
    expect(mirrorStrip(d, { reconciliation: 'matched' }).steps.find((s) => s.status === 'cur')?.key).toBe('RECONCILED');
  });
  it('appends a terminal state as its own chip after the known-reached prefix', () => {
    const v = mirrorStrip(mk({ kind: 'purchase', side: 'buyer', state: 'VOIDED', shield: null }));
    expect(v.term).toEqual({ label: 'Hold released', tone: 'off' });
    expect(v.steps.filter((s) => s.status === 'done').map((s) => s.key)).toEqual(['AGREED', 'AWAITING_APPROVAL', 'APPROVED', 'AUTHORIZED']);
    expect(v.steps.some((s) => s.status === 'cur')).toBe(false);
    const block = mirrorStrip(byLabel('D-0196'));
    expect(block.term).toEqual({ label: 'Blocked by a scam check', tone: 'bad' });
    expect(block.steps.every((s) => s.status === 'todo')).toBe(true);
    expect(stateTone(block)).toBe('red');
    const mm = mirrorStrip(mk({ state: 'MISMATCH' }));
    expect(mm.steps.filter((s) => s.status === 'done').at(-1)?.key).toBe('SETTLING');
    expect(stateTone(mirrorStrip(mk({ state: 'WITHDRAWN' })))).toBe('line');
  });
});

describe('milestones: five plain steps instead of the protocol states', () => {
  it('folds a buyer haggle into Talk · Agree · Approve · Pay · Proof and marks where it is', () => {
    const m = milestones(mirrorStrip(mk({ state: 'NEGOTIATING', shield: 'CLEAR' }), { needsYou: true }));
    expect(m.items.map((i) => i.key)).toEqual(['talk', 'agree', 'approve', 'pay', 'proof']);
    expect(m.items.map((i) => i.status)).toEqual(['cur', 'todo', 'todo', 'todo', 'todo']);
    expect(m.items[0]?.tone).toBe('need');
    expect(m.items[0]?.detail).toContain('Negotiating (now)');
    expect(m.end).toBeNull();
  });
  it('shows only the milestones a purchase has', () => {
    expect(milestones(mirrorStrip(mk({ kind: 'purchase', state: 'AUTHORIZED', shield: null }))).items.map((i) => i.key)).toEqual(['agree', 'approve', 'pay', 'proof']);
  });
  it('ends early after the last milestone reached, never as a step', () => {
    const v = milestones(mirrorStrip(mk({ kind: 'purchase', side: 'buyer', state: 'VOIDED', shield: null })));
    expect(v.end).toEqual({ label: 'Hold released', tone: 'off', after: 'approve' });
    const mm = milestones(mirrorStrip(mk({ state: 'MISMATCH' })));
    expect(mm.end).toMatchObject({ tone: 'bad', after: 'agree' });
    expect(milestones(mirrorStrip(byLabel('D-0196'))).end?.after).toBeNull();
  });
  it('joins a rescue’s failed renewal to the next milestone', () => {
    const r = milestones(mirrorStrip(mk({ kind: 'rescue', side: 'seller', state: 'AGREED', shield: null })));
    expect(r.items[0]).toMatchObject({ key: 'agree', status: 'cur' });
    expect(r.items.map((i) => i.key)).toEqual(['agree', 'approve', 'proof']);
  });
});

describe('readClauses', () => {
  const d0193 = byLabel('D-0193');
  it('numbers clauses as the report does and keeps clause order', () => {
    expect(CLAUSE_NUMBER.human_present_over).toBe(6);
    // The sourcing rules also keep this item's typical price fresh (rule 9, T15): it decides nothing.
    expect(readClauses(clauses, d0193).map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 9]);
    expect(readClauses(clauses, d0193).find((c) => c.n === 9)).toMatchObject({ reading: 'na', fact: expect.stringContaining('never approves anything') });
  });
  it('reads the signed numbers for a haggle: band and per-deal within, human present asks', () => {
    const r = readClauses(clauses, d0193, { rounds: { used: 5, max: 6 } });
    const by = (n: number) => r.find((c) => c.n === n);
    expect(by(1)?.reading).toBe('within');
    expect(by(3)?.reading).toBe('within'); // the haggle mandate's per-deal limit is $340
    expect(by(4)?.reading).toBe('within');
    expect(by(4)?.fact).toContain('$329.00 ≤ most you’ll pay $340.00 · round 5 of 6');
    expect(by(6)?.reading).toBe('asks');
    expect(by(5)?.reading).toBe('unknown');
    expect(by(7)?.reading).toBe('unknown');
    expect(by(2)?.reading).toBe('unknown');
  });
  it('flags a purchase over its per-deal limit and takes Rust’s named clause as "asks"', () => {
    const big = readClauses(clausesOf(byLabel('D-0196')), byLabel('D-0196'));
    expect(big.find((c) => c.n === 3)?.reading).toBe('outside');
    expect(big.find((c) => c.n === 4)).toBeUndefined(); // the purchase mandate has no band
    expect(big.find((c) => c.n === 6)?.reading).toBe('na'); // above the threshold but closed: nothing is asked
    const dock = readClauses(clausesOf(byLabel('D-0190')), byLabel('D-0190'), { asks: 7 });
    expect(dock.find((c) => c.n === 3)?.reading).toBe('within');
    expect(dock.find((c) => c.n === 7)?.reading).toBe('asks');
    expect(dock.find((c) => c.n === 6)?.fact).toContain('your rules may approve it');
  });
  it('reads pinned and house counterparty rules, and never claims pairing it cannot see', () => {
    const pinned: Clause[] = [{ type: 'counterparties', rule: { type: 'pinned', keys: [d0193.counterparty] } }];
    expect(readClauses(pinned, d0193)[0]?.reading).toBe('within');
    expect(readClauses(pinned, { ...d0193, counterparty: 'kp_other' })[0]?.reading).toBe('outside');
    const house: Clause[] = [{ type: 'counterparties', rule: { type: 'house' } }];
    expect(readClauses(house, d0193, { house: true })[0]?.reading).toBe('within');
    expect(readClauses(house, d0193, { house: false })[0]?.reading).toBe('outside');
  });
  it('maps kind and side to the mandate role', () => {
    expect(roleFor({ kind: 'haggle', side: 'buyer' })).toBe('buy');
    expect(roleFor({ kind: 'haggle', side: 'seller' })).toBe('sell');
    expect(roleFor({ kind: 'shop_order', side: 'seller' })).toBe('shop');
    expect(roleFor({ kind: 'invoice', side: 'seller' })).toBe('rescue');
    expect(readClauses([{ type: 'roles', roles: ['sell'] }], d0193)[0]?.reading).toBe('outside');
  });
  it('treats a currency mismatch as unknown, never as within', () => {
    const eur: Clause[] = [{ type: 'per_deal', kind: 'purchase', max_amount: { minor: 1000, currency: 'EUR' }, categories: [] }];
    expect(readClauses(eur, byLabel('D-0190'))[0]?.reading).toBe('unknown');
  });
});

describe('envelopeLink', () => {
  const d = byLabel('D-0193');
  const step = (o: Partial<TranscriptStep>): TranscriptStep => ({ seq: 1, by: 'you', typ: 'COUNTER', price: usd(300), at: NOW, verified: true, ...o });
  it('links your priced offers to the band and an ACCEPT over the threshold to clause 6', () => {
    expect(envelopeLink(step({}), d, clauses)).toEqual({ clauses: [4], them: false, paypal: false });
    expect(envelopeLink(step({ typ: 'ACCEPT', price: usd(329) }), d, clauses).clauses).toEqual([4, 6]);
    expect(envelopeLink(step({ typ: 'ACCEPT', price: usd(200) }), d, clauses).clauses).toEqual([4]);
  });
  it('lights their column for their envelopes and PayPal for SETTLE / RECEIPT', () => {
    expect(envelopeLink(step({ by: 'them' }), d, clauses)).toEqual({ clauses: [], them: true, paypal: false });
    expect(envelopeLink(step({ by: 'them', typ: 'SETTLE' }), d, clauses).paypal).toBe(true);
    expect(envelopeLink(step({ typ: 'WITHDRAW', price: null }), d, clauses).clauses).toEqual([]);
  });
  it('derives nothing for kinds without a band, or without a band clause', () => {
    expect(envelopeLink(step({}), byLabel('D-0190'), clauses).clauses).toEqual([]);
    expect(envelopeLink(step({}), d, clauses.filter((c) => c.type !== 'band')).clauses).toEqual([]);
  });
});

describe('timeline, evidence and decision', () => {
  it('merges envelopes with the two ledger timestamps, newest first', () => {
    const steps = world.deals.find((x) => x.display.label === 'D-0193')!.transcript;
    const rows = timelineRows(steps, byLabel('D-0193'));
    expect(rows).toHaveLength(steps.length + 2);
    expect(rows.at(-1)).toMatchObject({ kind: 'ledger', key: 'created' });
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.at).toBeGreaterThanOrEqual(rows[i]!.at);
    expect(timelineRows([], { state: 'AGREED' })).toEqual([]);
  });
  it('never shows seller-attested as receipted', () => {
    expect(evidenceLabel(byLabel('D-0187'), 'SELLER_ATTESTED').text).toBe('Seller says paid');
    expect(evidenceLabel(byLabel('D-0187'), 'PAYPAL_VERIFIED').text).toBe('PayPal receipt');
    expect(evidenceLabel(byLabel('D-0190'), 'NONE').text).toBe('On hold');
    expect(evidenceLabel(mk({ state: 'CAPTURED' }), 'NONE').tone).toBe('dashed');
    expect(reconciliationLabel('pending_reporting').text).toBe('Not on statement yet');
    expect(attestOf(byLabel('D-0187'), 'capture', 'SELLER_ATTESTED')).toBe('the seller says so');
    expect(attestOf(byLabel('D-0187'), 'order', 'NONE')).toContain('signed payment request');
    expect(attestOf(byLabel('D-0190'), 'authorization', 'NONE')).toContain('your wallet');
  });
  it('builds the decision line from the attention item, else from what may be done', () => {
    const need = world.deals.find((x) => x.display.label === 'D-0190')!.attention!;
    expect(decisionLine(byLabel('D-0190'), need, false)).toMatchObject({ tone: 'need', t1: 'Capture or void $64.00', t2: 'partsco' });
    expect(decisionLine(mk({ state: 'LISTED' }), undefined, true).tone).toBe('may');
    expect(decisionLine(byLabel('D-0196'), undefined, false).chip.text).toBe('Closed');
    expect(decisionLine(byLabel('D-0196'), undefined, false).t2).toBeNull(); // nothing recorded: nothing claimed
    expect(decisionLine(byLabel('D-0192'), undefined, false).t2).toBe('decided by your rule · limit per deal');
    expect(decisionLine(byLabel('D-0180'), undefined, false).t2).toBe('decided by you');
    expect(decisionLine(mk({ state: 'SETTLING' }), undefined, false).t1).toContain('other side');
  });
  it('offers withdraw only where Rust takes it and the item allows it', () => {
    const d0190 = world.deals.find((x) => x.display.label === 'D-0190')!;
    expect(mayWithdraw(d0190.deal, d0190.attention!)).toBe(false); // AUTHORIZED: capture or void lives in approval
    const d0198 = world.deals.find((x) => x.display.label === 'D-0198')!;
    expect(mayWithdraw(d0198.deal, d0198.attention!)).toBe(true);
    expect(mayWithdraw(byLabel('D-0193'), { actions: ['review'] })).toBe(true); // a haggle may always leave the table
    expect(mayWithdraw(mk({ kind: 'purchase', state: 'AGREED' }), { actions: ['review'] })).toBe(false);
  });
  it('words the withdraw sheet per state, and it never moves money', () => {
    expect(withdrawWhat(byLabel('D-0198'), 'pixel-bay')).toContain('pixel-bay’s request is declined');
    expect(withdrawWhat(mk({ state: 'AWAITING_APPROVAL', side: 'seller', shield: null, paypal: { order: 'O1', authorization: null, capture: null, subscription: null } }), 'fern')).toContain('will not collect the payment');
    for (const s of ['PAIRING', 'NEGOTIATING', 'SETTLING', 'AWAITING_APPROVAL'] as const) expect(withdrawWhat(mk({ state: s, shield: null }), 'Dan')).toMatch(/No money moves/);
  });
  it('says the latest envelope in a few words', () => {
    expect(latestText(world.deals.find((x) => x.display.label === 'D-0193')!.transcript, 'Dan')).toBe('Dan offered $329.00');
    expect(latestText([], 'Dan')).toBeNull();
  });
});

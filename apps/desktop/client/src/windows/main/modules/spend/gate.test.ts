import { describe, expect, it } from 'vitest';
import type { Clause } from '@bindings/Clause';
import type { Deal } from '@bindings/Deal';
import { clauseGroups, gateColumns, laneCells, outcomeOf, perDealCheck, reachedPaypal, ruleLine, velocityFill } from './gate';

const usd = (d: number) => ({ minor: d * 100, currency: 'USD' as const });
const CLAUSES: Clause[] = [
  { type: 'roles', roles: ['buy', 'sell'] },
  { type: 'counterparties', rule: { type: 'paired' } },
  { type: 'per_deal', kind: 'purchase', max_amount: usd(200), categories: ['office', 'parts'] },
  { type: 'band', item_refs: ['m'], floor: null, ceiling: usd(340), max_rounds: 6, deadline: 0 },
  { type: 'velocity', max_deals_day: 12, max_total_day: usd(900) },
  { type: 'human_present_over', amount: usd(250) },
  { type: 'payees', payees: ['cablehaus'] },
];
const NONE = { order: null, authorization: null, capture: null, subscription: null };
const deal = (o: Partial<Deal> & { qty?: number; price?: number }): Pick<Deal, 'kind' | 'terms' | 'state' | 'paypal'> => ({
  kind: o.kind ?? 'purchase', state: o.state ?? 'AGREED', paypal: o.paypal ?? NONE,
  terms: { item_ref: 'x', qty: o.qty ?? 1, unit_price: usd(o.price ?? 64), currency: 'USD', delivery: { type: 'digital_now' } },
});

describe('gate columns', () => {
  it('keeps the purchase clauses, numbered as the mandate numbers them', () => {
    expect(gateColumns(CLAUSES).map((c) => c.n)).toEqual([1, 3, 5, 6, 7]);
  });
});

describe('lanes', () => {
  const cols = gateColumns(CLAUSES);
  it('passes every clause for an ask that reached PayPal, and marks the clause that sent it to you', () => {
    const cells = laneCells(deal({ state: 'AUTHORIZED', paypal: { ...NONE, order: 'O', authorization: 'A' } }), cols, { clause: { mandate_id: 'M', number: 7 } });
    expect(cells.map((c) => c.kind)).toEqual(['pass', 'pass', 'pass', 'pass', 'you']);
  });
  it('reads the attention clause by its type number, not its position, when a mandate omits clauses', () => {
    const short = gateColumns(CLAUSES.filter((c) => c.type !== 'band' && c.type !== 'roles'));
    const cells = laneCells(deal({ state: 'AUTHORIZED', paypal: { ...NONE, authorization: 'A' } }), short, { clause: { mandate_id: 'M', number: 7 } });
    expect(cells.map((c) => c.kind)).toEqual(['pass', 'pass', 'pass', 'you']);
    expect(laneCells(deal({ state: 'AUTHORIZED', paypal: { ...NONE, authorization: 'A' } }), short, { clause: { mandate_id: 'M', number: 6 } }).map((c) => c.kind)).toEqual(['pass', 'pass', 'you', 'pass']);
  });
  it('stops a refused ask at a per-deal max it is over, computed here, and skips the rest', () => {
    const cells = laneCells(deal({ state: 'REFUSED', qty: 40, price: 299 }), cols);
    expect(cells.map((c) => c.kind)).toEqual(['unknown', 'fail', 'skip', 'skip', 'skip']);
    expect(cells[1]?.computed).toBe(true);
    expect(cells[1]?.text).toBe('$11,960.00 is over the $200.00 limit');
  });
  it('stops a refused ask at the clause the wallet recorded in decided_by, not a computed guess', () => {
    const cells = laneCells({ ...deal({ state: 'REFUSED', price: 50 }), decided_by: { type: 'policy', clause: 5 } }, cols);
    expect(cells.map((c) => c.kind)).toEqual(['pass', 'pass', 'fail', 'skip', 'skip']);
    expect(cells[2]?.computed).toBe(false);
    expect(cells[2]?.text).toBe('this rule refused it');
    const per = laneCells({ ...deal({ state: 'REFUSED', qty: 40, price: 299 }), decided_by: { type: 'policy', clause: 3 } }, cols);
    expect(per[1]).toMatchObject({ kind: 'fail', computed: false, text: '$11,960.00 is over the $200.00 limit' });
  });
  it('says unknown, never passed, when a refusal is not explained by the amount', () => {
    expect(laneCells(deal({ state: 'REFUSED', price: 50 }), cols).every((c) => c.kind === 'unknown')).toBe(true);
    expect(laneCells(deal({ state: 'AGREED' }), cols).every((c) => c.kind === 'unknown')).toBe(true);
  });
  it('marks per-deal clauses for another kind as not applicable', () => {
    const extra = gateColumns([...CLAUSES, { type: 'per_deal', kind: 'haggle', max_amount: usd(340), categories: [] }]);
    expect(laneCells(deal({ state: 'CAPTURED' }), extra).at(-1)?.kind).toBe('na');
  });
  it('knows when an ask reached PayPal', () => {
    expect(reachedPaypal(deal({ state: 'VOIDED' }))).toBe(true);
    expect(reachedPaypal(deal({ state: 'AGREED', paypal: { ...NONE, order: 'X' } }))).toBe(true);
    expect(reachedPaypal(deal({ state: 'REFUSED' }))).toBe(false);
  });
  it('re-reads a per-deal clause only for its own kind', () => {
    const c = CLAUSES[2] as Extract<Clause, { type: 'per_deal' }>;
    expect(perDealCheck(deal({ kind: 'haggle' }), c)).toBeNull();
    expect(perDealCheck(deal({ price: 200 }), c)).toEqual({ over: false, text: '$200.00 is within the $200.00 limit' });
  });
});

describe('the one-line rules verdict', () => {
  const cols = gateColumns(CLAUSES);
  it('says passed only when every shown rule passed', () => {
    expect(ruleLine(laneCells(deal({ state: 'CAPTURED' }), cols), cols)).toEqual({ kind: 'pass', text: 'Passed your rules' });
  });
  it('names the per-deal limit when that is what stopped it', () => {
    expect(ruleLine(laneCells(deal({ state: 'REFUSED', qty: 40, price: 299 }), cols), cols)).toEqual({ kind: 'fail', text: 'Over the per-deal limit ($200)' });
  });
  it('names another rule that refused it, from the wallet record', () => {
    const cells = laneCells({ ...deal({ state: 'REFUSED', price: 50 }), decided_by: { type: 'policy', clause: 5 } }, cols);
    expect(ruleLine(cells, cols)).toEqual({ kind: 'fail', text: 'Stopped by your “Daily limit” rule' });
  });
  it('shows the rule that asks you, and never passes an unknown', () => {
    const held = laneCells(deal({ state: 'AUTHORIZED', paypal: { ...NONE, authorization: 'A' } }), cols, { clause: { mandate_id: 'M', number: 7 } });
    expect(ruleLine(held, cols)).toEqual({ kind: 'ask', text: 'Your “Approved payees” rule asks you' });
    expect(ruleLine(laneCells(deal({ state: 'AGREED' }), cols), cols).kind).toBe('unknown');
    expect(ruleLine([], cols).kind).toBe('unknown');
  });
});

describe('outcomes and clause groups', () => {
  it('names the PayPal end of each lane', () => {
    expect(outcomeOf({ state: 'REFUSED' }).kind).toBe('refused');
    expect(outcomeOf({ state: 'AUTHORIZED' }).tone).toBe('gold');
    expect(outcomeOf({ state: 'RECONCILED' }).label).toBe('Paid');
    expect(outcomeOf({ state: 'AUTO_VOIDED' }).label).toBe('Hold released');
  });
  it('groups lanes per clause', () => {
    const cols = gateColumns(CLAUSES);
    const lanes = [
      { id: 'A', cells: laneCells(deal({ state: 'REFUSED', qty: 40, price: 299 }), cols) },
      { id: 'B', cells: laneCells(deal({ state: 'CAPTURED' }), cols) },
      { id: 'C', cells: laneCells(deal({ state: 'AUTHORIZED' }), cols, { clause: { mandate_id: 'M', number: 7 } }) },
    ];
    expect(clauseGroups(lanes, 3)).toEqual({ fail: ['A'], you: [], pass: ['B', 'C'], unknown: [] });
    expect(clauseGroups(lanes, 7)).toEqual({ fail: [], you: ['C'], pass: ['B'], unknown: ['A'] });
  });
  it('fills the velocity meter only from a known, same-currency spend', () => {
    const cap = CLAUSES[4] as Extract<Clause, { type: 'velocity' }>;
    expect(velocityFill(45000, 'USD', cap, true)).toBe(0.5);
    expect(velocityFill(45000, 'EUR', cap, true)).toBeNull();
    expect(velocityFill(45000, 'USD', cap, false)).toBeNull();
    expect(velocityFill(0, null, cap, true)).toBeNull();
  });
});

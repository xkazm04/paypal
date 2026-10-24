import { describe, expect, it } from 'vitest';
import type { Clause } from '@bindings/Clause';
import type { Deal } from '@bindings/Deal';
import { CLAUSE_NUMBER } from '../../../../lib/mandateRules';
import { CLAUSE_NO, clauseGroups, gateColumns, laneCells, outcomeOf, perDealCheck, reachedPaypal, ruleLine, velocityFill } from './gate';

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
  it('numbers clauses from the client’s one table, the one pinned to Rust’s Clause::number', () => {
    expect(CLAUSE_NO).toBe(CLAUSE_NUMBER);
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
  it('reads a mandate signed out of order in Rust’s check order (by clause number, not position)', () => {
    // A repair appends a clause at the end; Rust's check() sorts by Clause::number before checking.
    const shuffled = gateColumns([CLAUSES[0]!, CLAUSES[6]!, CLAUSES[2]!, CLAUSES[4]!, CLAUSES[5]!, CLAUSES[1]!]);
    expect(shuffled.map((c) => c.clause.type)).toEqual(['roles', 'per_deal', 'velocity', 'human_present_over', 'payees']);
    // n stays the clause's position in the signed list (the rules list marks hits by it).
    expect(shuffled.map((c) => c.n)).toEqual([1, 3, 4, 5, 2]);
    // Refused at the per-purchase limit (3): roles (1) passed, the rest were never reached.
    const per = laneCells({ ...deal({ state: 'REFUSED', price: 50 }), decided_by: { type: 'policy', clause: 3 } }, shuffled);
    expect(per.map((c) => c.kind)).toEqual(['pass', 'fail', 'skip', 'skip', 'skip']);
    // Refused at the daily limit (5): everything numbered below it passed, payees (7) was not reached.
    const vel = laneCells({ ...deal({ state: 'REFUSED', price: 50 }), decided_by: { type: 'policy', clause: 5 } }, shuffled);
    expect(vel.map((c) => c.kind)).toEqual(['pass', 'pass', 'fail', 'skip', 'skip']);
    // Columns kept in signed order still read by number: a refusal at payees (7) never passes past it.
    const raw = [CLAUSES[6]!, CLAUSES[0]!, CLAUSES[2]!];
    const cols = raw.map((clause, i) => ({ n: i + 1, clause }));
    const pay = laneCells({ ...deal({ state: 'REFUSED', price: 50 }), decided_by: { type: 'policy', clause: 3 } }, cols);
    expect(pay.map((c) => c.kind)).toEqual(['skip', 'pass', 'fail']);
    // The amount computed here stops it the same way: payees (7) is after the per-purchase limit.
    expect(laneCells(deal({ state: 'REFUSED', qty: 40, price: 299 }), cols).map((c) => c.kind)).toEqual(['skip', 'unknown', 'fail']);
  });
  it('says unknown, never passed, when a refusal is not explained by the amount', () => {
    expect(laneCells(deal({ state: 'REFUSED', price: 50 }), cols).every((c) => c.kind === 'unknown')).toBe(true);
    expect(laneCells(deal({ state: 'PAIRING' }), cols).every((c) => c.kind === 'unknown')).toBe(true);
    // Only a purchase is cleared into Agreed by the rules; another kind there stays unknown.
    expect(laneCells(deal({ kind: 'haggle', state: 'AGREED' }), cols).filter((c) => c.kind !== 'na').every((c) => c.kind === 'unknown')).toBe(true);
  });
  it('passes every rule for a purchase the wallet cleared and that waits for you', () => {
    // deal.rs: a purchase reaches Agreed only by PurchaseCleared, which agent.rs applies only after
    // the mandate check passed. So a waiting purchase met every rule, before PayPal is asked.
    const cells = laneCells(deal({ state: 'AGREED', price: 64 }), cols);
    expect(cells.map((c) => c.kind)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass']);
    expect(cells.every((c) => c.computed)).toBe(true);
    expect(ruleLine(cells, cols)).toEqual({ kind: 'pass', text: 'Passed your rules when cleared' });
  });
  it('says which version a waiting purchase cleared under, when it matches the drawn rules', () => {
    const cells = laneCells({ ...deal({ state: 'AGREED' }), mandate_version: 3 }, cols, null, { version: 3 });
    expect(cells.map((c) => c.kind)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass']);
    expect(cells[0]?.text).toBe('passed when cleared, under version 3 of your rules');
    expect(ruleLine(cells, cols)).toEqual({ kind: 'pass', text: 'Passed your rules when cleared (version 3)' });
  });
  it('never calls a waiting purchase passed against rules it was cleared before (an older version)', () => {
    const cells = laneCells({ ...deal({ state: 'AGREED', qty: 3, price: 90 }), mandate_version: 2 }, cols, null, { version: 3 });
    expect(cells.some((c) => c.kind === 'pass' || c.kind === 'you')).toBe(false);
    expect(cells.map((c) => c.kind)).toEqual(['unknown', 'unknown', 'unknown', 'unknown', 'unknown']);
    expect(cells[0]?.text).toBe('cleared under an earlier version of your rules; not checked against these');
    expect(ruleLine(cells, cols)).toEqual({ kind: 'unknown', text: 'Cleared under an earlier version of your rules; not checked against these' });
  });
  it('keeps the attention item’s clause as Rust’s word even for an earlier-version purchase', () => {
    const cells = laneCells({ ...deal({ state: 'AGREED' }), mandate_version: 2 }, cols, { clause: { mandate_id: 'M', number: 7 } }, { version: 3 });
    expect(cells.map((c) => c.kind)).toEqual(['unknown', 'unknown', 'unknown', 'unknown', 'you']);
  });
  it('marks the ask-me rule on a cleared purchase only above its limit, as the wallet applies it', () => {
    // mandate.rs: the ask-me rule asks only when the total is above its amount, never at it.
    const wide = gateColumns(CLAUSES.map((c) => (c.type === 'per_deal' ? { ...c, max_amount: usd(400) } : c)));
    const above = laneCells(deal({ state: 'AGREED', qty: 3, price: 90 }), wide);
    expect(above.map((c) => c.kind)).toEqual(['pass', 'pass', 'pass', 'you', 'pass']);
    expect(above[3]).toMatchObject({ computed: true, text: '$270.00 is above $250.00, so this rule leaves it to you' });
    expect(ruleLine(above, wide)).toEqual({ kind: 'ask', text: 'Your “Ask me above” rule asks you' });
    const at = laneCells(deal({ state: 'AGREED', qty: 2, price: 125 }), wide);
    expect(at[3]?.kind).toBe('pass');
  });
  it('marks per-deal clauses for another kind as not applicable', () => {
    const extra = gateColumns([...CLAUSES, { type: 'per_deal', kind: 'haggle', max_amount: usd(340), categories: [] }]);
    const at = extra.findIndex((c) => c.clause.type === 'per_deal' && c.clause.kind === 'haggle');
    expect(laneCells(deal({ state: 'CAPTURED' }), extra)[at]?.kind).toBe('na');
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
  it('never says “over the limit” for an ask the per-deal rule refused within its limit', () => {
    // mandate.rs: the per-deal clause refuses on the kind, the currency, the amount or the category.
    // Within the limit, in the limit's currency and kind, what it refused is what was bought.
    const cells = laneCells({ ...deal({ state: 'REFUSED', price: 50 }), decided_by: { type: 'policy', clause: 3 } }, cols);
    expect(cells[1]).toMatchObject({ kind: 'fail', computed: false, text: '$50.00 is within the $200.00 limit, so this rule refused it for what was bought, not its price' });
    expect(ruleLine(cells, cols)).toEqual({ kind: 'fail', text: 'Stopped by your “Limit per deal” rule' });
    // In another currency the amounts are never compared: the rule refused the currency.
    const eur = laneCells({ ...deal({ state: 'REFUSED', price: 50 }), terms: { item_ref: 'x', qty: 1, unit_price: { minor: 5000, currency: 'EUR' }, currency: 'EUR', delivery: { type: 'digital_now' } }, decided_by: { type: 'policy', clause: 3 } }, cols);
    expect(eur[1]?.text).toBe('this rule refused it: it is priced in EUR and the limit is in USD');
    expect(ruleLine(eur, cols).text).toBe('Stopped by your “Limit per deal” rule');
  });
  it('names another rule that refused it, from the wallet record', () => {
    const cells = laneCells({ ...deal({ state: 'REFUSED', price: 50 }), decided_by: { type: 'policy', clause: 5 } }, cols);
    expect(ruleLine(cells, cols)).toEqual({ kind: 'fail', text: 'Stopped by your “Daily limit” rule' });
  });
  it('shows the rule that asks you, and never passes an unknown', () => {
    const held = laneCells(deal({ state: 'AUTHORIZED', paypal: { ...NONE, authorization: 'A' } }), cols, { clause: { mandate_id: 'M', number: 7 } });
    expect(ruleLine(held, cols)).toEqual({ kind: 'ask', text: 'Your “Approved payees” rule asks you' });
    expect(ruleLine(laneCells(deal({ state: 'PAIRING' }), cols), cols).kind).toBe('unknown');
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

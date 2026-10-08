import { describe, expect, it } from 'vitest';
import type { Clause } from '@bindings/Clause';
import { buildClause, CLAUSE_NUMBER, isIncomplete, missingKinds, newDraft, previewClauses, ruleProblems, withClause, type DraftClause } from '../mandateDraft';
import { diffPolicy, type DiffSide } from './diff';
import { frac, leverRange, niceCeil, toMinor, toSlider } from './levers';

const usd = (major: number) => ({ minor: Math.round(major * 100), currency: 'USD' as const });
const T = 1_800_000_000;
const signed: Clause[] = [
  { type: 'roles', roles: ['buy'] },
  { type: 'counterparties', rule: { type: 'paired' } },
  { type: 'per_deal', kind: 'purchase', max_amount: usd(200), categories: ['office'] },
  { type: 'band', item_refs: ['m27'], floor: null, ceiling: usd(340), max_rounds: 6, deadline: T + 3600 },
  { type: 'velocity', max_deals_day: 12, max_total_day: usd(900) },
  { type: 'human_present_over', amount: usd(250) },
  { type: 'payees', payees: ['packrite', 'cablehaus'] },
];
const side = (clauses: DraftClause[], o: Partial<DiffSide> = {}): DiffSide => ({ clauses, agent: 'negotiator', currency: 'USD', expires: T + 86400, ...o });
const swap = (t: Clause['type'], c: Clause) => signed.map((x) => (x.type === t ? c : x));

describe('mandate diff', () => {
  it('reports nothing for the signed terms themselves', () => {
    expect(diffPolicy(side(signed), side(signed))).toEqual([]);
  });
  it('raising a limit widens, lowering restricts', () => {
    const up = diffPolicy(side(signed), side(swap('per_deal', { type: 'per_deal', kind: 'purchase', max_amount: usd(250), categories: ['office'] })));
    expect(up).toMatchObject([{ clause: 3, term: 'per-deal max', from: '$200.00', to: '$250.00', dir: 'widens' }]);
    const down = diffPolicy(side(signed), side(swap('human_present_over', { type: 'human_present_over', amount: usd(100) })));
    expect(down).toMatchObject([{ clause: 6, dir: 'restricts' }]);
  });
  it('set members: adding widens, removing restricts', () => {
    const d = diffPolicy(side(signed), side(swap('payees', { type: 'payees', payees: ['packrite', 'dock'] })));
    expect(d.map((c) => [c.to, c.dir])).toEqual([['dock', 'widens'], ['—', 'restricts']]);
  });
  it('a stricter counterparty rule restricts', () => {
    expect(diffPolicy(side(signed), side(swap('counterparties', { type: 'counterparties', rule: { type: 'house' } })))[0]?.dir).toBe('restricts');
  });
  it('compares times to the minute (datetime-local drops seconds)', () => {
    const band = signed.find((c) => c.type === 'band') as Extract<Clause, { type: 'band' }>;
    const same = swap('band', { ...band, deadline: Math.floor(band.deadline / 60) * 60 });
    expect(diffPolicy(side(signed), side(same, { expires: T + 86400 - ((T + 86400) % 60) }))).toEqual([]);
  });
  it('lists removed clauses, skips incomplete ones, and notes slot changes', () => {
    const d = diffPolicy(side(signed), side([...signed.filter((c) => c.type !== 'velocity' && c.type !== 'payees'), { type: 'payees', incomplete: true }], { agent: 'shopper' }));
    expect(d.map((c) => c.term)).toEqual(['agent slot', 'daily limit']);
  });
});

describe('lever math', () => {
  it('rounds track ends up 1-2-5', () => {
    expect([niceCeil(1), niceCeil(3), niceCeil(11), niceCeil(400), niceCeil(501)]).toEqual([1, 5, 20, 500, 1000]);
  });
  it('scales from the signed value, never the dragged one, and reports outliers off scale', () => {
    const r = leverRange(20000, [4500, 1196000], 'USD');
    expect(r).toEqual({ min: 0, max: 50000, unit: 100 });
    expect(frac(r, 1196000)).toBe(1);
    expect(toMinor(r, 250)).toBe(25000);
    expect(toSlider(r, 25099)).toBe(250);
  });
  it('a new mandate scales to the busier ticks; JPY uses whole yen', () => {
    expect(leverRange(null, [100, 200, 300, 9000], 'USD').max).toBe(1000);
    expect(leverRange(5000, [], 'JPY')).toEqual({ min: 0, max: 10000, unit: 1 });
  });
});

describe('mandate drafts', () => {
  it('converts one clause at a time and marks the rest incomplete for the preview', () => {
    expect(buildClause({ type: 'human_present_over', amount: '250' }, 'USD', 'clause 3')).toEqual({ clause: { type: 'human_present_over', amount: usd(250) }, errors: [] });
    expect(buildClause({ type: 'human_present_over', amount: '2.505' }, 'USD', 'clause 3').errors[0]).toContain('clause 3');
    const p = previewClauses(newDraft(T));
    expect(p.map((c) => (isIncomplete(c) ? `${c.type}?` : c.type))).toEqual(['roles', 'counterparties', 'human_present_over?']);
  });
  it('mirrors Rust validate(): required clauses, duplicates, empty sets, a band past expiry', () => {
    const p = previewClauses(newDraft(T));
    expect(ruleProblems(p, T, T + 86400).map((x) => x.clause)).toEqual([3, 5, 7]);
    expect(ruleProblems(signed, T, T + 86400)).toEqual([]);
    expect(ruleProblems([...signed, { type: 'roles', roles: ['sell'] }], T, T + 86400)[0]).toMatchObject({ clause: 1 });
    expect(ruleProblems(signed.map((c) => (c.type === 'payees' ? { ...c, payees: [] } : c)), T, T + 86400)).toEqual([{ clause: 7, why: 'no payees' }]);
    expect(ruleProblems(signed, T, T + 60)[0]).toMatchObject({ clause: 4 });
    const haggleNoBand = signed.filter((c) => c.type !== 'band').map((c) => (c.type === 'per_deal' ? { ...c, kind: 'haggle' as const } : c));
    expect(ruleProblems(haggleNoBand, T, T + 86400)).toEqual([{ clause: 4, why: 'haggles and shop orders need a price range' }]);
    expect(CLAUSE_NUMBER.payees).toBe(7);
  });
  it('lists the clause kinds still missing and replaces one clause', () => {
    const d = newDraft(T);
    expect(missingKinds(d)).toEqual(['per_deal', 'band', 'velocity', 'payees', 'market_watch']);
    const e = withClause(d, 2, { type: 'human_present_over', amount: '99' });
    expect(e.clauses[2]).toEqual({ type: 'human_present_over', amount: '99' });
    expect(d.clauses[2]).toEqual({ type: 'human_present_over', amount: '' });
  });
});

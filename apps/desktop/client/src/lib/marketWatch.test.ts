// T15 keep prices fresh: the editor builds and validates the rule with Rust's own reasons, the
// wallet's facts say how many price checks are used today, the deal page only claims "kept fresh"
// for a deal a rule in force watches, and only the main and approval windows read the facts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clause } from '@bindings/Clause';
import type { MarketWatchFact } from '@bindings/MarketWatchFact';
import { mockBackend, resetMockState } from '../mock/backend';
import { fakeUlid } from '../mock/fixtures';
import { mockValidate } from '../mock/simulate';
import { watchWhy } from '../windows/main/deal/Evidence';
import { buildClause, CLAUSE_NUMBER, draftFrom, emptyClause, refusalWords, ruleProblems } from '../windows/approval/mandateDraft';
import { dealWatch, MAX_MARKET_CHECKS_DAY, MAX_WATCHED_ITEMS, marketWatchRefusal, productValid, watchLine } from './marketWatch';
import { ruleSentence, RULE_NUMBER } from './words';

const NOW = 1_800_000_000;
type Watch = Extract<Clause, { type: 'market_watch' }>;
const watch = (items: Array<[string, string]>, max: number): Watch => ({
  type: 'market_watch', items: items.map(([item_ref, product_id]) => ({ item_ref, product_id })), max_refreshes_day: max,
});
const fact = (over: Partial<MarketWatchFact> = {}): MarketWatchFact => ({
  mandate_id: fakeUlid('M-14'), mandate_version: 3, agent: 'negotiator',
  items: [{ item_ref: 'monitor-27-4k', product_id: 'lg-27uk850-w' }], max_per_day: 12, used_today: 3, used_up: false, ...over,
});

describe('keep prices fresh', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW * 1000);
    localStorage.clear(); sessionStorage.clear(); resetMockState();
  });

  it('is rule 9, after the fixes rule, everywhere the client numbers rules', () => {
    expect(CLAUSE_NUMBER.market_watch).toBe(9);
    expect(CLAUSE_NUMBER.lever).toBe(8);
    expect(RULE_NUMBER.market_watch).toBe(9);
  });

  it('validates as table-core does, with the same reasons', () => {
    expect(marketWatchRefusal(watch([['dock', 'p-dock_1']], 12))).toBeNull();
    expect(marketWatchRefusal(watch([['dock', 'p']], MAX_MARKET_CHECKS_DAY))).toBeNull();
    const cases: Array<[Watch, string]> = [
      [watch([], 12), 'invalid market watch'],
      [watch([['dock', 'p']], 0), 'invalid price check allowance'],
      [watch([['dock', 'p']], MAX_MARKET_CHECKS_DAY + 1), 'invalid price check allowance'],
      [watch([['dock', '']], 12), 'invalid market product'],
      [watch([['dock', 'p dock']], 12), 'invalid market product'],
      [watch([['dock', 'p/../x']], 12), 'invalid market product'],
      [watch([['dock', 'p'.repeat(129)]], 12), 'invalid market product'],
      [watch([['dock', 'p-1'], ['dock', 'p-2']], 12), 'item watched twice'],
      [watch(Array.from({ length: MAX_WATCHED_ITEMS + 1 }, (_, i) => [`item-${i}`, `p-${i}`] as [string, string]), 12), 'invalid market watch'],
    ];
    for (const [c, why] of cases) {
      expect(marketWatchRefusal(c)).toBe(why);
      // Rust's refusal reads as a plain sentence, without the rule's number.
      const words = refusalWords(`mandate clause 9: ${why}`);
      expect(words).not.toMatch(/clause|9|invalid/);
      expect(words).not.toContain('don’t fit');
    }
    expect(productValid('ergotron-lx-45-241')).toBe(true);
    expect(productValid('é')).toBe(false);
  });

  it('builds from the editor, reads back for re-signing, and names its problems plainly', () => {
    const empty = emptyClause('market_watch', NOW);
    expect(buildClause(empty, 'USD', 'Keep prices fresh').errors).toContain('Keep prices fresh: name at least one item');
    const typed = { type: 'market_watch' as const, items: [{ item: ' monitor-arm ', product: 'ergotron-lx' }, { item: '', product: '' }], checks: '6' };
    const built = buildClause(typed, 'USD', 'Keep prices fresh');
    expect(built.errors).toEqual([]);
    expect(built.clause).toEqual(watch([['monitor-arm', 'ergotron-lx']], 6));
    const bad = buildClause({ ...typed, items: [{ item: 'monitor-arm', product: 'not ok' }], checks: '0' }, 'USD', 'R');
    expect(bad.errors.join(' ')).toMatch(/letters, digits/);
    expect(bad.errors.join(' ')).toMatch(/checks a day must be 1–200/);
    expect(buildClause({ ...typed, items: [{ item: '', product: 'p-1' }] }, 'USD', 'R').errors.join(' ')).toMatch(/needs your item/);
    const back = draftFrom({
      payload: { id: fakeUlid('M-14'), version: 3, agent_key: '', not_before: NOW - 10, expires: NOW + 86_400, clauses: [watch([['monitor-27-4k', 'lg-27uk850-w']], 12)] },
      signature: '', agent: 'negotiator',
    } as never, NOW);
    expect(back.clauses).toContainEqual({ type: 'market_watch', items: [{ item: 'monitor-27-4k', product: 'lg-27uk850-w' }], checks: '12' });
    const problems = ruleProblems([watch([['dock', 'p']], 0)], NOW - 10, NOW + 10);
    expect(problems.find((p) => p.clause === 9)?.why).toBe('checks a day must be 1–200');
    expect(ruleSentence(watch([['monitor-arm', 'p']], 1))).toBe('keeps prices fresh for Monitor arm · up to 1 check a day');
  });

  it('the mock refuses what Rust refuses and the rule changes no answer', () => {
    const base = {
      id: fakeUlid('M-99'), version: 1, agent_key: '', not_before: 0, expires: NOW + 86_400,
      clauses: [
        { type: 'roles', roles: ['buy'] },
        { type: 'counterparties', rule: { type: 'paired' } },
        { type: 'per_deal', kind: 'haggle', max_amount: { minor: 50000, currency: 'USD' }, categories: ['office'] },
        { type: 'band', item_refs: ['dock'], floor: null, ceiling: { minor: 40000, currency: 'USD' }, max_rounds: 6, deadline: NOW + 3600 },
        { type: 'velocity', max_deals_day: 3, max_total_day: { minor: 90000, currency: 'USD' } },
        { type: 'human_present_over', amount: { minor: 30000, currency: 'USD' } },
        { type: 'payees', payees: ['north-desk'] },
      ],
    } as never as Parameters<typeof mockValidate>[0];
    expect(mockValidate(base)).toBeNull();
    expect(mockValidate({ ...base, clauses: [...base.clauses, watch([['dock', 'p-dock']], 12)] })).toBeNull();
    expect(mockValidate({ ...base, clauses: [...base.clauses, watch([['dock', 'p-dock']], 0)] })).toEqual({ clause: 9, reason: 'invalid price check allowance' });
  });

  it('says how many checks today, and when they are used up, with item names only', () => {
    expect(watchLine(fact())).toEqual({ checks: 'Price checks today: 3 of 12', rest: 'keeps monitor-27-4k fresh', usedUp: false });
    const used = watchLine(fact({ used_today: 12, used_up: true }));
    expect(used.rest).toMatch(/^used up until tomorrow/);
    expect(JSON.stringify(watchLine(fact()))).not.toContain('lg-27uk850-w');
  });

  it('claims "kept fresh" only for an open deal a rule in force watches', () => {
    const deal = { mandate_id: fakeUlid('M-14'), mandate_version: 3, terms: { item_ref: 'monitor-27-4k' }, side: 'buyer', state: 'NEGOTIATING', mode: 'live' } as never;
    expect(dealWatch([fact()], deal)).toEqual({ usedUp: false, used: 3, max: 12 });
    expect(dealWatch(null, deal)).toBeNull();
    expect(dealWatch([fact({ mandate_version: 2 })], deal)).toBeNull();
    expect(dealWatch([fact({ items: [{ item_ref: 'monitor-arm', product_id: 'p' }] })], deal)).toBeNull();
    expect(dealWatch([fact()], { ...(deal as object), mode: 'replay' } as never)).toBeNull();
    expect(dealWatch([fact()], { ...(deal as object), state: 'CAPTURED' } as never)).toBeNull();
    // A seller deal is watched only until its order exists.
    expect(dealWatch([fact()], { ...(deal as object), side: 'seller', state: 'AGREED' } as never)).not.toBeNull();
    expect(dealWatch([fact()], { ...(deal as object), side: 'seller', state: 'AWAITING_APPROVAL' } as never)).toBeNull();
    expect(watchWhy(null, true)).toBeNull();
    expect(watchWhy({ usedUp: false, used: 3, max: 12 }, true)).toBe('Kept fresh by your rules.');
    expect(watchWhy({ usedUp: false, used: 3, max: 12 }, false)).toMatch(/first check is on its way/);
    expect(watchWhy({ usedUp: true, used: 12, max: 12 }, true)).toMatch(/used up/);
  });

  it('owner facts carry the rules in force and today’s checks, to the main and approval windows only', async () => {
    for (const label of ['main', 'approval'] as const) {
      const facts = await mockBackend(label).invoke('owner_facts', null);
      const byMandate = Object.fromEntries(facts.market_watch.map((f) => [f.mandate_id, f]));
      expect(byMandate[fakeUlid('M-14')]).toMatchObject({ max_per_day: 12, used_today: 3, used_up: false, agent: 'negotiator' });
      expect(byMandate[fakeUlid('S-2')]).toMatchObject({ max_per_day: 6, used_today: 6, used_up: true });
    }
    await expect(mockBackend('tumbler').invoke('owner_facts', null)).rejects.toMatchObject({ code: 'PERMISSION' });
  });
});

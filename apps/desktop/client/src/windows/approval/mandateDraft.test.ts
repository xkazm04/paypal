import { describe, expect, it } from 'vitest';
import type { Clause } from '@bindings/Clause';
import { bandMissingSide, refusalWords, ruleProblems } from './mandateDraft';

const T = 1_800_000_000;
const usd = (major: number) => ({ minor: Math.round(major * 100), currency: 'USD' as const });
const draft = (roles: Extract<Clause, { type: 'roles' }>['roles'], kind: Extract<Clause, { type: 'per_deal' }>['kind'], floor: number | null, ceiling: number | null): Clause[] => [
  { type: 'roles', roles },
  { type: 'counterparties', rule: { type: 'paired' } },
  { type: 'per_deal', kind, max_amount: usd(200), categories: ['office'] },
  { type: 'band', item_refs: ['m27'], floor: floor === null ? null : usd(floor), ceiling: ceiling === null ? null : usd(ceiling), max_rounds: 6, deadline: T + 3600 },
  { type: 'velocity', max_deals_day: 12, max_total_day: usd(900) },
  { type: 'human_present_over', amount: usd(250) },
  { type: 'payees', payees: ['packrite'] },
];
const problems = (c: Clause[]) => ruleProblems(c, T, T + 86400);

describe('rules that could never allow anything', () => {
  it('refuses roles that cannot act on the kind of deal', () => {
    expect(problems(draft(['sell'], 'purchase', null, 340))).toMatchObject([{ clause: 1 }]);
    expect(problems(draft(['buy'], 'shop_order', null, 340))).toMatchObject([{ clause: 1 }]);
  });
  it('refuses a price range missing the side the roles use', () => {
    expect(problems(draft(['buy'], 'haggle', 58, null))).toMatchObject([{ clause: 4 }]);
    expect(problems(draft(['sell'], 'haggle', null, 340))).toMatchObject([{ clause: 4 }]);
  });
  it('allows the neighbours', () => {
    expect(problems(draft(['buy'], 'purchase', null, 340))).toEqual([]);
    expect(problems(draft(['buy', 'sell'], 'haggle', 58, null))).toEqual([]);
    expect(problems(draft(['shop'], 'shop_order', 58, null))).toEqual([]);
  });
});

describe('a refusal from signing, in plain words', () => {
  it('drops the rule number and uses the editor’s words', () => {
    const t = refusalWords('mandate clause 4: band lacks the side the allowed roles use');
    expect(t).toContain('agents that buy need a most-you’ll-pay');
    expect(t).not.toMatch(/clause|\d/);
  });
  it('never shows an unknown reason as it came', () => {
    expect(refusalWords('mandate clause 9: something new')).not.toContain('something new');
  });
});

describe('a band change that clears the side the deal uses', () => {
  it('names the missing bound', () => {
    expect(bandMissingSide('buyer', usd(58), null)).toContain('most-you’ll-pay');
    expect(bandMissingSide('seller', null, usd(340))).toContain('least-you’ll-accept');
  });
  it('is quiet when the side has its bound', () => {
    expect(bandMissingSide('buyer', null, usd(340))).toBeNull();
    expect(bandMissingSide('seller', usd(58), null)).toBeNull();
  });
});

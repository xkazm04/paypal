import { describe, expect, it } from 'vitest';
import type { Clause } from '@bindings/Clause';
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import type { Deal } from '@bindings/Deal';
import type { H256 } from '@bindings/H256';
import { counts, dealAmount, moved, previewDeal, replay, roleFor, roleMatches, verdictWhy, weekDeals, type Policy, type PreviewContext } from './preview';

const HASH = new Array(32).fill(0) as unknown as H256;
const usd = (major: number) => ({ minor: Math.round(major * 100), currency: 'USD' as const });
const NOW = 1_800_000_000;

function deal(o: Partial<Deal> & { price?: number; qty?: number; item?: string } = {}): Deal {
  const { price = 45, qty = 1, item = 'packing', ...rest } = o;
  return {
    id: 'D1', created_at: NOW - 3600, kind: 'purchase', side: 'buyer', counterparty: 'kp_pack',
    terms: { item_ref: item, qty, unit_price: usd(price), currency: 'USD', delivery: { type: 'ship_then_capture', days: 3 } },
    state: 'CAPTURED', mandate_id: 'M1', mandate_version: 1, transcript_head: HASH,
    paypal: { order: null, authorization: null, capture: null, subscription: null }, mode: 'sandbox', market: null, shield: null,
    ...rest,
  };
}
const cp = (key_id: string, house = false): CounterpartyDisplay => ({ key_id, display_name: key_id, house, first_seen: 0, deals_closed: 0, pairing: house ? 'house_pinned' : 'words_confirmed', declared_payee: null });
const ctx: PreviewContext = { now: NOW, counterparties: [cp('kp_pack'), cp('kp_house', true)] };

/** A complete purchase mandate: every required clause, all categories, no band. */
function purchase(over: Partial<Record<Clause['type'], Clause | null>> = {}): Clause[] {
  const base: Record<Clause['type'], Clause | null> = {
    roles: { type: 'roles', roles: ['buy'] },
    counterparties: { type: 'counterparties', rule: { type: 'paired' } },
    per_deal: { type: 'per_deal', kind: 'purchase', max_amount: usd(200), categories: ['office', 'parts', 'compute', 'service', 'other'] },
    band: null,
    velocity: { type: 'velocity', max_deals_day: 12, max_total_day: usd(900) },
    human_present_over: { type: 'human_present_over', amount: usd(250) },
    payees: { type: 'payees', payees: ['packrite'] },
  };
  return Object.values({ ...base, ...over }).filter((c): c is Clause => c !== null);
}
const policy = (clauses: Clause[]): Policy => ({ clauses, invalid: null });

describe('mandate preview · exact checks', () => {
  it('mirrors the wallet’s role choice and Rust’s role_ok table', () => {
    expect(roleFor('buyer', 'shop_order')).toBe('buy');
    expect(roleFor('seller', 'shop_order')).toBe('shop');
    expect(roleFor('seller', 'purchase')).toBe('sell');
    expect(roleMatches('buy', 'buyer', 'shop_order')).toBe(false);
    expect(roleMatches('sell', 'seller', 'purchase')).toBe(false);
    expect(roleMatches('rescue', 'seller', 'rescue')).toBe(true);
  });

  it('refuses everything at clause 0 without a mandate (revoked / none)', () => {
    const v = previewDeal(null, deal(), ctx);
    expect(v).toMatchObject({ outcome: 'refused', clause: 0 });
  });

  it('refuses a side/kind the role table forbids, before any clause', () => {
    expect(previewDeal(policy(purchase()), deal({ kind: 'shop_order' }), ctx)).toMatchObject({ outcome: 'refused', clause: 1, clauseExact: true });
  });

  it('refuses an amount over the per-deal max exactly (qty × unit price)', () => {
    const v = previewDeal(policy(purchase()), deal({ price: 70, qty: 3 }), ctx);
    expect(v).toMatchObject({ outcome: 'refused', clause: 3, clauseExact: true });
    expect(verdictWhy(v)).toContain('$210.00');
    expect(dealAmount(deal({ price: 70, qty: 3 }))).toBe(21000);
  });

  it('refuses another deal kind and another currency at clause 3', () => {
    const pd = purchase({ per_deal: { type: 'per_deal', kind: 'haggle', max_amount: usd(200), categories: ['office'] } });
    expect(previewDeal(policy(pd), deal(), ctx)).toMatchObject({ outcome: 'refused', clause: 3 });
    const eur = deal({ terms: { item_ref: 'x', qty: 1, unit_price: { minor: 100, currency: 'EUR' }, currency: 'EUR', delivery: { type: 'digital_now' } } });
    expect(previewDeal(policy(purchase()), eur, ctx)).toMatchObject({ outcome: 'refused', clause: 3 });
  });

  it('never shows an unknown check as passed: the payee keeps an in-limit purchase unknown', () => {
    const v = previewDeal(policy(purchase()), deal({ price: 45 }), ctx);
    expect(v.outcome).toBe('unknown');
    expect(v.ifPass).toBe('policy');
    expect(v.checks.find((c) => c.clause === 7)?.state).toBe('unknown');
    expect(v.checks.find((c) => c.clause === 5)?.state).toBe('unknown');
  });

  it('marks the category unknown unless every category is allowed', () => {
    const some = purchase({ per_deal: { type: 'per_deal', kind: 'purchase', max_amount: usd(200), categories: ['office'] } });
    expect(previewDeal(policy(some), deal(), ctx).checks.find((c) => c.clause === 3)?.state).toBe('unknown');
    expect(previewDeal(policy(purchase()), deal(), ctx).checks.find((c) => c.clause === 3)?.state).toBe('pass');
  });

  it('asks you over the human-present threshold (still unknown overall while the payee is)', () => {
    const big = purchase({ per_deal: { type: 'per_deal', kind: 'purchase', max_amount: usd(500), categories: ['office', 'parts', 'compute', 'service', 'other'] } });
    const v = previewDeal(policy(big), deal({ price: 300 }), ctx);
    expect(v.checks.find((c) => c.clause === 6)?.state).toBe('ask');
    expect(v).toMatchObject({ outcome: 'unknown', ifPass: 'asks' });
  });

  it('refuses a threshold in another currency at clause 6', () => {
    const v = previewDeal(policy(purchase({ human_present_over: { type: 'human_present_over', amount: { minor: 100, currency: 'EUR' } } })), deal(), ctx);
    expect(v).toMatchObject({ outcome: 'refused', clause: 6 });
  });

  it('refuses when the deal alone is over the daily money cap; daily usage otherwise stays unknown', () => {
    const v = previewDeal(policy(purchase({ velocity: { type: 'velocity', max_deals_day: 12, max_total_day: usd(40) } })), deal({ price: 45 }), ctx);
    expect(v).toMatchObject({ outcome: 'refused', clause: 5 });
  });

  it('reads the counterparty rule exactly from counterparty_list (word-confirmed only)', () => {
    expect(previewDeal(policy(purchase()), deal({ counterparty: 'kp_stranger' }), ctx)).toMatchObject({ outcome: 'refused', clause: 2 });
    const house = purchase({ counterparties: { type: 'counterparties', rule: { type: 'house' } } });
    expect(previewDeal(policy(house), deal(), ctx)).toMatchObject({ outcome: 'refused', clause: 2 });
    expect(previewDeal(policy(house), deal({ counterparty: 'kp_house' }), ctx).checks.find((c) => c.clause === 2)?.state).toBe('pass');
  });

  it('refuses a key outside the pinned list even when counterparty_list is unreadable', () => {
    const pinned = purchase({ counterparties: { type: 'counterparties', rule: { type: 'pinned', keys: ['kp_dan'] } } });
    expect(previewDeal(policy(pinned), deal(), { now: NOW, counterparties: null })).toMatchObject({ outcome: 'refused', clause: 2 });
  });

  it('keeps the counterparty unknown without counterparty_list, so a later refusal is not pinned to its clause', () => {
    const v = previewDeal(policy(purchase()), deal({ price: 250 }), { now: NOW, counterparties: null });
    expect(v).toMatchObject({ outcome: 'refused', clause: 3, clauseExact: false });
    expect(verdictWhy(v)).toContain('or an earlier unknown one');
  });

  describe('band (clause 4)', () => {
    const band = (o: Partial<Extract<Clause, { type: 'band' }>> = {}): Clause => ({ type: 'band', item_refs: ['monitor-27-4k'], floor: null, ceiling: usd(340), max_rounds: 6, deadline: NOW + 86400, ...o });
    const haggle = (price: number, o: Partial<Deal> = {}) => deal({ kind: 'haggle', item: 'monitor-27-4k', price, ...o });
    const hp = (b: Clause | null) => policy(purchase({ per_deal: { type: 'per_deal', kind: 'haggle', max_amount: usd(400), categories: ['office', 'parts', 'compute', 'service', 'other'] }, band: b }));

    it('refuses any item outside the band, purchases included (Rust’s band arm has no kind filter)', () => {
      expect(previewDeal(policy(purchase({ band: band() })), deal(), ctx)).toMatchObject({ outcome: 'refused', clause: 4 });
    });
    it('refuses a buyer price above the ceiling and a seller price below the floor, exactly', () => {
      expect(previewDeal(hp(band()), haggle(345), ctx)).toMatchObject({ outcome: 'refused', clause: 4, clauseExact: true });
      const sell = policy(purchase({ roles: { type: 'roles', roles: ['sell'] }, per_deal: { type: 'per_deal', kind: 'haggle', max_amount: usd(400), categories: ['office', 'parts', 'compute', 'service', 'other'] }, band: band({ floor: usd(300) }) }));
      expect(previewDeal(sell, haggle(290, { side: 'seller' }), ctx)).toMatchObject({ outcome: 'refused', clause: 4 });
    });
    it('refuses a buyer when the band has no ceiling', () => {
      expect(previewDeal(hp(band({ ceiling: null, floor: usd(100) })), haggle(200), ctx)).toMatchObject({ outcome: 'refused', clause: 4 });
    });
    it('keeps a price inside the band unknown (rounds used are not readable)', () => {
      const v = previewDeal(hp(band()), haggle(329), ctx);
      expect(v.outcome).toBe('unknown');
      expect(v.checks.find((c) => c.clause === 4)?.state).toBe('unknown');
    });
    it('refuses when the deadline had passed before the deal began; a deadline inside the deal is unknown', () => {
      expect(previewDeal(hp(band({ deadline: NOW - 7200 })), haggle(300), ctx)).toMatchObject({ outcome: 'refused', clause: 4 });
      expect(previewDeal(hp(band({ deadline: NOW - 60 })), haggle(300), ctx).checks.find((c) => c.clause === 4)?.why).toContain('ended');
    });
    it('refuses a haggle under a mandate without any band', () => {
      expect(previewDeal(hp(null), haggle(300), ctx)).toMatchObject({ outcome: 'refused', clause: 4 });
    });
  });

  it('refuses invalid terms at clause 3 (zero quantity)', () => {
    expect(previewDeal(policy(purchase()), deal({ qty: 0 }), ctx)).toMatchObject({ outcome: 'refused', clause: 3 });
  });

  it('treats an incomplete draft clause as unknown, and a draft Rust would refuse as refusing everything', () => {
    const v = previewDeal({ clauses: [...purchase({ human_present_over: null }), { type: 'human_present_over', incomplete: true }], invalid: null }, deal(), ctx);
    expect(v.checks.find((c) => c.clause === 6)?.state).toBe('unknown');
    expect(previewDeal({ clauses: purchase(), invalid: { clause: 5, why: 'clause 5 (velocity) is required' } }, deal(), ctx)).toMatchObject({ outcome: 'refused', clause: 5 });
  });
});

describe('mandate preview · replay', () => {
  it('detects moved verdicts but not a revoke over an already-refused deal', () => {
    const tight = policy(purchase({ per_deal: { type: 'per_deal', kind: 'purchase', max_amount: usd(40), categories: ['office', 'parts', 'compute', 'service', 'other'] } }));
    const a = previewDeal(policy(purchase()), deal(), ctx);
    const b = previewDeal(tight, deal(), ctx);
    expect(moved(a, b)).toBe(true);
    expect(moved(b, previewDeal(null, deal(), ctx))).toBe(false);
    const rows = replay([deal(), deal({ id: 'D2', price: 500 })], policy(purchase()), tight, ctx);
    expect(rows.map((r) => r.moved)).toEqual([true, false]);
    expect(counts(rows, 'signed')).toEqual({ refused: 1, asks: 0, policy: 0, unknown: 1 });
    expect(counts(rows, 'draft')).toEqual({ refused: 2, asks: 0, policy: 0, unknown: 0 });
  });

  it('keeps only this week’s deals of the mandate (all of the week for a new one)', () => {
    const ds = [deal({ id: 'a' }), deal({ id: 'b', mandate_id: 'M2' }), deal({ id: 'c', created_at: NOW - 8 * 86400 }), deal({ id: 'd', created_at: undefined })];
    expect(weekDeals(ds, 'M1', NOW).map((d) => d.id).sort()).toEqual(['a', 'd']);
    expect(weekDeals(ds, null, NOW).map((d) => d.id).sort()).toEqual(['a', 'b', 'd']);
  });
});

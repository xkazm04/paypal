import { describe, expect, it } from 'vitest';
import type { Clause } from '@bindings/Clause';
import type { Deal } from '@bindings/Deal';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import type { MarketRef } from '@bindings/MarketRef';
import type { Money } from '@bindings/Money';
import {
  buildCatalog, currencyMark, draftImpact, draftState, floorText, fmtShort, matchesFilter, minorToText, parseMoneyText, scaleOf, sellerMandates,
  stepFloor, underDraft, vsMarket, type CatalogRow,
} from './model';

const usd = (minor: number): Money => ({ minor, currency: 'USD' });
const H = Array.from({ length: 32 }, () => 0) as unknown as Deal['transcript_head'];

function deal(o: Partial<Deal> & { item: string; price: number; state?: Deal['state'] }): Deal {
  return {
    id: o.id ?? `D-${o.item}-${o.price}`, kind: 'shop_order', side: 'seller', counterparty: 'kp_x',
    terms: { item_ref: o.item, qty: 1, unit_price: usd(o.price), currency: 'USD', delivery: { type: 'ship_then_capture', days: 3 } },
    state: o.state ?? 'AWAITING_APPROVAL', mandate_id: 'M', mandate_version: 1, transcript_head: H,
    paypal: { order: null, authorization: null, capture: null, subscription: null }, mode: 'sandbox', market: o.market ?? null, shield: null,
    created_at: o.created_at, updated_at: o.updated_at,
  };
}
const market = (p25: number, med: number, p75: number, at = 1): MarketRef => ({ p25: usd(p25), median: usd(med), p75: usd(p75), retrieved_at: at, response_hash: H, cached: true });
function mandate(id: string, version: number, clauses: Clause[]): MandateListEntry {
  return { agent: 'shopper', owner_sig: [1], payload: { id, version, agent_key: H as unknown as MandateListEntry['payload']['agent_key'], clauses, not_before: 0, expires: 9 } };
}
const shopClauses = (floor: number | null, items = ['arm']): Clause[] => [
  { type: 'per_deal', kind: 'shop_order', max_amount: usd(100000), categories: [] },
  { type: 'band', item_refs: items, floor: floor === null ? null : usd(floor), ceiling: usd(20000), max_rounds: 3, deadline: 9 },
];

describe('price input mark', () => {
  it('puts the currency in front of a typed price: a symbol when there is one, else the code', () => {
    expect(currencyMark('USD')).toBe('$');
    expect(currencyMark('JPY')).toBe('JPY');
    expect(currencyMark('KWD')).toBe('KWD');
  });
});

describe('money text', () => {
  it('parses decimal strings exactly, never through floats', () => {
    expect(parseMoneyText('58', 'USD')).toBe(5800);
    expect(parseMoneyText('58.5', 'USD')).toBe(5850);
    expect(parseMoneyText(' $1,058.07 ', 'USD')).toBe(105807);
    expect(parseMoneyText('0.1', 'USD')).toBe(10);
    expect(parseMoneyText('58.505', 'USD')).toBeNull();
    expect(parseMoneyText('abc', 'USD')).toBeNull();
    expect(parseMoneyText('-5', 'USD')).toBeNull();
    expect(parseMoneyText('500', 'JPY')).toBe(500);
    expect(parseMoneyText('5.5', 'JPY')).toBeNull();
  });
  it('round-trips minor units to input text', () => {
    expect(minorToText(5800, 'USD')).toBe('58');
    expect(minorToText(5850, 'USD')).toBe('58.50');
    expect(minorToText(7, 'USD')).toBe('0.07');
    expect(fmtShort(5800, 'USD')).toBe('$58');
    expect(fmtShort(5850, 'USD')).toBe('$58.50');
  });
});

describe('catalog', () => {
  it('reads floors only from the latest version of a mandate that governs shop_order', () => {
    const list = [
      mandate('S', 1, shopClauses(5000)),
      mandate('S', 2, shopClauses(5800)),
      mandate('B', 1, [{ type: 'per_deal', kind: 'purchase', max_amount: usd(1), categories: [] }, { type: 'band', item_refs: ['arm'], floor: usd(1), ceiling: null, max_rounds: 1, deadline: 1 }]),
    ];
    const seller = sellerMandates(list);
    expect(seller.map((m) => `${m.payload.id}v${m.payload.version}`)).toEqual(['Sv2']);
    const rows = buildCatalog(seller, [], [], () => null);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.signed).toEqual(usd(5800));
    expect(rows[0]?.source).toEqual({ mandateId: 'S', version: 2, clause: 2 });
  });
  it('adds items from counter deals and takes the freshest market from any deal', () => {
    const d1 = deal({ id: 'a', item: 'dock', price: 9000, updated_at: 5 });
    const other = { ...deal({ id: 'b', item: 'dock', price: 1, market: market(80, 90, 99, 7) }), kind: 'purchase' as const };
    const old = { ...deal({ id: 'c', item: 'dock', price: 1, market: market(1, 2, 3, 3) }), kind: 'purchase' as const };
    const rows = buildCatalog([], [d1], [d1, other, old], (d) => `T-${d.id}`);
    expect(rows[0]).toMatchObject({ itemRef: 'dock', title: 'T-a', signed: null });
    expect(rows[0]?.market?.median).toEqual(usd(90));
  });
});

describe('vs market', () => {
  const m = market(6000, 6400, 7000);
  it('states facts only and never compares across currencies', () => {
    expect(vsMarket(usd(7100), m).cls).toBe('over');
    expect(vsMarket(usd(6500), m)).toMatchObject({ cls: 'above', short: '$1 over typical' });
    expect(vsMarket(usd(6400), m).cls).toBe('at');
    expect(vsMarket(usd(5800), m)).toMatchObject({ cls: 'under', short: '$6 under typical' });
    expect(vsMarket({ minor: 5800, currency: 'EUR' }, m).cls).toBe('none');
    expect(vsMarket(usd(5800), null).short).toBe('no market price');
    expect(vsMarket(null, m).cls).toBe('none');
  });
});

describe('the floor draft', () => {
  const row = (signed: number | null, deals: Deal[] = []): CatalogRow => ({ itemRef: 'arm', title: 'Arm', currency: 'USD', signed: signed === null ? null : usd(signed), ceiling: usd(20000), source: null, market: null, deals });

  it('lists changes and refuses bad amounts; equal to signed is no change', () => {
    const rows = [row(5800)];
    expect(draftState(rows, { arm: '58' }).diff).toHaveLength(0);
    expect(draftState(rows, { arm: '61' }).diff[0]).toMatchObject({ from: usd(5800), to: usd(6100) });
    expect(draftState(rows, { arm: '0' }).errors[0]?.error).toMatch(/above zero/);
    expect(draftState(rows, { arm: 'x' }).errors[0]?.error).toMatch(/enter an amount/);
    expect(draftState(rows, { arm: '201' }).errors[0]?.error).toMatch(/ceiling/);
    expect(draftState([row(null)], { arm: '' }).errors).toHaveLength(0);
    expect(draftState([row(null)], { arm: '40' }).diff[0]).toMatchObject({ from: null, to: usd(4000) });
  });
  it('steps by whole units and never below one unit or above the ceiling', () => {
    const r = row(5800);
    expect(floorText(r, {})).toBe('58');
    expect(stepFloor(r, {}, 100)).toBe('59');
    expect(stepFloor(r, { arm: '58.50' }, -1000)).toBe('48.50');
    expect(stepFloor(row(null), {}, -100)).toBe('1');
    expect(stepFloor(r, { arm: '199.50' }, 1000)).toBe('200');
  });
  it('previews which live quotes a raised floor withdraws; orders keep their terms', () => {
    const quote = deal({ id: 'q', item: 'arm', price: 6100, state: 'AGREED' });
    const order = deal({ id: 'o', item: 'arm', price: 5900, state: 'AWAITING_APPROVAL' });
    const done = deal({ id: 'd', item: 'arm', price: 5000, state: 'CAPTURED' });
    const r = row(5800, [quote, order, done]);
    const { diff } = draftState([r], { arm: '62' });
    expect(draftImpact(diff).map((x) => `${x.deal.id}:${x.kind}`)).toEqual(['q:withdraw', 'o:keeps']);
    expect(underDraft(quote, r, { arm: '62' })).toBe(true);
    expect(underDraft(quote, r, { arm: '60' })).toBe(false);
    expect(underDraft(order, r, { arm: '62' })).toBe(false);
    expect(matchesFilter(r, 'live', {})).toBe(true);
    expect(matchesFilter(r, 'draft', {})).toBe(false);
    expect(matchesFilter(r, 'draft', { arm: '62' })).toBe(true);
  });
});

describe('scale', () => {
  it('places every value inside the axis', () => {
    const x = scaleOf([5800, 6400, 7000]);
    expect(x).not.toBeNull();
    for (const v of [5800, 6400, 7000]) { const p = x!(v); expect(p).toBeGreaterThan(0); expect(p).toBeLessThan(100); }
    expect(scaleOf([])).toBeNull();
  });
});

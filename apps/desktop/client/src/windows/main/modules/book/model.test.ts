import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import { bucketOf, csvCell, decimal, LENSES, readQuery, runQuery, statementCounts, sums, toCSV, vsMedianPct, type Ctx } from './model';

const H = Array.from({ length: 32 }, () => 0) as unknown as Deal['transcript_head'];
function deal(id: string, o: Partial<Deal> & { price?: number; cur?: Deal['terms']['currency'] } = {}): Deal {
  const cur = o.cur ?? 'USD';
  return {
    id, kind: 'purchase', side: 'buyer', counterparty: 'kp', state: 'CAPTURED', mode: 'sandbox', mandate_id: 'M', mandate_version: 1, transcript_head: H,
    terms: { item_ref: 'x', qty: 1, unit_price: { minor: o.price ?? 1000, currency: cur }, currency: cur, delivery: { type: 'ship_then_capture', days: 1 } },
    paypal: { order: null, authorization: null, capture: null, subscription: null }, market: null, shield: null, ...o,
  };
}
const ctx: Ctx = { stmt: (d) => (d.paypal.capture ? 'matched' : 'not_applicable'), cpName: (d) => d.counterparty };

describe('money states', () => {
  it('puts every state in exactly one of the four buckets', () => {
    expect(bucketOf(deal('a', { state: 'RECEIPTED' }))).toBe('captured');
    expect(bucketOf(deal('a', { state: 'AUTHORIZED' }))).toBe('held');
    expect(bucketOf(deal('a', { state: 'VOIDED' }))).toBe('stopped');
    expect(bucketOf(deal('a', { state: 'REFUSED' }))).toBe('stopped');
    expect(bucketOf(deal('a', { state: 'NEGOTIATING' }))).toBe('motion');
    expect(bucketOf(deal('a', { state: 'AGREED', shield: 'HOLD' }))).toBe('motion');
    expect(bucketOf(deal('a', { state: 'AGREED', kind: 'rescue' }))).toBe('motion');
    expect(bucketOf(deal('a', { state: 'FAILED', kind: 'rescue' }))).toBe('stopped');
  });
  it('never adds states, directions or currencies together', () => {
    const s = sums([
      deal('a', { price: 100 }), deal('b', { price: 200, side: 'seller' }), deal('c', { price: 300, state: 'AUTHORIZED' }),
      deal('d', { price: 50, cur: 'EUR' }), deal('e', { price: 7, state: 'VOIDED' }),
    ]);
    expect(s.captured.out).toEqual([{ currency: 'USD', minor: 100 }, { currency: 'EUR', minor: 50 }]);
    expect(s.captured.in).toEqual([{ currency: 'USD', minor: 200 }]);
    expect(s.held.out).toEqual([{ currency: 'USD', minor: 300 }]);
    expect(s.stopped.out).toEqual([{ currency: 'USD', minor: 7 }]);
    expect(s.motion.out).toEqual([]);
  });
  it('measures distance from the market median only in the same currency', () => {
    const m = { p25: { minor: 90, currency: 'USD' as const }, median: { minor: 100, currency: 'USD' as const }, p75: { minor: 110, currency: 'USD' as const }, retrieved_at: 0, response_hash: H, cached: true };
    expect(vsMedianPct(deal('a', { price: 103, market: m }))).toBe(3);
    expect(vsMedianPct(deal('a', { price: 103, cur: 'EUR', market: m }))).toBeNull();
    expect(vsMedianPct(deal('a'))).toBeNull();
  });
});

describe('lenses', () => {
  const rows = [
    deal('a', { kind: 'haggle', state: 'NEGOTIATING' }), deal('b', { paypal: { order: '1', authorization: null, capture: 'C', subscription: null } }),
    deal('c', { state: 'REFUSED' }), deal('d', { state: 'MISMATCH', kind: 'haggle' }),
    deal('r1', { kind: 'rescue', side: 'seller', state: 'CAPTURED', price: 960 }), deal('r2', { kind: 'rescue', side: 'seller', state: 'CAPTURED', mode: 'replay', price: 960 }),
  ];
  const lens = (id: string) => LENSES.find((l) => l.id === id)!;
  it('groups by kind in the ledger’s order and keeps sums per state', () => {
    const r = runQuery(lens('week').query, rows, ctx);
    expect(r.groups.map((g) => g.label)).toEqual(['haggle', 'purchase', 'rescue']);
    expect(r.all.count).toBe(6);
  });
  it('reconciliation reads only captures; stopped and mismatch filter by state', () => {
    expect(runQuery(lens('pending').query, rows, ctx).rows.map((d) => d.id)).toEqual(['b']);
    expect(runQuery(lens('stopped').query, rows, ctx).rows.map((d) => d.id)).toEqual(['c', 'd']);
    expect(runQuery(lens('mismatch').query, rows, ctx).rows.map((d) => d.id)).toEqual(['d']);
  });
  it('recovered never counts REPLAY rows', () => {
    const r = runQuery(lens('rescue').query, rows, ctx);
    expect(r.rows.map((d) => d.id)).toEqual(['r1', 'r2']);
    expect(r.all.recovered).toEqual([{ currency: 'USD', minor: 960 }]);
  });
  it('groups policy vs me by the decided_by Rust recorded, and reads every query back in words', () => {
    expect(lens('decided').unavailable).toBeUndefined();
    const decided = [
      deal('p', { decided_by: { type: 'policy', clause: 6 } }), deal('s', { decided_by: { type: 'seller_mandate', mandate_hash: H } }),
      deal('o', { decided_by: { type: 'human', at: 1 } }), deal('t', { decided_by: { type: 'safe_default', deadline: 2 } }), deal('n'),
    ];
    const r = runQuery(lens('decided').query, decided, ctx);
    expect(Object.fromEntries(r.groups.map((g) => [g.key, g.count]))).toEqual({ policy: 2, you: 1, default: 1, none: 1 });
    for (const l of LENSES) expect(readQuery(l.query)[0]?.[0]).toBe('view');
  });
  it('counts statements', () => {
    expect(statementCounts(rows, ctx.stmt)).toMatchObject({ matched: 1, not_applicable: 5 });
  });
});

describe('csv', () => {
  it('writes exact decimals, neutralises formulas and carries the mode on every row', () => {
    expect(decimal(9000, 'USD')).toBe('90.00');
    expect(decimal(5, 'USD')).toBe('0.05');
    expect(decimal(500, 'JPY')).toBe('500');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('a,b')).toBe('"a,b"');
    const csv = toCSV([deal('a', { mode: 'replay', price: 960 })], { ...ctx, label: (d) => d.id }, '');
    expect(csv.split('\r\n')[1]?.startsWith('replay,a,')).toBe(true);
    expect(csv).toContain(',9.60,USD,');
  });
});

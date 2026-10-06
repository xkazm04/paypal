import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import { cellState, COLS, moveCell, recovered, retryLeft, rulesFor, splitRows } from './model';

const H = Array.from({ length: 32 }, () => 0) as unknown as Deal['transcript_head'];
function deal(id: string, o: Partial<Deal> = {}): Deal {
  return {
    id, kind: 'rescue', side: 'seller', counterparty: 'sub', state: 'FAILED', mode: 'sandbox', mandate_id: 'R', mandate_version: 1, transcript_head: H,
    terms: { item_ref: 'care-plan', qty: 1, unit_price: { minor: 960, currency: 'USD' }, currency: 'USD', delivery: { type: 'ship_then_capture', days: 0 } },
    paypal: { order: null, authorization: null, capture: null, subscription: 'I-1' }, market: null, shield: null, ...o,
  };
}
const NOW = 1_000_000;

describe('lever cells', () => {
  it('"do nothing" is always the default and names PayPal’s retry', () => {
    expect(cellState(deal('a'), 'NONE', NOW + 4 * 86400, NOW)).toEqual({ kind: 'default', sub: 'retry 4 d' });
    expect(cellState(deal('a'), 'NONE', null, NOW)).toEqual({ kind: 'default', sub: 'cycle unpaid' });
  });
  it('turns RETRY_AFTER_FIX off on REPLAY rows and when the retry is under 24 h; the rest stay unknown', () => {
    expect(cellState(deal('a', { mode: 'replay' }), 'RETRY_AFTER_FIX', NOW + 5 * 86400, NOW)).toMatchObject({ kind: 'off', code: 'REPLAY' });
    expect(cellState(deal('a'), 'RETRY_AFTER_FIX', NOW + 3600, NOW)).toMatchObject({ kind: 'off', code: 'retry <24h' });
    expect(cellState(deal('a'), 'RETRY_AFTER_FIX', NOW + 5 * 86400, NOW).kind).toBe('unknown');
    expect(cellState(deal('a', { mode: 'replay' }), 'DISCOUNT_THIS_CYCLE', NOW + 3600, NOW).kind).toBe('unknown');
  });
  it('lists the rules with honest unknowns and the R3 invariant', () => {
    const r = rulesFor(deal('a', { mode: 'replay' }), 'RETRY_AFTER_FIX', NOW + 3600, NOW);
    expect(r.filter(([k]) => k === 'x')).toHaveLength(2);
    expect(r.some(([k]) => k === 'unk')).toBe(true);
    expect(r.some(([, t]) => /the plan price stays the same for everyone/.test(t))).toBe(true);
  });
  it('formats the retry time as coarsely as the data', () => {
    expect(retryLeft(NOW + 17 * 3600 + 59 * 60, NOW)).toBe('17 h 59 m');
    expect(retryLeft(NOW - 1, NOW)).toBe('now');
  });
});

describe('rows and recovered', () => {
  it('splits failing (by retry), in flight and settled rescue rows only', () => {
    const rows = splitRows([
      deal('late'), deal('soon'), deal('inv', { kind: 'invoice', state: 'AWAITING_APPROVAL' }), deal('paid', { state: 'CAPTURED' }),
      { ...deal('other'), kind: 'purchase' },
    ], (d) => (d.id === 'soon' ? 10 : d.id === 'late' ? 20 : null));
    expect(rows.failing.map((d) => d.id)).toEqual(['soon', 'late']);
    expect(rows.inflight.map((d) => d.id)).toEqual(['inv']);
    expect(rows.settled.map((d) => d.id)).toEqual(['paid']);
  });
  it('counts only settled, non-REPLAY, non-scripted rescue money, per currency', () => {
    const r = recovered([
      deal('a', { state: 'CAPTURED' }), deal('b', { state: 'RECONCILED', kind: 'invoice' }),
      deal('c', { state: 'CAPTURED', mode: 'replay' }), deal('d', { state: 'CAPTURED', mode: 'scripted_engine' }),
      deal('e', { state: 'CAPTURED', terms: { ...deal('x').terms, unit_price: { minor: 500, currency: 'EUR' } } }),
      deal('f'),
    ]);
    expect(r.counted.map((d) => d.id)).toEqual(['a', 'b', 'e']);
    expect(r.totals).toEqual([{ currency: 'USD', minor: 1920 }, { currency: 'EUR', minor: 500 }]);
    expect(r.notCounted.map((x) => x.deal.id)).toEqual(['c', 'd', 'f']);
  });
});

describe('matrix keys', () => {
  const rows = ['a', 'b'];
  it('moves within the grid and stops at its edges', () => {
    expect(moveCell(rows, { id: 'a', col: 'NONE' }, 'ArrowRight')).toEqual({ id: 'a', col: COLS[1] });
    expect(moveCell(rows, { id: 'a', col: 'NONE' }, 'ArrowLeft')).toBeNull();
    expect(moveCell(rows, { id: 'a', col: 'PAUSE' }, 'ArrowDown')).toEqual({ id: 'b', col: 'PAUSE' });
    expect(moveCell(rows, { id: 'b', col: 'PAUSE' }, 'ArrowDown')).toBeNull();
    expect(moveCell(rows, { id: 'b', col: 'PAUSE' }, '0')).toEqual({ id: 'b', col: 'NONE' });
    expect(moveCell(rows, { id: 'b', col: 'NONE' }, '4')).toEqual({ id: 'b', col: 'DOWNGRADE' });
    expect(moveCell(rows, { id: 'b', col: 'NONE' }, 'x')).toBeNull();
  });
});

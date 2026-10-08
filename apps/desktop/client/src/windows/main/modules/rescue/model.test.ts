import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import { atRiskOf, cellState, COLS, moveCell, NOT_BUILT, pickable, recovered, retryLeft, rulesFor, splitFixes, splitRows } from './model';
import { invoiceText, proposeDiscount } from '../../../../mock/rescue';
import type { RescueView } from '@bindings/RescueView';

const H = Array.from({ length: 32 }, () => 0) as unknown as Deal['transcript_head'];
function deal(id: string, o: Partial<Deal> = {}): Deal {
  return {
    id, kind: 'rescue', side: 'seller', counterparty: 'sub', state: 'AGREED', mode: 'sandbox', mandate_id: 'R', mandate_version: 1, transcript_head: H,
    terms: { item_ref: 'care-plan', qty: 1, unit_price: { minor: 960, currency: 'USD' }, currency: 'USD', delivery: { type: 'ship_then_capture', days: 0 } },
    paypal: { order: null, authorization: null, capture: null, subscription: 'I-1' }, market: null, shield: null, ...o,
  };
}
const NOW = 1_000_000;
const offer = proposeDiscount({ minor: 1200, currency: 'USD' }, { max_discount_bp: 2000, max_discount: { minor: 500, currency: 'USD' } })!;
const view = (id: string, o: Partial<RescueView> = {}): RescueView => ({ deal_id: id, source: 'paypal', offer, text: invoiceText(offer), failed_payments: 1, recipient: 's•••@example.com', counted: false, ...o });

describe('lever cells', () => {
  it('"do nothing" is always the default and names PayPal’s retry', () => {
    expect(cellState(deal('a'), 'NONE', NOW + 4 * 86400, NOW)).toEqual({ kind: 'default', sub: 'retry 4 d' });
    expect(cellState(deal('a'), 'NONE', null, NOW)).toEqual({ kind: 'default', sub: 'cycle unpaid' });
  });
  it('offers the wallet’s discount, turns RETRY_AFTER_FIX off on REPLAY rows and near a retry, and the rest are not built', () => {
    expect(cellState(deal('a', { mode: 'replay' }), 'RETRY_AFTER_FIX', NOW + 5 * 86400, NOW)).toMatchObject({ kind: 'off', code: 'REPLAY' });
    expect(cellState(deal('a'), 'RETRY_AFTER_FIX', NOW + 3600, NOW)).toMatchObject({ kind: 'off', code: 'retry <24h' });
    expect(cellState(deal('a'), 'RETRY_AFTER_FIX', NOW + 5 * 86400, NOW)).toEqual({ kind: 'off', code: 'NOT_BUILT', why: NOT_BUILT });
    expect(cellState(deal('a'), 'PAUSE', NOW + 5 * 86400, NOW, view('a')).kind).toBe('off');
    expect(cellState(deal('a', { mode: 'replay' }), 'DISCOUNT_THIS_CYCLE', NOW + 3600, NOW).kind).toBe('unknown');
    const st = cellState(deal('a', { mode: 'replay' }), 'DISCOUNT_THIS_CYCLE', NOW + 3600, NOW, view('a'));
    expect(st).toEqual({ kind: 'offer', offer });
    expect(pickable(st)).toBe(true);
    expect(pickable(cellState(deal('a'), 'DOWNGRADE', null, NOW, view('a')))).toBe(false);
  });
  it('lists the rules with the R3 invariant; a fix that is not built is refused', () => {
    const r = rulesFor(deal('a', { mode: 'replay' }), 'RETRY_AFTER_FIX', NOW + 3600, NOW);
    expect(r.filter(([k]) => k === 'x')).toHaveLength(3);
    expect(r.some(([, t]) => /the plan price stays the same for everyone/.test(t))).toBe(true);
    const d = rulesFor(deal('a', { mode: 'replay' }), 'DISCOUNT_THIS_CYCLE', null, NOW, view('a'));
    expect(d.every(([k]) => k === 'ok')).toBe(true);
    expect(d.some(([, t]) => /never counted/.test(t))).toBe(true);
    expect(rulesFor(deal('a'), 'DISCOUNT_THIS_CYCLE', null, NOW).some(([k]) => k === 'unk')).toBe(true);
  });
  it('formats the retry time as coarsely as the data', () => {
    expect(retryLeft(NOW + 17 * 3600 + 59 * 60, NOW)).toBe('17 h 59 m');
    expect(retryLeft(NOW - 1, NOW)).toBe('now');
  });
});

describe('rows and recovered', () => {
  it('splits failing (by retry), in flight and settled rescue rows only', () => {
    const rows = splitRows([
      deal('late'), deal('soon'), deal('inv', { kind: 'invoice', state: 'AWAITING_APPROVAL' }), deal('paid', { state: 'RECEIPTED' }),
      deal('sending', { state: 'SETTLING' }), deal('cancelled', { state: 'FAILED' }), { ...deal('other'), kind: 'purchase' },
    ], (d) => (d.id === 'soon' ? 10 : d.id === 'late' ? 20 : null));
    expect(rows.failing.map((d) => d.id)).toEqual(['soon', 'late']);
    expect(rows.inflight.map((d) => d.id)).toEqual(['inv', 'sending']);
    expect(rows.settled.map((d) => d.id)).toEqual(['paid', 'cancelled']);
  });
  it('counts only what the wallet counts: never a replay, a practice row, a failing renewal or an invoice only sent', () => {
    const ds = [
      deal('a', { state: 'RECEIPTED' }), deal('c', { state: 'RECEIPTED', mode: 'replay' }), deal('d', { state: 'RECEIPTED', mode: 'scripted_engine' }),
      deal('s', { state: 'AWAITING_APPROVAL' }), deal('u', { state: 'RECEIPTED' }), deal('f'),
    ];
    const book = { cases: [view('a', { counted: true }), view('c', { source: 'replay' }), view('u')], recovered: [{ minor: 960, currency: 'USD' as const }] };
    const r = recovered(ds, book);
    expect(r.counted.map((d) => d.id)).toEqual(['a']);
    expect(r.totals).toEqual([{ minor: 960, currency: 'USD' }]);
    expect(r.notCounted.map((x) => [x.deal.id, x.why])).toEqual([['c', 'REPLAY'], ['d', 'scripted'], ['s', 'sent'], ['u', 'unverified'], ['f', 'failing']]);
    // Without the wallet's read nothing counts, even a receipted rescue.
    expect(recovered(ds, null)).toMatchObject({ counted: [], totals: [] });
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

describe('the card shows only the fixes open to this renewal (polish 3)', () => {
  it('cards are doing nothing and the discount; the switched-off fixes fold into one line, each with its reason', () => {
    const replay = splitFixes(deal('a', { mode: 'replay' }), NOW + 5 * 86400, NOW, view('a'));
    expect(replay.open).toEqual(['NONE', 'DISCOUNT_THIS_CYCLE']);
    expect(replay.off.map((o) => [o.col, o.code])).toEqual([['PAUSE', 'NOT_BUILT'], ['RETRY_AFTER_FIX', 'REPLAY'], ['DOWNGRADE', 'NOT_BUILT']]);
    for (const o of replay.off) expect(o.why.length).toBeGreaterThan(0);
    // Doing nothing is never folded away, and every column is either a card or in the line.
    const soon = splitFixes(deal('a'), NOW + 3600, NOW, view('a'));
    expect(soon.open[0]).toBe('NONE');
    expect([...soon.open, ...soon.off.map((o) => o.col)].sort()).toEqual([...COLS].sort());
    expect(soon.off.find((o) => o.col === 'RETRY_AFTER_FIX')?.code).toBe('retry <24h');
  });
  it('a discount the wallet has not shown yet stays a (dashed) card, never folded as unavailable', () => {
    expect(splitFixes(deal('a'), NOW + 5 * 86400, NOW, null).open).toContain('DISCOUNT_THIS_CYCLE');
  });
});

describe('what a failed renewal puts at risk (polish 3)', () => {
  it('is the missed cycle at the plan price, never the discounted invoice, so Book and Rescue agree', () => {
    const d = deal('a'); // the deal's terms carry the $9.60 invoice
    expect(atRiskOf(d, { cases: [view('a')] })).toEqual({ minor: 1200, currency: 'USD' });
    // Without the wallet's read it falls back to the deal's own terms.
    expect(atRiskOf(d, null)).toEqual({ minor: 960, currency: 'USD' });
    expect(atRiskOf(d, { cases: [view('other')] })).toEqual({ minor: 960, currency: 'USD' });
  });
});

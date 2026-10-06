import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import { ago, bandGeometry, checkCell, CHECKS, moveCursor, overMedian, paypalLine, reasonsFor, releasable, ROWS, shieldNeed, UNSHOWN } from './matrix';

const usd = (d: number) => ({ minor: d * 100, currency: 'USD' as const });
const NONE = { order: null, authorization: null, capture: null, subscription: null };
const NOW = 1_800_000_000;
const deal = (o: Partial<Deal> = {}): Deal => ({
  id: 'D', kind: 'purchase', side: 'buyer', counterparty: 'K', state: 'AGREED', mandate_id: 'M', mandate_version: 3,
  transcript_head: [] as unknown as Deal['transcript_head'], paypal: NONE, mode: 'sandbox', market: null, shield: null,
  terms: { item_ref: 'x', qty: 1, unit_price: usd(460), currency: 'USD', delivery: { type: 'digital_now' } }, ...o,
});
const market = { p25: usd(301), median: usd(318), p75: usd(336), retrieved_at: NOW, response_hash: [] as unknown as Deal['transcript_head'], cached: false };

describe('grid shape', () => {
  it('puts the conclusion first, then the checks it can show, then their words; the rest is one line', () => {
    expect(ROWS).toEqual(['head', 'verdict', 'paypal', 'move', 'newcp', 'market', 'words']);
    expect(CHECKS.map((c) => c.k)).toEqual(['payee', 'ff', 'newcp', 'market', 'typology']);
    expect(UNSHOWN).toEqual(['payee', 'ff', 'typology']);
    for (const k of UNSHOWN) expect(checkCell(k, deal(), undefined, NOW).r).toBe('na');
  });
  it('clamps the cursor to the grid', () => {
    expect(moveCursor({ r: 0, c: 0 }, -1, -1, 10, 3)).toEqual({ r: 0, c: 0 });
    expect(moveCursor({ r: 9, c: 2 }, 1, 1, 10, 3)).toEqual({ r: 9, c: 2 });
    expect(moveCursor({ r: 4, c: 1 }, 1, -1, 10, 3)).toEqual({ r: 5, c: 0 });
  });
});

describe('check cells say only what the client knows', () => {
  it('never claims a pass for checks whose result is not exposed', () => {
    for (const k of ['payee', 'ff', 'typology'] as const) expect(checkCell(k, deal(), undefined, NOW).r).toBe('na');
  });
  it('reads new-counterparty facts from counterparty_list', () => {
    const cp = { key_id: 'K', display_name: 'pixel-bay', house: false, first_seen: NOW - 3600, deals_closed: 0, pairing: 'words_confirmed' as const, declared_payee: 'pixel-bay' };
    expect(checkCell('newcp', deal(), cp, NOW)).toMatchObject({ r: 'fact', s: 'New: first deal today' });
    expect(checkCell('newcp', deal(), { ...cp, first_seen: NOW - 17 * 86400, deals_closed: 1 }, NOW).s).toBe('1 deal before');
    expect(checkCell('newcp', deal(), undefined, NOW).r).toBe('na');
    expect(ago(NOW - 17 * 86400, NOW)).toBe('17 days ago');
    expect(ago(NOW - 86400, NOW)).toBe('1 day ago');
  });
  it('measures the price against the market median, or says it was skipped', () => {
    expect(overMedian(deal({ market }))).toBe(45);
    expect(checkCell('market', deal({ market }), undefined, NOW)).toMatchObject({ r: 'fact', s: '45% above typical' });
    expect(checkCell('market', deal({ market }), undefined, NOW).l).toContain('$445.20');
    expect(checkCell('market', deal({ market: { ...market, median: usd(460) } }), undefined, NOW).s).toBe('typical price');
    expect(checkCell('market', deal(), undefined, NOW)).toMatchObject({ r: 'skip', s: 'no price to compare' });
  });
});

describe('why a payment was paused', () => {
  const cp = { key_id: 'K', display_name: 'pixel-bay', house: false, first_seen: NOW - 3600, deals_closed: 0, pairing: 'words_confirmed' as const, declared_payee: 'pixel-bay' };
  it('names a far-above-typical price and a brand-new payee, in that order', () => {
    expect(reasonsFor(deal({ market }), cp, NOW).map((r) => r.text)).toEqual(['45% above the usual price', 'New payee: first deal today']);
  });
  it('does not call a normal price or an old payee a reason', () => {
    const near = deal({ market: { ...market, median: usd(450) } });
    expect(reasonsFor(near, { ...cp, first_seen: NOW - 9 * 86400 }, NOW).map((r) => r.icon)).toEqual(['shield']);
  });
  it('asks honestly when there is nothing to compare, and when the payee is unknown', () => {
    expect(reasonsFor(deal(), undefined, NOW).map((r) => r.text)).toEqual(['No usual price to compare with, so it asks you', 'The wallet has no record of this payee']);
  });
});

describe('PayPal line and release', () => {
  it('says nothing was sent for blocks, refusals and live holds without PayPal ids', () => {
    expect(paypalLine(deal({ shield: 'BLOCK', state: 'REFUSED' }))).toEqual(['Nothing sent', 'no PayPal link ever opened']);
    expect(paypalLine(deal({ shield: 'HOLD' }))).toEqual(['Nothing sent', 'paused before PayPal was asked']);
    expect(paypalLine(deal({ shield: 'CLEAR', state: 'NEGOTIATING', kind: 'haggle' }))[0]).toBe('Nothing sent yet');
    expect(paypalLine(deal({ shield: 'HOLD', state: 'MISMATCH', kind: 'haggle' }))[0]).toBe('Nothing sent');
    expect(paypalLine(deal({ shield: 'CLEAR', state: 'AWAITING_APPROVAL', paypal: { ...NONE, order: 'O' } }))[0]).toBe('Order made');
  });
  it('acts only on decisions that belong to the shield', () => {
    const tables = { module: 'tables' }, shield = { module: 'shield' };
    expect(shieldNeed(deal({ shield: 'CLEAR', kind: 'haggle', state: 'NEGOTIATING' }), tables)).toBeUndefined();
    expect(shieldNeed(deal({ shield: 'HOLD' }), tables)).toBe(tables);
    expect(shieldNeed(deal({ shield: 'BLOCK', state: 'REFUSED' }), shield)).toBe(shield);
    expect(shieldNeed(deal({ shield: 'HOLD' }), undefined)).toBeUndefined();
  });
  it('offers release only for a live HOLD', () => {
    expect(releasable(deal({ shield: 'HOLD' }))).toBe(true);
    expect(releasable(deal({ shield: 'HOLD', state: 'MISMATCH', kind: 'haggle' }))).toBe(false);
    expect(releasable(deal({ shield: 'BLOCK' }))).toBe(false);
    expect(releasable(deal({ shield: 'CLEAR' }))).toBe(false);
  });
});

describe('market band geometry', () => {
  it('orders IQR, median, flag and price left to right inside the box', () => {
    const g = bandGeometry(deal({ market }))!;
    expect(g.iqr[0]).toBeLessThan(g.median);
    expect(g.median).toBeLessThan(g.iqr[1]);
    expect(g.iqr[1]).toBeLessThan(g.flag);
    expect(g.flag).toBeLessThan(g.price);
    expect(g.price).toBeLessThanOrEqual(100);
    expect(g.iqr[0]).toBeGreaterThanOrEqual(0);
    expect(g.pct).toBe(45);
    expect(bandGeometry(deal())).toBeNull();
  });
});

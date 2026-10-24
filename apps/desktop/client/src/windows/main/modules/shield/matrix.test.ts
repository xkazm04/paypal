import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import { formatMinor } from '../../../../lib/format';
import { ago, bandGeometry, checkCell, CHECKS, overMedian, overPauseLine, paypalLine, NOT_ACTIVE, reasonsFor, releasable, releaseCase, shieldNeed, UNSHOWN } from './matrix';

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
    expect(CHECKS.map((c) => c.k)).toEqual(['payee', 'ff', 'newcp', 'market', 'typology']);
    expect(UNSHOWN).toEqual(['payee']);
    expect(NOT_ACTIVE).toEqual(['ff', 'typology']);
    for (const k of [...UNSHOWN, ...NOT_ACTIVE]) expect(checkCell(k, deal(), undefined, NOW).r).toBe('na');
  });
});

describe('check cells say only what the client knows', () => {
  it('never claims a pass for checks whose result is not exposed', () => {
    for (const k of ['payee', 'ff', 'typology'] as const) expect(checkCell(k, deal(), undefined, NOW).r).toBe('na');
  });
  it('says plainly that friends & family and the message check are not active yet, never that they ran', () => {
    for (const k of NOT_ACTIVE) {
      for (const d of [deal(), deal({ shield: 'CLEAR' }), deal({ shield: 'HOLD', shield_rule: 'price_over_market' })]) {
        const c = checkCell(k, d, undefined, NOW);
        expect(c).toMatchObject({ r: 'na', s: 'not active yet' });
        expect(c.l).toMatch(/does not run this check yet/);
        expect(c.l).not.toMatch(/\bran\b|has passed|was passed/);
      }
    }
    expect(CHECKS.filter((c) => NOT_ACTIVE.includes(c.k)).every((c) => /^Not active yet/.test(c.kind))).toBe(true);
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

describe('the stated pause line is the enforced one', () => {
  // Rust holds when price * 10 > median * 14, so the last price that passes is floor(median * 14 / 10).
  const at = (m: number, price: number) => deal({ market: { ...market, p25: { minor: 1, currency: 'USD' }, median: { minor: m, currency: 'USD' }, p75: { minor: m * 2, currency: 'USD' } }, terms: { ...deal().terms, unit_price: { minor: price, currency: 'USD' } } });
  it('names, in the copy, the last price the shield lets through, for every median', () => {
    for (let m = 1; m <= 1000; m++) {
      const line = Math.floor((m * 14) / 10);
      expect(overPauseLine(at(m, line)), `median ${m}`).toBe(false);
      expect(overPauseLine(at(m, line + 1)), `median ${m}`).toBe(true);
      expect(checkCell('market', at(m, line), undefined, NOW).l, `median ${m}`).toContain(`Above ${formatMinor(line, 'USD')} the shield pauses`);
    }
  });
});

describe('releaseCase', () => {
  it('tells a buyer hold, a seller hold the buyer approved, and a seller hold still waiting', () => {
    const h = (o: Partial<Deal>) => releaseCase(deal({ shield: 'HOLD', ...o }));
    expect(h({ side: 'buyer', state: 'AGREED' })).toBe('buyer');
    expect(h({ side: 'buyer', state: 'APPROVED' })).toBe('buyer');
    expect(h({ side: 'seller', state: 'APPROVED' })).toBe('seller-approved');
    expect(h({ side: 'seller', state: 'AUTHORIZED' })).toBe('seller-approved');
    expect(h({ side: 'seller', state: 'NEGOTIATING' })).toBe('seller-waiting');
    expect(h({ side: 'seller', state: 'AGREED' })).toBe('seller-waiting');
  });
});

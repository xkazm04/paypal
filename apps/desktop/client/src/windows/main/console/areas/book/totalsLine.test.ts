// Money honesty in the grid's totals, groups and chart: never a sum across currencies or across money
// in and out; only what PayPal confirmed is paid; a payment being checked is neither paid nor held.
import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import { formatMinor } from '../../../../../lib/format';
import { BOOK } from '../../../../../lib/words';
import { spendingSeries } from './spending';
import { totalsLine } from './totalsLine';

const deal = (id: string, state: Deal['state'], side: Deal['side'], minor: number, currency: 'USD' | 'EUR', at = 1_780_000_000): Deal => ({
  id, state, side, kind: 'purchase', mode: 'sandbox', created_at: at, updated_at: at, shield: null, paypal: {},
  terms: { unit_price: { minor, currency }, qty: 1, currency, item_ref: 'x' },
} as unknown as Deal);
const none = () => false;

describe('totalsLine', () => {
  const usd = (n: number) => formatMinor(n, 'USD');
  const eur = (n: number) => formatMinor(n, 'EUR');

  it('keeps each currency and each direction its own figure, and never adds them', () => {
    const rows = [
      deal('a', 'CAPTURED', 'buyer', 1000, 'USD'), deal('b', 'CAPTURED', 'buyer', 500, 'USD'),
      deal('c', 'CAPTURED', 'buyer', 700, 'EUR'), deal('d', 'CAPTURED', 'seller', 200, 'USD'),
    ];
    const line = totalsLine(rows, none);
    expect(line).toBe(`${BOOK.tiles.out} ${usd(1500)} · ${eur(700)}, ${BOOK.tiles.in} ${usd(200)}`);
    // No figure mixing currency (2200) or direction (1700).
    expect(line).not.toContain(usd(1700));
    expect(line).not.toContain(usd(2200));
    expect(line).not.toContain(usd(2400));
  });

  it('never counts a hold as paid', () => {
    const line = totalsLine([deal('a', 'CAPTURED', 'buyer', 1000, 'USD'), deal('b', 'AUTHORIZED', 'buyer', 300, 'USD')], none);
    expect(line).toBe(`${BOOK.tiles.out} ${usd(1000)}, ${BOOK.tiles.held} ${usd(300)}`);
    expect(line).not.toContain(usd(1300));
  });

  it('counts a payment being checked as neither paid nor held', () => {
    const checking = (d: Deal) => d.id === 'c' || d.id === 'h';
    const line = totalsLine([deal('a', 'CAPTURED', 'buyer', 1000, 'USD'), deal('c', 'CAPTURED', 'buyer', 700, 'USD'), deal('h', 'AUTHORIZED', 'buyer', 300, 'USD')], checking);
    expect(line).toBe(`${BOOK.tiles.out} ${usd(1000)}, ${BOOK.checkingShort(2)}`);
    expect(line).not.toContain(usd(1700));
    expect(line).not.toContain(usd(300));
  });

  it('says the dash when no money moved or is held', () => {
    expect(totalsLine([deal('a', 'REFUSED', 'buyer', 900, 'USD'), deal('b', 'NEGOTIATING', 'buyer', 900, 'USD')], none)).toBe(BOOK.dash);
    expect(totalsLine([], none)).toBe(BOOK.dash);
  });

  it('counts only what is confirmed, in a group as in the whole (a seller’s word is not paid)', () => {
    expect(totalsLine([deal('a', 'UNCONFIRMED', 'buyer', 900, 'USD')], none)).toBe(BOOK.dash);
  });
});

describe('spendingSeries', () => {
  const DAY = 86_400;
  const t0 = 1_780_000_000;
  it('is one series per currency, paid out only, never a sum of the two', () => {
    const rows = [
      deal('a', 'CAPTURED', 'buyer', 1000, 'USD', t0), deal('b', 'CAPTURED', 'buyer', 500, 'USD', t0 + DAY),
      deal('c', 'CAPTURED', 'buyer', 700, 'EUR', t0), deal('in', 'CAPTURED', 'seller', 900, 'USD', t0),
      deal('hold', 'AUTHORIZED', 'buyer', 900, 'USD', t0), deal('checked', 'CAPTURED', 'buyer', 900, 'USD', t0),
    ];
    const series = spendingSeries(rows, (d) => d.id === 'checked');
    expect(series.map((s) => [s.currency, s.total])).toEqual([['USD', 1500], ['EUR', 700]]);
    expect(series[0]?.points.map((p) => p.minor)).toEqual([1000, 500]);
  });
  it('counts weeks when the days would not fit, and fills the gaps', () => {
    const rows = [deal('a', 'CAPTURED', 'buyer', 100, 'USD', t0), deal('b', 'CAPTURED', 'buyer', 200, 'USD', t0 + 100 * DAY)];
    const [s] = spendingSeries(rows, none);
    expect(s?.byWeek).toBe(true);
    expect(s?.points.reduce((a, p) => a + p.minor, 0)).toBe(300);
    expect(s?.points.length).toBeGreaterThan(10);
  });
  it('is empty when nothing was paid out', () => {
    expect(spendingSeries([deal('a', 'CAPTURED', 'seller', 100, 'USD')], none)).toEqual([]);
  });
});

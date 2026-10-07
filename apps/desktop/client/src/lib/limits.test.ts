// T14 client meter logic: the bar turns gold near the limit, nothing is summed across currencies,
// the states say what the owner must do, and the sign form never parses through floats.
import { describe, expect, it } from 'vitest';
import type { CurrencyExposure } from '@bindings/CurrencyExposure';
import type { ExposureView } from '@bindings/ExposureView';
import { parseMoneyInput } from '../windows/approval/model';
import { buildLimits, meterFill, meterRow, nearLimit, readLimits } from './limits';

const usd = (minor: number) => ({ minor, currency: 'USD' as const });
const row = (out: number, held: number, committed: number, deals: number, currency: 'USD' | 'EUR' = 'USD'): CurrencyExposure => ({
  currency, paid_today: { minor: 0, currency }, held: { minor: held, currency }, committed: { minor: committed, currency }, out_today: { minor: out, currency }, deals_today: deals,
});
const view = (over: Partial<ExposureView> = {}): ExposureView => ({
  status: 'active',
  limits: { version: 1, currency: 'USD', max_out_day: usd(3000), max_held: usd(15000), max_deals_day: 5, expires: 2_000_000_000 },
  signed_at: 1_800_000_000,
  currencies: [row(2400, 6400, 0, 2)],
  day_start: 1_799_971_200,
  ...over,
});

describe('wallet limit meters', () => {
  it('turns gold at four fifths of the limit, exactly, without float rounding', () => {
    expect(nearLimit(2399, 3000)).toBe(false);
    expect(nearLimit(2400, 3000)).toBe(true);
    expect(nearLimit(3600, 3000)).toBe(true);
    expect(nearLimit(10, 0)).toBe(false);
    expect(meterFill(10, null)).toEqual({ fill: null, near: false });
    expect(meterFill(1500, 3000)).toEqual({ fill: 0.5, near: false });
  });

  it('reads the three meters against the signed limits', () => {
    const r = readLimits(view())!;
    expect(r.status).toBe('active');
    const [out, held, deals] = r.meters;
    expect(out).toMatchObject({ key: 'out', label: 'Paid out today', value: '$24.00', of: 'of $30 a day', fill: 0.8, near: true });
    expect(held).toMatchObject({ key: 'held', value: '$64.00', of: 'of $150 at once', near: false });
    expect(deals).toMatchObject({ key: 'deals', value: '2', of: 'of 5 a day', near: false });
    expect(r.line).toMatch(/^Wallet limits you signed, until /);
    // No ids, no clause numbers, no field names on screen.
    for (const m of r.meters) expect(`${m.label} ${m.of} ${m.why}`).not.toMatch(/max_|clause|envelope|\bid\b/);
  });

  it('with no limit signed it still shows the money out, and says there is no wallet limit', () => {
    const r = readLimits(view({ status: 'none', limits: null, signed_at: null }))!;
    expect(r.meters.map((m) => [m.value, m.of, m.fill])).toEqual([['$24.00', null, null], ['$64.00', null, null], ['2', null, null]]);
    expect(r.line).toMatch(/^No wallet limit/);
  });

  it('never adds up two currencies without a limit to choose one', () => {
    const mixed = view({ status: 'none', limits: null, currencies: [row(100, 0, 0, 1, 'EUR'), row(200, 0, 0, 1)] });
    expect(meterRow(mixed)).toBeNull();
    expect(readLimits(mixed)).toMatchObject({ mixed: true, meters: [] });
    // With limits in dollars, the dollar row is read and euros are never converted.
    expect(meterRow(view({ currencies: [row(100, 0, 0, 1, 'EUR')] }))).toMatchObject({ currency: 'USD', deals_today: 0 });
  });

  it('expired or unverified limits tell the owner agents cannot pay until signed again', () => {
    expect(readLimits(view({ status: 'expired' }))!.line).toMatch(/ran out.*can’t pay anyone/);
    expect(readLimits(view({ status: 'unverified', limits: null }))!.line).toMatch(/couldn’t be checked.*can’t pay anyone/);
    // Expired limits are not drawn as limits.
    expect(readLimits(view({ status: 'expired' }))!.meters[0]!.of).toBeNull();
    expect(readLimits(undefined)).toBeNull();
  });

  it('builds envelope_sign arguments in minor units, or says what is missing', () => {
    const ok = buildLimits({ out: '1,000.50', held: '600', deals: '6', days: 30 }, 'USD', 1_800_000_000, parseMoneyInput);
    expect(ok).toEqual({ ok: true, args: { currency: 'USD', max_out_day: usd(100050), max_held: usd(60000), max_deals_day: 6, expires: 1_800_000_000 + 30 * 86400 } });
    const bad = buildLimits({ out: '0', held: '1.001', deals: '2.5', days: 30 }, 'USD', 0, parseMoneyInput);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems).toHaveLength(3);
    expect(buildLimits({ out: '10', held: '10', deals: '70000', days: 7 }, 'USD', 0, parseMoneyInput).ok).toBe(false);
  });
});

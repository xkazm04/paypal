// market-data-2: the client's ports of the fair-price arithmetic match Rust's own vectors
// (table_core::market tests), and the words name no internals.
import { describe, expect, it } from 'vitest';
import type { FairPrice } from '@bindings/FairPrice';
import type { MarketComparable } from '@bindings/MarketComparable';
import { certifiedMarket, usd } from '../mock/fixtures';
import { fairPriceOf, ordinal, percentileOf, quartiles, rechecks } from './fairPrice';
import { fairPriceWords } from './words';

const comps = (...minors: number[]): MarketComparable[] => minors.map((minor) => ({ minor, product_id: null }));

describe('fair-price arithmetic (parity with Rust)', () => {
  it('quartiles interpolate in minor units and round down, whatever the order', () => {
    expect(quartiles([100, 201])).toEqual([125, 150, 175]);
    expect(quartiles([2020, 1010])?.[1]).toBe(1515);
    expect(quartiles([300, 100, 200])?.[1]).toBe(200);
    expect(quartiles([])).toBeNull();
  });

  it('the percentile counts an equal price as half, rounded half up', () => {
    const two = comps(1010, 2020);
    expect([1000, 1010, 1515, 2020, 9999].map((m) => percentileOf(two, m))).toEqual([0, 25, 50, 75, 100]);
    expect(percentileOf(comps(100, 200, 300, 400, 500, 600, 700, 800, 900), 800)).toBe(83);
  });

  it('ordinals read as words do', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 50, 62, 100].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '50th', '62nd', '100th']);
  });

  it('a sample record re-checks exactly; a changed quartile or comparable does not', () => {
    const m = certifiedMarket('X', 'monitor-27-4k', [301, 318, 336], 100);
    expect(rechecks(m)).toBe(true);
    expect(m.certificate?.product_id).toBe('lg-27uk850-w');
    expect(m.certificate?.comparables).toHaveLength(13);
    expect(rechecks({ ...m, median: usd(319) })).toBe(false);
    const moved = { ...m, certificate: { ...m.certificate!, comparables: m.certificate!.comparables.map((c, i) => (i === 6 ? { ...c, minor: c.minor + 1 } : c)) } };
    expect(rechecks(moved)).toBe(false);
  });

  it('the deal’s fair price: committed once agreed, older records not re-checkable', () => {
    const m = certifiedMarket('X', 'monitor-27-4k', [301, 318, 336], 100);
    const open = fairPriceOf('NEGOTIATING', m, usd(329))!;
    expect(open).toMatchObject({ state: 'rechecked', committed: false, prices: 13 });
    expect(fairPriceOf('RECEIPTED', m, usd(329))?.committed).toBe(true);
    const { certificate: _drop, ...older } = m;
    expect(fairPriceOf('RECEIPTED', older, usd(329))).toMatchObject({ state: 'not_recheckable', percentile: null });
    expect(fairPriceOf('RECEIPTED', { ...m, p25: usd(1) }, usd(329))?.state).toBe('broken');
    expect(fairPriceOf('RECEIPTED', null, usd(329))).toBeNull();
  });
});

describe('fair-price words', () => {
  const fp = (over: Partial<FairPrice>): FairPrice => ({ state: 'rechecked', committed: true, percentile: 78, prices: 12, retrieved_at: 100, ...over });
  it('reads "$329.00 is the 78th percentile of 12 market prices · re-checked"', () => {
    const w = fairPriceWords(fp({}), usd(329));
    expect(w.text).toBe('$329.00 is the 78th percentile of 12 market prices · re-checked');
    expect(w.short).toBe('78th percentile of 12');
    expect(w.means).toMatch(/agreed on/);
    expect(fairPriceWords(fp({ committed: false }), usd(329)).means).toMatch(/not agreed yet/);
    expect(fairPriceWords(fp({ prices: 1 }), usd(329)).text).toContain('of 1 market price ·');
  });
  it('an older record says so; a broken one warns; none names internals', () => {
    expect(fairPriceWords(fp({ state: 'not_recheckable', percentile: null, prices: 0 }), usd(1)).text).toBe('Older market record, not re-checkable');
    const broken = fairPriceWords(fp({ state: 'broken', percentile: null }), usd(1));
    expect(broken.tone).toBe('red');
    const all = (['rechecked', 'not_recheckable', 'broken'] as const)
      .flatMap((state) => { const w = fairPriceWords(fp({ state }), usd(5)); return [w.text, w.means, w.short]; }).join(' ');
    expect(all).not.toMatch(/\b(hash|digest|sha|certificate|comparable|quartile|audit|Rust|v2|p25|p75)\b/i);
  });
});

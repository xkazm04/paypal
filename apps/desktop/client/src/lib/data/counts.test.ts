import { describe, expect, it } from 'vitest';
import { UNKNOWN_COUNT, formatCount, formatTally } from './counts';

describe('formatCount (badges)', () => {
  it('reads as is up to 99, then 99+', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(7)).toBe('7');
    expect(formatCount(99)).toBe('99');
    expect(formatCount(100)).toBe('99+');
    expect(formatCount(5000)).toBe('99+');
    expect(formatCount(12, 9)).toBe('9+');
  });
  it('an unknown count is the dash, never 0', () => {
    for (const n of [undefined, null, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(formatCount(n)).toBe(UNKNOWN_COUNT);
  });
});

describe('formatTally (list meta, filter chips)', () => {
  it('as is up to 999, then thousands like the prototype, never rounding up', () => {
    expect(formatTally(999)).toBe('999');
    expect(formatTally(1000)).toBe('1k');
    expect(formatTally(1250)).toBe('1.2k');
    expect(formatTally(1299)).toBe('1.2k');
    expect(formatTally(5000)).toBe('5k');
    expect(formatTally(9999)).toBe('9.9k');
    expect(formatTally(10_000)).toBe('10k');
    expect(formatTally(12_400)).toBe('12k');
  });
  it('an unknown tally is the dash', () => {
    expect(formatTally(undefined)).toBe(UNKNOWN_COUNT);
    expect(formatTally(null)).toBe(UNKNOWN_COUNT);
  });
});

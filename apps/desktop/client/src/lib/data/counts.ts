// How a count reads on screen. Counts of things (deals, steps, items), never money: money goes
// through lib/format.ts formatMinor, from integer minor units.
//
// - A badge (a "needs you" count on a rail or a tab) is small: up to 99, then "99+".
// - A tally in a list's meta line or a filter chip reads in thousands above 999, as the console
//   prototype does (prototype/console-calibre/app.js n0): 1,000 -> "1k", 1,250 -> "1.2k" (rounded
//   down, so a tally never reads more than there is), 12,400 -> "12k".
// - A count the wallet did not give (undefined, null, not a whole number >= 0) is the dash, never 0.

/** The dash an unknown count shows (UX-GUIDE: unknown is dashed, never zero). */
export const UNKNOWN_COUNT = '–';

const known = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** A badge count: "0".."99", then "99+". */
export function formatCount(n: number | null | undefined, max = 99): string {
  if (!known(n)) return UNKNOWN_COUNT;
  return n > max ? `${max}+` : String(n);
}

/** A tally: as is up to 999, then thousands with one decimal below 10k ("1.2k") and none above. */
export function formatTally(n: number | null | undefined): string {
  if (!known(n)) return UNKNOWN_COUNT;
  if (n <= 999) return String(n);
  if (n <= 9_999) {
    const tenths = Math.floor(n / 100); // 1250 -> 12 -> "1.2k"
    const whole = Math.floor(tenths / 10);
    const dec = tenths % 10;
    return dec === 0 ? `${whole}k` : `${whole}.${dec}k`;
  }
  return `${Math.floor(n / 1000)}k`;
}

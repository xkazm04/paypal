// The fair-price certificate (market-data-2), client side. Rust computes it again from the
// wallet's own record (DealEvidence.fair_price) and the proof checker recomputes it offline; these
// pure ports exist so the browser mock answers the same way and the words can be tested. They
// mirror table_core::market (`from_comparables`, `MarketCertificate::percentile`) exactly, in
// integer minor units.
import type { DealState } from '@bindings/DealState';
import type { FairPrice } from '@bindings/FairPrice';
import type { MarketComparable } from '@bindings/MarketComparable';
import type { MarketRef } from '@bindings/MarketRef';
import type { Money } from '@bindings/Money';

/** The most comparables one certificate keeps (the market request's result limit). */
export const MAX_MARKET_COMPARABLES = 30;

/** Linear quartiles of sorted minor units, fractions rounded down (Rust `from_comparables`). */
export function quartiles(minors: readonly number[]): [number, number, number] | null {
  if (!minors.length) return null;
  const s = [...minors].sort((a, b) => a - b);
  const q = (quarter: number): number => {
    const index = (s.length - 1) * quarter;
    const lo = s[Math.floor(index / 4)] ?? 0;
    const hi = s[Math.floor(index / 4) + 1] ?? lo;
    return lo + Math.floor(((hi - lo) * (index % 4)) / 4);
  };
  return [q(1), q(2), q(3)];
}

/** Where `minor` sits among the comparables, 0 to 100: the share priced below it, an equal price
 *  counting as half, rounded half up (Rust `MarketCertificate::percentile`). */
export function percentileOf(comparables: readonly MarketComparable[], minor: number): number {
  const n = comparables.length;
  if (!n) return 0;
  const below = comparables.filter((c) => c.minor < minor).length;
  const equal = comparables.filter((c) => c.minor === minor).length;
  return Math.floor(((2 * below + equal) * 100 + n) / (2 * n));
}

/** Whether a record's quartiles are exactly what its comparables compute to. */
export function rechecks(m: MarketRef): boolean {
  const c = m.certificate;
  if (!c || !c.comparables.length || c.comparables.length > MAX_MARKET_COMPARABLES) return false;
  const q = quartiles(c.comparables.map((x) => x.minor));
  return !!q && q[0] === m.p25.minor && q[1] === m.median.minor && q[2] === m.p75.minor && c.currency === m.median.currency;
}

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st … */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

const AGREED_OR_LATER: ReadonlySet<DealState> = new Set<DealState>([
  'AGREED', 'SETTLING', 'AWAITING_APPROVAL', 'APPROVED', 'AUTHORIZED', 'CAPTURED', 'RECEIPTED', 'RECONCILED', 'MISMATCH', 'VOIDED', 'AUTO_VOIDED', 'REFUNDED', 'DISPUTED',
]);
/** The mock's fair price for a deal whose market record it holds (Rust reads it from its rows). */
export function fairPriceOf(state: DealState, market: MarketRef | null | undefined, price: Money): FairPrice | null {
  if (!market) return null;
  const committed = AGREED_OR_LATER.has(state);
  const c = market.certificate;
  if (!c) return { state: 'not_recheckable', committed, percentile: null, prices: 0, retrieved_at: market.retrieved_at };
  if (!rechecks(market) || c.currency !== price.currency) {
    return { state: 'broken', committed, percentile: null, prices: 0, retrieved_at: market.retrieved_at };
  }
  return { state: 'rechecked', committed, percentile: percentileOf(c.comparables, price.minor), prices: c.comparables.length, retrieved_at: market.retrieved_at };
}

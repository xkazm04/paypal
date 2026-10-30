// The market price a deal was agreed on, worked out again: the band (quartiles) is computed from the
// comparable prices the deal kept, the certificate is bound to the deal's agreement row by a digest, and
// the deal's price is placed among those prices. All integer arithmetic, as in the wallet's table-core.
import { type Bytes, byteArray, same, sha256 } from './bytes';
import { type Money, readMoney } from './money';
import { MAX_SAFE } from './read';
import { canonicalBytes } from './jcs';

type Rec = Record<string, unknown>;
export const MARKET_FORMAT = 'table.market.v2';
export const MARKET_FORMAT_V1 = 'table.market.v1';
const MAX_COMPARABLES = 30;

export interface Comparable {
  minor: number;
  product_id: string | null;
}
export interface Certificate {
  product_id: string;
  raw_sha256: Bytes;
  match_kind: string;
  currency: string;
  comparables: Comparable[];
  /** The certificate as the file writes it: what the digest is taken over. */
  json: unknown;
}
export interface MarketRef {
  p25: Money;
  median: Money;
  p75: Money;
  retrieved_at: number;
  response_hash: Bytes;
  cached: boolean;
  certificate: Certificate | null;
}

export const productValid = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[A-Za-z0-9_-]+$/.test(id);

function rec(value: unknown, keys: readonly string[], optional: readonly string[] = []): Rec | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const r = value as Rec;
  if (keys.some((k) => !(k in r)) || Object.keys(r).some((k) => !keys.includes(k) && !optional.includes(k))) return null;
  return r;
}
const money = (v: unknown): Money | null => {
  try {
    return readMoney(v);
  } catch {
    return null;
  }
};

/** A market record as the wallet writes it; null when the value is not one (the file is then not a proof file). */
export function readMarketRef(value: unknown): MarketRef | null {
  const r = rec(value, ['p25', 'median', 'p75', 'retrieved_at', 'response_hash', 'cached'], ['certificate']);
  if (!r) return null;
  const [p25, median, p75] = [money(r.p25), money(r.median), money(r.p75)];
  const response = byteArray(r.response_hash, 32);
  if (!p25 || !median || !p75 || !response || !Number.isSafeInteger(r.retrieved_at) || typeof r.cached !== 'boolean') return null;
  let certificate: Certificate | null = null;
  if (r.certificate !== undefined && r.certificate !== null) {
    const c = rec(r.certificate, ['product_id', 'raw_sha256', 'match_kind', 'currency', 'comparables']);
    const raw = c ? byteArray(c.raw_sha256, 32) : null;
    if (!c || !raw || typeof c.product_id !== 'string' || c.match_kind !== 'similar' || typeof c.currency !== 'string' || !Array.isArray(c.comparables)) return null;
    const comparables: Comparable[] = [];
    for (const item of c.comparables) {
      const x = rec(item, ['minor', 'product_id']);
      if (!x || typeof x.minor !== 'number' || !Number.isSafeInteger(x.minor) || x.minor < 0 || x.minor > MAX_SAFE || !(x.product_id === null || typeof x.product_id === 'string')) return null;
      comparables.push({ minor: x.minor, product_id: x.product_id });
    }
    if (!money({ minor: 0, currency: c.currency })) return null;
    certificate = { product_id: c.product_id, raw_sha256: raw, match_kind: c.match_kind, currency: c.currency, comparables, json: r.certificate };
  }
  return { p25, median, p75, retrieved_at: r.retrieved_at as number, response_hash: response, cached: r.cached, certificate };
}

/** Sorted by price, then id (a missing id sorts first). */
const byId = (a: string | null, b: string | null): number => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1);
const before = (a: Comparable, b: Comparable): number => a.minor - b.minor || byId(a.product_id, b.product_id);

/** A well formed certificate: a valid product id, 1 to 30 comparables, each above zero with a well formed
 *  id or none, in order. */
export function certificateValid(c: Certificate): boolean {
  if (!productValid(c.product_id) || c.comparables.length === 0 || c.comparables.length > MAX_COMPARABLES) return false;
  if (c.comparables.some((x) => x.minor <= 0 || (x.product_id !== null && !productValid(x.product_id)))) return false;
  return c.comparables.every((x, i) => i === 0 || before(c.comparables[i - 1] as Comparable, x) <= 0);
}

/** Linear quartiles of the prices in minor units; fractions round down. */
export function quartiles(prices: number[]): [number, number, number] | null {
  if (prices.length === 0) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const at = (quarter: number): number => {
    const index = (sorted.length - 1) * quarter;
    const lo = sorted[Math.floor(index / 4)] as number;
    const hi = sorted[Math.floor(index / 4) + 1] ?? lo;
    return lo + Math.floor(((hi - lo) * (index % 4)) / 4);
  };
  return [at(1), at(2), at(3)];
}

/** `MarketRef::validate`: ordered quartiles in one currency, a non-zero median, and a certificate whose
 *  comparables compute to exactly those quartiles again. */
export function marketValid(m: MarketRef): boolean {
  if (m.p25.currency !== m.median.currency || m.median.currency !== m.p75.currency) return false;
  if (m.p25.minor > m.median.minor || m.median.minor > m.p75.minor || m.median.minor === 0) return false;
  const c = m.certificate;
  if (c) {
    if (!certificateValid(c)) return false;
    const again = quartiles(c.comparables.map((x) => x.minor));
    if (!again || c.currency !== m.median.currency || !same(c.raw_sha256, m.response_hash)) return false;
    if (again[0] !== m.p25.minor || again[1] !== m.median.minor || again[2] !== m.p75.minor) return false;
  }
  return true;
}

/** The digest a deal's agreement row commits to for this record: over the format, the retrieval time
 *  and the certificate. Null for an older record, which has no certificate. */
export async function marketDigest(m: MarketRef): Promise<Bytes | null> {
  if (!m.certificate) return null;
  return sha256(canonicalBytes([MARKET_FORMAT, m.retrieved_at, m.certificate.json]));
}

/** Where `price` sits among the comparables, 0 to 100: the share priced below it, counting an equal
 *  price as half, rounded half up; null when the record is not valid or is in another currency. */
export function percentile(c: Certificate, price: Money): number | null {
  if (!certificateValid(c) || price.currency !== c.currency) return null;
  const n = c.comparables.length;
  const below = c.comparables.filter((x) => x.minor < price.minor).length;
  const equal = c.comparables.filter((x) => x.minor === price.minor).length;
  const pct = Math.floor(((2 * below + equal) * 100 + n) / (2 * n));
  return pct <= 255 ? pct : null;
}

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, ... */
export function ordinal(n: number): string {
  const [one, hundred] = [n % 10, n % 100];
  const suffix = hundred >= 11 && hundred <= 13 ? 'th' : one === 1 ? 'st' : one === 2 ? 'nd' : one === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}


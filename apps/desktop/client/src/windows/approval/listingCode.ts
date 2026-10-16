// The listing code: what a seller's table shows so its buyer, another owner's wallet, can join it.
// A versioned, checksummed text of the deal id, item, quantity, asking price, delivery and kind of
// thing, passed out of band (the seller reads or pastes it to the buyer). It is not authority and
// not a secret: the buyer's sheet decodes it locally and calls deal_join with it, and Rust then
// holds the buyer's deal until the seller's signed listing arrives and matches the same item, price
// and delivery. A code that does not match never gets an offer, an approval or a PayPal call.
import type { Category } from '@bindings/Category';
import type { Currency } from '@bindings/Currency';
import type { Terms } from '@bindings/Terms';

export const LISTING_CODE_VERSION = 1;
const PREFIX = `TBL${LISTING_CODE_VERSION}`;
const CATEGORIES: readonly Category[] = ['office', 'parts', 'compute', 'service', 'other'];
const CURRENCIES: readonly Currency[] = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'NZD', 'CZK', 'SEK', 'NOK', 'DKK', 'PLN', 'JPY', 'HUF', 'KWD', 'BHD'];
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
// The characters Rust accepts in an item reference, without the "/" this code splits on.
const ITEM = /^[A-Za-z0-9\-_.:@+]{1,128}$/;

export type ListingTable = { dealId: string; terms: Terms; category: Category };
export type DecodeFailure = 'malformed' | 'version' | 'checksum' | 'unsupported';
export type Decoded = { ok: true; table: ListingTable } | { ok: false; why: DecodeFailure };

/** CRC-32 (IEEE) as 8 lowercase hex digits: catches a mistyped or cut-off code, nothing more. */
export function checksum(text: string): string {
  let crc = 0xffffffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

/** The code for a table, or null when its delivery is not one the code can carry. */
export function encodeListingCode(t: ListingTable): string | null {
  if (t.terms.delivery.type !== 'digital_now') return null;
  const body = [PREFIX, t.dealId, t.terms.item_ref, String(t.terms.qty), String(t.terms.unit_price.minor), t.terms.unit_price.currency, 'now', t.category].join('/');
  return `${body}/${checksum(body)}`;
}

export function decodeListingCode(text: string): Decoded {
  const code = text.replace(/\s+/g, '');
  const parts = code.split('/');
  if (parts.length < 2 || !/^TBL\d+$/i.test(parts[0])) return { ok: false, why: 'malformed' };
  if (parts[0].toUpperCase() !== PREFIX) return { ok: false, why: 'version' };
  if (parts.length !== 9) return { ok: false, why: 'malformed' };
  const body = parts.slice(0, 8).join('/');
  if (!/^[0-9a-f]{8}$/i.test(parts[8])) return { ok: false, why: 'malformed' };
  if (parts[8].toLowerCase() !== checksum(body)) return { ok: false, why: 'checksum' };
  const [, dealId, item, qty, minor, currency, delivery, category] = parts;
  const q = Number(qty);
  const m = Number(minor);
  if (!ULID.test(dealId) || !ITEM.test(item) || !/^\d{1,4}$/.test(qty) || !/^\d{1,15}$/.test(minor)
    || !(q >= 1 && q <= 1000) || !(m > 0 && Number.isSafeInteger(m))
    || !(CURRENCIES as readonly string[]).includes(currency) || !(CATEGORIES as readonly string[]).includes(category)) {
    return { ok: false, why: 'malformed' };
  }
  if (delivery !== 'now') return { ok: false, why: 'unsupported' };
  const cur = currency as Currency;
  return {
    ok: true,
    table: { dealId, category: category as Category, terms: { item_ref: item, qty: q, unit_price: { minor: m, currency: cur }, currency: cur, delivery: { type: 'digital_now' } } },
  };
}

// Keep prices fresh (T15): the owner's signed rule that lets the wallet check the typical price
// of named items on its own, up to a number of checks a day. Mirrors table-core's validation and
// reads the wallet's own facts; it grants no money authority and nothing here moves money.
import type { Clause } from '@bindings/Clause';
import type { Deal } from '@bindings/Deal';
import type { MarketWatchFact } from '@bindings/MarketWatchFact';
import { joinWords, priceChecksToday } from './words';

/** table-core MAX_MARKET_CHECKS_DAY / MAX_WATCHED_ITEMS. */
export const MAX_MARKET_CHECKS_DAY = 200;
export const MAX_WATCHED_ITEMS = 20;

type Watch = Extract<Clause, { type: 'market_watch' }>;

/** table-core market_product_valid: 1 to 128 ASCII letters, digits, `-` or `_`. */
export const productValid = (p: string): boolean => /^[A-Za-z0-9_-]{1,128}$/.test(p);

/** MandatePayload::validate()'s market-watch arm, with Rust's own reasons (null = valid). */
export function marketWatchRefusal(c: Watch): string | null {
  if (!c.items.length || c.items.length > MAX_WATCHED_ITEMS) return 'invalid market watch';
  if (c.max_refreshes_day < 1 || c.max_refreshes_day > MAX_MARKET_CHECKS_DAY) return 'invalid price check allowance';
  if (c.items.some((i) => !productValid(i.product_id))) return 'invalid market product';
  if (c.items.some((i, n) => c.items.slice(0, n).some((x) => x.item_ref === i.item_ref))) return 'item watched twice';
  return null;
}

/** table-core market_watch_open: a seller deal is watched up to Agreed, a buyer deal until paid. */
const SELLER_OPEN = new Set<Deal['state']>(['PAIRING', 'LISTED', 'NEGOTIATING', 'AGREED']);
const BUYER_OPEN = new Set<Deal['state']>(['PAIRING', 'LISTED', 'NEGOTIATING', 'AGREED', 'SETTLING', 'AWAITING_APPROVAL', 'APPROVED', 'AUTHORIZED']);

export type DealWatch = { usedUp: boolean; used: number; max: number };

/**
 * Whether the wallet keeps this deal's typical price fresh: its rules in force (same version)
 * watch its item and the deal is still where a price is judged. Null when not watched or when the
 * wallet's facts are not loaded (unknown is never shown as watched).
 */
export function dealWatch(facts: readonly MarketWatchFact[] | null | undefined, deal: Pick<Deal, 'mandate_id' | 'mandate_version' | 'terms' | 'side' | 'state' | 'mode'>): DealWatch | null {
  if (!facts || deal.mode === 'replay') return null;
  const open = deal.side === 'seller' ? SELLER_OPEN : BUYER_OPEN;
  if (!open.has(deal.state)) return null;
  const f = facts.find((x) => x.mandate_id === deal.mandate_id && x.mandate_version === deal.mandate_version && x.items.some((i) => i.item_ref === deal.terms.item_ref));
  return f ? { usedUp: f.used_up, used: f.used_today, max: f.max_per_day } : null;
}

/** One rule's day in owner facts: "Price checks today: 3 of 12", then what it keeps fresh, or
 *  that today's checks are used up. Item names only; product codes stay in the editor. */
export function watchLine(f: MarketWatchFact): { checks: string; rest: string; usedUp: boolean } {
  const items = joinWords(f.items.map((i) => i.item_ref));
  return {
    checks: priceChecksToday(f.used_today, f.max_per_day),
    rest: f.used_up ? `used up until tomorrow · ${items}` : `keeps ${items} fresh`,
    usedUp: f.used_up,
  };
}

// The one place the sentence meets the deals already open: for an item the owner's wallet knows, each open table's
// latest price against the two numbers the owner just said (the most they'll pay, and the amount above which they
// decide). It is a preview of THEIR numbers, not the wallet's check: Rust re-checks every request against the signed
// rules, and what the owner reads here is only "if the price stays". Pure.
import type { Currency } from '@bindings/Currency';
import type { Reach } from './draft';

/** What the join needs of an open table. */
export type OpenTable = { id: string; ref: string; title: string; who: string | null; price: number; currency: Currency };

/** Where a price lands against what was said. */
export type Verdict = 'alone' | 'asks' | 'over';
export type Peek = { id: string; title: string; who: string | null; price: number; currency: Currency; verdict: Verdict };

/** Up to this an agent could agree on its own (a signed rule is the authority); above it, it stops and asks; above the most, never. */
export function verdictOf(price: number, reach: Pick<Reach, 'alone' | 'ceiling'>): Verdict {
  if (reach.ceiling !== null && price > reach.ceiling) return 'over';
  return price <= reach.alone ? 'alone' : 'asks';
}

/** The open tables for the item the sentence was tied to, cheapest first. Nothing when it was not tied to one. */
export function peekTables(reach: Reach | null, tables: readonly OpenTable[]): Peek[] {
  if (!reach?.itemRef || reach.ceiling === null) return [];
  return tables
    .filter((t) => t.ref === reach.itemRef && t.currency === reach.currency)
    .map((t) => ({ id: t.id, title: t.title, who: t.who, price: t.price, currency: t.currency, verdict: verdictOf(t.price, reach) }))
    .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
}

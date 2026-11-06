// spark abstract-first-home round 2: the words of the six module lists (column headers, the short
// cell words the module pages do not already have, and each module's empty sentence). Prototype
// strings live here; every other word comes from lib/words and the module models.
import type { Module } from '@bindings/Module';

export const ROWS_COLUMNS: Record<Module, string[]> = {
  tables: ['Offer', 'Your limit', 'Time'],
  spend: ['Amount', 'Verdict'],
  counter: ['Price', 'vs usual', 'Now'],
  book: ['Amount', 'Where'],
  shield: ['Amount', 'Verdict', 'Why'],
  rescue: ['At risk', 'Next'],
};

export const ROWS_EMPTY: Record<Module, string> = {
  tables: 'No haggling yet. Open a table and your agent bargains inside your limit.',
  spend: 'Your agents have not bought anything yet.',
  counter: 'Nothing in your shop yet. Items appear once your shop rules or an order name them.',
  book: 'No payments yet. Every payment lands here, in and out.',
  shield: 'Nothing checked yet. The scam check looks at every payment before PayPal is asked.',
  rescue: 'No failed renewals. Watch a subscription and a failed renewal shows up here.',
};

export const ROWS = {
  /** A cell with nothing to say (never 0, never green). */
  none: '—',
  /** Spend: the rules ask the owner about this purchase. */
  asksYou: 'Asks you',
  /** Counter: live orders on an item. */
  open: (n: number): string => `${n} open`,
  /** Rescue: PayPal's own next retry. */
  retryIn: (left: string): string => `retry in ${left}`,
  /** Rescue: a replayed failure has nothing at PayPal to retry. */
  replay: 'replay, no retry',
  /** Rescue: the wallet does not know PayPal's next retry. */
  retryUnknown: 'retry not known',
  /** Rescue: the wallet counted the money as recovered. */
  recovered: 'Recovered',
  /** Rescue sub: what happens if the owner does nothing. */
  ifNothing: (head: string): string => `If you do nothing: ${head}`,
};

// Words for the product finder (market_search, market_lookup) and the review's comparables
// (market_comparables). Sentence case, Maya's words, no internals, no vendor names. Prefix: `FINDER_` /
// `COMPARABLES_`. This file imports nothing from lib/words.ts (a cycle would read consts before they exist).
// Shop names, titles and brands are the shops' own words: they are drawn as text and never worded here.

/** What the wallet says on the wire, so the screen can tell "no key" from "can't reach" without a second call.
 *  Byte-identical to table-runtime's NO_MARKET_KEY and its not-found answer. */
export const FINDER_WIRE_NO_KEY = 'No market key is set, so products cannot be looked up.';
export const FINDER_WIRE_NOTHING = 'The market found nothing for that.';

/** The finder beside a product code in a keep-prices-fresh rule. */
export const FINDER = {
  open: 'Find',
  openTitle: 'Find the product by name, or paste a shop page link. Typing its code works too.',
  close: 'Close',
  label: 'Find a product',
  placeholder: 'A name, or paste a shop page link',
  search: 'Search',
  busy: 'Searching…',
  idle: 'Search by name, or paste a link to the product page. Nothing is saved until you pick one.',
  none: 'No products found. Try other words.',
  noKey: 'No market key is set, so products can’t be looked up. You can still type a product code.',
  offline: 'Products can’t be looked up right now. You can still type a product code.',
  notAProduct: 'That page didn’t show a product. Try its name instead.',
  results: 'Products found',
  use: 'Use',
  untrusted: 'Names and prices are the shops’ own words, shown as they are.',
} as const;
/** "Use LG 27UK850-W for item 1": the button's full name. */
export const finderUseLabel = (title: string | undefined, n: number): string => `${FINDER.use} ${title ?? 'this product'} for item ${n}`;

/** The review's comparables panel and its one-line "same item cheaper". Information only. */
export const COMPARABLES = {
  key: 'Similar products',
  loading: 'Looking at similar products…',
  none: 'No similar products found for this item.',
  noKey: 'No market key is set, so there is nothing to compare with.',
  offline: 'Similar products aren’t available right now.',
  note: 'From shops, as they wrote it. For your information: it never blocks or changes this deal.',
  list: 'Similar products',
  cheaperKey: 'Same item',
} as const;
/** "Cheaper at northwind-tech.example: $289.00, $40.00 less." Never a prompt to act. */
export const comparablesCheaper = (shop: string, price: string, saving: string): string => `Cheaper at ${shop}: ${price}, ${saving} less.`;

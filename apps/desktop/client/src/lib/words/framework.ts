// Words of the console's layer framework (rebuild WP2.5): the owner's places as layers, the module
// layer chrome, the list engine and the shared row parts. Re-exported from lib/words.ts. This file
// imports nothing from lib/words.ts (it is re-exported from there; a cycle would read consts
// before they exist).
/** The places (the same keys as `PLACES` in windows/main/logic.ts; checked there by type). */
type Place = 'rules' | 'limits' | 'connections' | 'pairing' | 'settings' | 'safety';

/** The owner's places, as their layer heading, crumb and Find row name them. */
export const PLACE_NAME: Readonly<Record<Place, string>> = {
  rules: 'Agent rules',
  limits: 'Wallet limits',
  connections: 'Connections',
  pairing: 'Connect a wallet',
  settings: 'Settings',
  safety: 'Your safety record',
};
/** One line under each place's name in Find. */
export const PLACE_FIND_SUB: Readonly<Record<Place, string>> = {
  rules: 'what your agents may do · change in the approval window',
  limits: 'one cap above every rule · today against your limits',
  connections: 'the wallets and the house seller you deal with',
  pairing: 'connect with another wallet or the house seller',
  settings: 'agent app, pause agents, PayPal key, lock',
  safety: 'every money step and who decided it · check again',
};

/** The wallet limits layer (old content until WP3 rebuilds it). */
export const LIMITS_LAYER = {
  kicker: 'Agent rules · wallet limits',
  none: 'No wallet limit is signed. Your agents stay inside each rule you signed, and above them nothing caps the day.',
  unread: 'Your wallet limits could not be read right now. Nothing has changed with your money.',
  change: 'Change limits',
  changeTitle: 'Opens the approval window, where you sign your limits',
  ifNothing: 'your limits stay as signed',
} as const;

/** The safety record as a layer. */
export const SAFETY_LAYER = { again: 'Check again', againTitle: 'Check every entry and every deal again, now' } as const;

/** The module layer chrome. The key-art plate's plain description per module (decoration). */
export const MODULE_ART_LABEL: Readonly<Record<'tables' | 'spend' | 'counter' | 'book' | 'shield' | 'rescue', string>> = {
  tables: 'Drawing: two chairs at a small table',
  spend: 'Drawing: a shopping basket beside a stack of coins',
  counter: 'Drawing: a shop counter with a bell',
  book: 'Drawing: an open ledger with a bookmark',
  shield: 'Drawing: a shield with a lock',
  rescue: 'Drawing: a lifebuoy on the water',
};
/** The module layer chrome. */
export const YOUR_CALL = 'Your call';
export const yourCallLabel = (n: number): string => (n === 1 ? 'One decision here needs you. Open it.' : `${n} decisions here need you. Open them.`);
export const MODULE_EMPTY = 'Nothing here yet. If you do nothing, no money moves.';
export const MODULE_SUMMARY_LABEL = 'At a glance';

/** The list engine. */
export const LIST_SEARCH = 'Search';
export const LIST_SEARCH_PLACEHOLDER = 'Search this list';
export const LIST_SORT = 'Sort';
export const LIST_FILTER = 'Show';
export const LIST_ALL = 'All';
/** "Showing 40 of 5,000"; `n` formats a count. */
export const listShowing = (shown: number, all: number, n: (x: number) => string = String): string => (shown === all ? `${n(all)} in all` : `Showing ${n(shown)} of ${n(all)}`);
export const LIST_NO_MATCH = 'Nothing matches. Clear the search or the filter to see everything.';
export const LIST_CLEAR = 'Clear';
export const LIST_DETAIL_EMPTY = 'Pick a row to see it here.';

/** The shared row parts. */
export const STATE_UNKNOWN = 'Not available yet';
export const STATE_UNKNOWN_TITLE = 'The wallet has not said what state this is in yet.';
export const AMOUNT_UNKNOWN_TITLE = 'Not known yet';
export const WHO_UNKNOWN = 'not named yet';

/** The framework's worked example (browser preview only, `?framework-example`; console/examples). */
export const EXAMPLE = {
  answer: (deals: number, waiting: number): string => (waiting ? `${deals} deals here, ${waiting} waiting for you` : `${deals} deals here, none waiting for you`),
  allView: 'Every deal here',
  waitingView: 'Waiting for you',
  live: 'Still going',
  settled: 'Paid',
  newest: 'Newest first',
  largest: 'Largest first',
  empty: 'No deals here yet. If you do nothing, no money moves.',
  whyTitle: 'Why this page says this',
  why: 'Counted from your deals as the wallet records them. Nothing on this page moves money: a decision opens the approval window.',
} as const;

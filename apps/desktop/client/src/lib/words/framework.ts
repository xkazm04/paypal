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
/** A list whose rows pick for a pane and open with Enter (screen readers hear it once per list). */
export const LIST_TWO_STEP = 'Arrow keys move through the list. A click picks a row and shows it beside the list; Enter opens it.';

/** The shared row parts. */
export const STATE_UNKNOWN = 'Not available yet';
export const STATE_UNKNOWN_TITLE = 'The wallet has not said what state this is in yet.';
export const AMOUNT_UNKNOWN_TITLE = 'Not known yet';
export const WHO_UNKNOWN = 'not named yet';

/** The counterparty's note behind a chip (console/areas/shared/NoteChip.tsx; byte-identical to the
 *  strings it carried inline before rebuild WP4a). */
export const NOTE_CHIP = {
  chip: 'note ›',
  chipTitle: 'Their latest note, shown as plain text. Your agents never act on it.',
  title: (who: string): string => `Their words · ${who}`,
  what: 'Their note',
  reading: 'their note',
  none: (from: string): string => `${from} has sent no note on this deal.`,
  from: (from: string): string => `From ${from}, unchecked`,
  sent: (at: string): string => `Sent ${at}. Shown exactly as written, with no links. Your agents never act on it.`,
} as const;

/** What a calm notice says could not be read or done (WalletNotice `what`), and what is loading:
 *  the main window's words that were inline before rebuild WP4a (byte-identical). */
export const NOTICE_WHAT = {
  settings: 'Settings',
  pause: 'Pause',
  resume: 'Resume',
  agentRules: 'Agent rules',
  walletLimits: 'Wallet limits',
  safety: 'Safety record',
  approval: 'Approval window',
  agent: 'Agent',
  agentApp: 'Agent app',
  quit: 'Quit',
  quitSummary: 'What happens when you quit',
} as const;
export const LOADING_WHAT = { rules: 'your rules', deal: 'the deal' } as const;
/** The quit confirmation and the shortcuts sheet (moved from QuitSheet.tsx / Shortcuts.tsx). */
export const QUIT_SHEET = { title: 'Quit The Table?', keep: 'Keep it running' } as const;
export const SHORTCUTS_TRIAL = 'New layouts on trial';

/** The "Latest" strip under a module's or a place's cards (rebuild WP4a): the first rows of the
 *  area's most relevant list, each opening its deal, and a way into the full view. */
export const LATEST = {
  label: (what: string): string => `Latest: ${what}`,
  seeAll: 'See all',
  seeAllTitle: (what: string): string => `Open ${what.toLowerCase()}`,
  more: (n: string): string => `${n} more`,
  facts: 'As it stands now',
} as const;
/** What each area's "Latest" strip lists (after "Latest: "). */
export const LATEST_OF = {
  tables: 'your tables, waiting and open ones first',
  spend: 'purchases, waiting ones first',
  counter: 'orders at your counter, open ones first',
  book: 'money in and out, newest first',
  shield: 'deals checked, paused and stopped ones first',
  rescue: 'renewals, the ones that need a fix first',
  deal: 'on this deal',
  withThem: (who: string): string => `other deals with ${who}`,
  people: 'wallets you deal with',
  steps: 'money steps and who decided',
  decided: 'decided lately, and who decided',
  settings: 'your wallet at a glance',
} as const;

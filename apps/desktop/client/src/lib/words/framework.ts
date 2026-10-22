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
export const TITLE_UNKNOWN = 'no title yet';
/** A receipt's toast when the deal is not in the ledger yet (Console.tsx). */
export const A_DEAL = 'A deal';
/** The console's side panel (the inspector) as a screen reader names it. */
export const INSPECTOR_LABEL = 'Details';

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
  ledger: 'Ledger',
  needs: 'Needs you',
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
/** A failed first read under the centre's title, and the wallet's fault stream: the owner's words, never the error's own text. */
export const NOTICE_UNREAD = 'The wallet has not answered yet. If you do nothing, no money moves.';
export const WALLET_FAULT_TOAST = 'The wallet ran into a problem just now. If you do nothing, no money moves.';
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

/** The crumbs on a narrow bar (polish A): the layers between the first and the last two fold into
 *  one "…" that opens them as a short menu. */
export const CRUMBS_MORE = {
  /** The "…" button's accessible name. */
  label: (n: number): string => `${n === 1 ? 'One more layer' : `${n} more layers`} above this one`,
  /** Its tooltip: the whole way here. */
  title: (path: string): string => `Where you are: ${path}`,
  /** The menu's heading. */
  menu: 'Go back up to',
} as const;

// The main window shell's words that were inline in Shortcuts.tsx, Status.tsx, QuitSheet.tsx,
// paletteCopy.ts and Find.tsx (scan-sweep, byte-identical). windows/main/shellWords.test.ts guards them.

/** The shortcuts sheet: each group's title and its keys (a '…' key draws a dash between two). */
export const SHORTCUT_GROUPS: readonly { title: string; keys: readonly (readonly [readonly string[], string])[] }[] = [
  { title: 'Everywhere', keys: [
    [['/'], 'Find a deal, a person or a place (also Ctrl K)'],
    [['Esc'], 'Back one level, or close what is open'],
    [['1', '…', '6'], 'Jump to Tables, Spend, Counter, Book, Shield, Rescue'],
    [['?'], 'Show this list'],
  ] },
  { title: 'Lists', keys: [
    [['↑', '↓'], 'Move along a list (also Page Up/Down, Home, End)'],
    [['Enter'], 'Open the deal of the row you are on'],
  ] },
  { title: 'What needs you', keys: [
    [['←', '→'], 'Previous or next decision'],
    [['Enter'], 'On the gold button: open the approval window, where money is decided'],
  ] },
  { title: 'Rewind', keys: [
    [['Space'], 'Play or pause the week'],
    [['←', '→'], 'Move the playhead an hour (Shift: a day)'],
  ] },
  { title: 'Tables', keys: [
    [['↑', '↓'], 'Move your price limit (Shift: 5 steps, Page Up/Down: 10)'],
  ] },
  { title: 'Counter', keys: [
    [['↑', '↓'], 'Change the lowest price by 1 (Shift: 10)'],
    [['Ctrl', 'Enter'], 'Review your changes'],
  ] },
  { title: 'Rescue', keys: [
    [['←', '→'], 'Choose a fix (↑ ↓ too)'],
    [['0', '…', '4'], 'Choose a fix by its number (0: do nothing)'],
  ] },
];
export const SHORTCUTS_TRIAL_NOTE = 'A new layout on trial. Switch one off to see that screen as it was before.';

/** The footer's agent app chip: its label and its tooltip, by what is known. */
export const ENGINE_CHIP = {
  statusUnknown: 'Agent app status unknown',
  checking: 'Checking agent app…',
  none: 'No agent app',
  practiceReady: 'Practice agent ready',
  ready: 'Agent app ready',
  notConnected: 'Agent app not connected',
  settingsUnread: 'Your settings couldn’t be read just now. Opens Settings.',
  checkingTitle: 'Checking the agent app',
  unchecked: 'The agent app couldn’t be checked just now. Opens Settings.',
  isReady: (id: string, version: string | null | undefined): string => `${id}${version ? ` ${version}` : ''} is ready. Opens Settings.`,
  isNotConnected: (id: string, why: string | null): string => `${id} is not connected${why ? `: ${why}` : ''}. Opens Settings.`,
  pick: 'No agent app chosen: open Settings to pick one',
} as const;

/** The footer's agents chip. */
export const AGENTS_CHIP = {
  checking: 'Agents: checking…',
  unknown: 'Agents: status unknown',
  paused: 'Agents paused',
  working: (n: number): string => `${n} agent${n === 1 ? '' : 's'} working`,
  idle: 'Agents idle',
  checkingTitle: 'Checking what your agents are doing',
  unreadTitle: 'What your agents are doing couldn’t be read just now. Opens Settings.',
  pausedTitle: 'All agents are paused. Deadlines and their safe defaults still run; nothing new starts.',
  workingTitle: 'Agents working on deals right now (at most four, one per deal)',
} as const;

/** The quit sheet's lines other than Rust's own (QUIT_SHEET above holds its title and Keep). */
export const QUIT_SHEET_LINES = {
  quit: 'Quit The Table',
  closing: 'The Table is closing. The wallet stops now.',
  checking: 'Checking your open deals…',
  changed: 'Something changed since this opened. Check the list again before you quit.',
  unknown: 'What each deal does while The Table is off couldn’t be checked just now.',
} as const;

/** The empty Find: what was typed, and what is worth trying. */
export const FIND_NO_MATCH = {
  typed: (q: string): string => `Nothing matches “${q}”. Try a shop name, an item or a page like Book.`,
  empty: 'Nothing to show yet.',
} as const;

/** Find's places that are not in PLACE_FIND_SUB. */
export const FIND_PLACE_SUB = {
  centre: 'the decision centre',
  waiting: 'every decision that waits for you',
  setup: 'your keys, your rules and a practice deal, one step at a time',
  quit: 'stops the wallet · see what waits first',
} as const;
export const FIND_QUIT_TITLE = 'Quit The Table';

/** The shared/ui primitives' own words (Sheet, Inspector, ThemeSwitch, Group, Meter, Loading, Why and
 *  the story kit). A primitive takes its default text from here, never from a literal; a caller
 *  that passes its own prop still wins. shared/ui/words.test.ts keeps literals out of those files. */
export const UI_WORDS = {
  close: 'Close',
  closeEsc: 'Close (Esc)',
  closeDetails: 'Close details',
  /** A Group with no rows and no `empty` of its own. */
  nothingHere: 'Nothing here.',
  /** After a Meter's label when the value is unknown: "Wallet limit: not available yet". */
  notAvailable: 'not available yet',
  reading: (what: string): string => `Reading ${what}…`,
  why: 'Why?',
  /** A button's hover title when Esc does the same: "Book (Esc)". */
  escHint: (what: string): string => `${what} (Esc)`,
  /** The ? sheet's experiment switches (shared/ui/experiments.ts). */
  experiments: { 'r2-book': { name: 'Where the money went', where: 'Book', what: 'Bars by kind, a PayPal-agrees meter and question chips.' } },
  theme: { label: 'Theme', dark: 'Dark', light: 'Light', darkTitle: 'The Dial palette', lightTitle: 'PayPal palette' },
  checks: { label: 'Checks', showAll: 'Show all', hidePassed: 'Hide passed', show: 'Show' },
} as const;

/** What a ChecksSummary check says about itself, in a count and as an icon's accessible name. */
export const CHECK_WORD = { pass: 'passed', ask: 'asks you', fail: 'stopped it', unknown: 'not checked here' } as const;

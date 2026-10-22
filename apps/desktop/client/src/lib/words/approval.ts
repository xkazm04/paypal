// Words for the approval window's frame as a layer of the console (rebuild WP4b). Owned by the WP4b
// builder; re-exported from lib/words.ts by one `export *` line. Rules (docs/ux/UX-GUIDE.md):
// sentence case, Maya's words, no internals, PayPal the only vendor name. Prefix: `APPROVAL_` /
// `HOLD_`. This file imports nothing from lib/words.ts (a cycle would read consts before they exist).
// The two close notes are byte-identical to the ones DealReview showed before (its close path).

/** The approval window's own frame: its crumbs, the Approvals strip and the way back to The Table. */
export const APPROVAL_FRAME = {
  /** The window's name in the crumbs and on the strip. */
  name: 'Approvals',
  /** The strip's line beside the name. ("approved", not "authorised": UX-GUIDE keeps authorization internal.) */
  strip: 'the one place money is approved',
  /** The strip's tooltip, in full. */
  stripLabel: 'Approvals: the one place money is approved, your PayPal keys are saved and your rules are signed',
  /** Accessible name of the crumbs. */
  crumbs: 'Where this window sits',
  /** The calm way back: closes this window, decides and withdraws nothing. */
  back: 'Back to The Table',
  backTitle: 'Close this window and go back to The Table. Nothing is decided or withdrawn.',
  /** The browser preview has no window to close. */
  closePreview: 'Preview only. In the app this closes the window; the mini window keeps watching PayPal for you.',
  closeFailed: 'This window stayed open. Close it from its title bar; nothing changes for the deal.',
  details: 'Details',
  detailsTitle: 'Where every check came from, the full history and the proof',
} as const;

/** The small seal beside a deal's title: what it shows, in plain words (role="img"). */
export const APPROVAL_SEAL = {
  needs: 'Your wallet: this decision waits for you. Nothing moves until you decide.',
  holding: 'Your wallet: this payment is paused for you. Nothing is paid.',
  stopped: 'Your wallet: this deal stopped. Nothing more moves.',
  quiet: 'Your wallet: nothing here waits for you.',
  watching: 'Your wallet is reading this deal.',
  locked: 'Your wallet is locked. Money stays where it is until you unlock.',
} as const;

/** What a screen reader hears on a hold-to-confirm button (HoldButton, HoldGesture). */
export const HOLD_WORDS = {
  hint: 'Press and hold to confirm',
  progress: 'Hold progress',
  holding: 'Keep holding',
  done: 'Confirmed',
} as const;

/** The owner page's first-run heading (polish A). It names The Table's charter instead of counting
 *  steps: the charter has five lines (keys, rules, practice deal, agent app, unlock) and this page
 *  shows them as its lock card and four steps, so a count here never matched. Starts with the
 *  charter's own title (`CHARTER_TITLE`, words.ts; approval.test pins the two equal). */
export const APPROVAL_FIRST_RUN = {
  title: 'Your wallet’s charter: the lines to your first safe deal',
  /** The page's hidden heading for screen readers. */
  welcome: 'Welcome: your wallet’s charter, the lines to your first safe deal',
} as const;

/** Opening or joining a table in the approval window (TableSheet). Joining or opening moves no
 *  money: the agents haggle under the rules the owner picks, and any payment still waits for its
 *  own approval here. */
export const APPROVAL_TABLE = {
  section: 'Tables',
  sectionSub: 'Open a table for a wallet you connected. Your agent haggles under the rules you pick; paying still waits for you here.',
  openRow: 'Open a table',
  openRowSub: 'Sell to a wallet you connected with four words',
  openAct: 'Open a table…',
  chip: 'no money moves',
  noneToSell: 'Connect another owner’s wallet first, in The Table',
  joinTitle: 'Join the house seller’s table',
  joinAbout: 'The house seller offered this table when you connected. Pick the rules your agent haggles under, then join. Nothing is paid by joining.',
  openTitle: 'Open a table',
  openAbout: 'Your agent offers this to the wallet you pick and haggles under the rules you choose. Nothing is paid by opening it.',
  item: 'Item',
  price: 'Asking price',
  qty: 'How many',
  who: 'Sell to',
  category: 'Kind of thing',
  until: 'Haggling ends',
  rules: 'Rules your agent follows',
  pickRules: 'Pick a set of rules',
  noBuyRules: 'No signed rules let an agent buy at a table yet. Sign rules for haggling as a buyer first.',
  noSellRules: 'No signed rules let an agent sell at a table yet. Sign rules for haggling as a seller first.',
  ended: 'This table’s haggling time is over. Connect with the house seller again for a new one.',
  notNow: 'Not now',
  unlock: 'Unlock with Windows Hello',
  unlocking: 'Waiting for Windows Hello…',
  join: 'Join the table',
  joining: 'Joining…',
  open: 'Open the table',
  opening: 'Opening…',
  failJoin: 'Not joined',
  failOpen: 'Not opened',
  failFollow: 'The Table did not open',
  joined: 'You joined the table',
  opened: 'Your table is open',
  doneSub: 'Your agent haggles from here. When a price needs you, it comes back to this window. If you do nothing, the table lapses and no money moves.',
  follow: 'Follow it in The Table',
  close: 'Close',
  needWho: 'Pick who to sell to.',
  needRules: 'Pick the rules your agent follows.',
  needCategory: 'Pick a kind of thing these rules allow.',
  needItem: 'Pick an item these rules name.',
  needQty: 'Say how many, from 1 to 1000.',
  needPrice: 'Type the asking price, like 120.00.',
  refused: 'Your rules don’t allow this table. Open your rules to see what they allow, then try again.',
  invalid: 'This table doesn’t match what your wallet knows any more. Nothing was opened; connect again for a fresh one.',
  sellMode: 'Open a table',
  codeMode: 'Join with a code',
  codeAbout: 'The seller’s table shows a code. Paste it here, check the terms are the ones you expect, and pick the rules your agent haggles under. Nothing is paid by joining; if the seller’s table does not match the code, your agent never makes an offer.',
  codeWho: 'Seller',
  codeField: 'Code from the seller',
  codePlaceholder: 'Paste the code here',
  noneToJoin: 'Connect the seller’s wallet first, in The Table',
  codeCheck: 'Check these are the terms you expect. Your rules decide what your agent may do with them.',
  codeBadFormat: 'That doesn’t look like a table code. Paste the whole code the seller’s table shows.',
  codeBadSum: 'That code has a typo or is cut off. Copy it again from the seller’s table.',
  codeBadVersion: 'That code is from a different version of The Table. Ask the seller to update and send a new one.',
  codeBadDelivery: 'This code names a way of delivering that tables here can’t join yet.',
  codeShown: 'Give this code to the buyer',
  codeShownSub: 'They paste it into their own table sheet. It is not a secret and it pays nothing; if it is wrong or altered, their agent never makes an offer.',
  codeCopy: 'Copy the code',
  codeCopied: 'Code copied',
  codeNoCopy: 'Couldn’t copy. Select the code and copy it by hand.',
} as const;

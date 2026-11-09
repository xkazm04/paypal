// Words for the approval window's frame as a layer of the console (rebuild WP4b). Owned by the WP4b
// builder; re-exported from lib/words.ts by one `export *` line. Rules (docs/ux/UX-GUIDE.md):
// sentence case, Maya's words, no internals, PayPal the only vendor name. Prefix: `APPROVAL_` /
// `HOLD_`. This file imports nothing from lib/words.ts (a cycle would read consts before they exist).
// The two close notes are byte-identical to the ones DealReview showed before (its close path).
import type { DecisionStep } from '@bindings/DecisionStep';

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
  back: 'Back to Signet',
  backTitle: 'Close this window and go back to Signet. Nothing is decided or withdrawn.',
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
  noneToSell: 'Connect another owner’s wallet first, in Signet',
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
  unlock: 'Unlock with fingerprint, face or PIN',
  unlocking: 'Waiting for your fingerprint, face or PIN…',
  join: 'Join the table',
  joining: 'Joining…',
  open: 'Open the table',
  opening: 'Opening…',
  failJoin: 'Not joined',
  failOpen: 'Not opened',
  failFollow: 'Signet did not open',
  joined: 'You joined the table',
  opened: 'Your table is open',
  doneSub: 'Your agent haggles from here. When a price needs you, it comes back to this window. If you do nothing, the table lapses and no money moves.',
  follow: 'Follow it in Signet',
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
  noneToJoin: 'Connect the seller’s wallet first, in Signet',
  codeCheck: 'Check these are the terms you expect. Your rules decide what your agent may do with them.',
  codeBadFormat: 'That doesn’t look like a table code. Paste the whole code the seller’s table shows.',
  codeBadSum: 'That code has a typo or is cut off. Copy it again from the seller’s table.',
  codeBadVersion: 'That code is from a different version of Signet. Ask the seller to update and send a new one.',
  codeBadDelivery: 'This code names a way of delivering that tables here can’t join yet.',
  codeShown: 'Give this code to the buyer',
  codeShownSub: 'They paste it into their own table sheet. It is not a secret and it pays nothing; if it is wrong or altered, their agent never makes an offer.',
  codeCopy: 'Copy the code',
  codeCopied: 'Code copied',
  codeNoCopy: 'Couldn’t copy. Select the code and copy it by hand.',
} as const;

/** The next step when this computer has no sign-in set up for confirming it is the owner (OMAR-09). Plain words; appended to every "isn't set up" line. */
export const HELLO_NEXT_STEP = 'To turn it on: Windows Settings, Accounts, Sign-in options, add a PIN, fingerprint or face. Then come back and try again.';

/** The accessible name of one signed rule set's row: its name, version and state, so rows for the same agent never share a name. */
export const ruleRowLabel = (name: string, version: number, updated: string, state: string, which = ''): string => `Open ${name}${which ? ` ${which}` : ''}, version ${version}, updated ${updated} (${state}), to see or change them`;
/** "set 2 of 3": which of one agent's signed rule sets a row is, so rows alike in version, date and state still differ. */
export const ruleSetOrdinal = (i: number, n: number): string => (n > 1 ? `set ${i} of ${n}` : '');

/** The owner's decision as the wallet recorded it (ApprovalSummary.decided; the Rewind's owner_decided
 *  step), by the step it started. Read back from the wallet's own record on every open, so a reopened
 *  window, a restart or a lost reply says the same thing. Words only from the recorded fields. */
export const APPROVAL_DECIDED = {
  /** The strip's head: "Approved 14:02". */
  short: { create: 'Approved', authorize: 'Approved', capture: 'Approved', invoice_create: 'Approved', accept: 'Accepted', release: 'Unpaused', hand_off: 'Opened PayPal' } as Readonly<Record<DecisionStep, string>>,
  /** What the owner did, as a sentence's start. */
  did: {
    create: 'You approved the order', authorize: 'You approved the hold', capture: 'You approved the payment', invoice_create: 'You approved the fix',
    accept: 'You accepted their offer', release: 'You unpaused the payment', hand_off: 'You opened PayPal',
  } as Readonly<Record<DecisionStep, string>>,
  /** The fold's verb: "When you approved · 14:02". */
  when: { create: 'approved', authorize: 'approved', capture: 'approved', invoice_create: 'approved', accept: 'accepted', release: 'unpaused', hand_off: 'opened PayPal' } as Readonly<Record<DecisionStep, string>>,
  /** The bound line: the decision, its time, the tally of the lines recorded with it, and whether the list reads the same now. */
  line: (did: string, time: string, tally: string, same: boolean): string =>
    `${did} at ${time} on the checks shown (${tally}), recorded with your decision.${same ? ' Unchanged since.' : ' The list has changed since.'}`,
  /** A decision whose row kept only the list's fingerprint (an older record). */
  hashOnly: (did: string, time: string, same: boolean): string =>
    `${did} at ${time}, on the checks shown then.${same ? ' Unchanged since.' : ' The list has changed since.'}`,
  fold: (verb: string, time: string): string => `When you ${verb} · ${time}`,
  foldSub: 'The lines recorded with your decision, each against the list now. Nothing to do here.',
  compare: { same: 'same', changed: 'changed', passes: 'now passes', fails: 'now fails', gone: 'not on the list now' } as const,
  signed: 'Signed by the owner key after unlock',
  notSigned: 'Not signed by the owner key',
} as const;

/** While a money step is open with PayPal: one plain line in place of the money buttons, from the
 *  step, its state and its times (DealEvidence.money_check). Nothing more is sent until it settles. */
export const APPROVAL_MONEY_OPEN = {
  checking: (step: string, since: string, next: string | null): string =>
    `${step} went to PayPal at ${since}, and its answer is being checked${next ? ` (next check ${next})` : ''}. Nothing more is sent until the wallet knows.`,
  parked: (step: string, since: string): string =>
    `${step} went to PayPal at ${since}, and its answer couldn’t be confirmed. Nothing more is sent; at the deadline the wallet asks PayPal what happened.`,
} as const;

/** After a decision call failed: what the wallet's record shows, read again before anything is said.
 *  A newer decision row with a money step open, a newer row with nothing open, or none at all
 *  (today's "Nothing was done"); a record that could not be read leaves the outcome unconfirmed. */
export const APPROVAL_AFTER_FAILURE = {
  checking: {
    what: 'Sent to PayPal, the answer is being checked',
    message: 'The wallet recorded your decision and the step went to PayPal. The wallet asks PayPal what happened before anything else is sent.',
  },
  recorded: {
    what: 'Your decision was recorded; nothing was sent',
    message: 'The wallet recorded your decision, but the step didn’t go to PayPal and no money moved. Look at the deal again before you decide.',
  },
  moved: {
    what: 'Your decision was recorded',
    message: 'The wallet recorded your decision and the deal has moved on. What this window shows now is what happened.',
  },
  unconfirmed: {
    what: 'Not confirmed yet',
    message: 'The wallet didn’t answer after your decision, so whether it went ahead isn’t known yet. This window reads the deal again by itself.',
  },
} as const;

/** Short visible lines of the approval window (spark perfection-ten A3). Each long explanation they
 *  stand for stays one click away, behind an (i) (shared ExplainHint) whose title is the `*About`
 *  word. Safety text (if you do nothing, nothing is sent, refusals) never moves behind one. */
export const APPROVAL_SHORT = {
  /** The deal review's secondary material (market, price check, similar products, invoice). */
  aside: 'For reference',
  limitsLine: 'One cap above all your agents’ rules.',
  limitsAbout: 'About wallet limits',
  replayRow: 'Replay a test renewal and approve its fix',
  replayAbout: 'About replaying a renewal',
  replayLine: 'The fix’s invoice is real. What it brings in is never counted.',
  watchRow: 'Checked with PayPal · checking never moves money',
  watchAbout: 'About watching subscriptions',
  watchLine: 'Checked with PayPal every few hours. Checking never moves money.',
  emailLine: 'A fix’s invoice goes to this email. Watching sends nothing.',
  emailAbout: 'About the subscriber’s email',
  tableAbout: 'About tables',
  tableOpenLine: 'Your agent haggles under the rules you choose. Opening pays nothing.',
  tableJoinLine: 'Pick the rules your agent haggles under. Joining pays nothing.',
  tableCodeLine: 'Paste the seller’s code and check the terms. Joining pays nothing.',
  connectRow: 'Start one in Signet, then check the four words here',
  ticksEmpty: 'Deals show here once your wallet has tried these rules.',
  whatIfEmpty: 'Fill in the limits to see how this week would have gone.',
} as const;

/** Cutting off a connected wallet (owner configuration › Connections). An owner decision: it asks
 *  for the hold gesture and an unlocked window. What it does is the wallet's own rule: the pin is
 *  marked, never deleted; messages that wallet signs are refused from then on; open deals are not
 *  closed, they end by their own deadline or by the owner's decision. Nothing here moves money. */
export const APPROVAL_CUT_OFF = {
  row: 'Connected wallets',
  rowSub: (n: number): string => (n === 0 ? 'Nobody is connected yet' : n === 1 ? '1 wallet you connected with four words' : `${n} wallets you connected with four words`),
  rowCut: (n: number): string => (n === 1 ? '1 cut off' : `${n} cut off`),
  reading: 'Reading your connections…',
  readingChip: 'reading',
  unread: 'Your connections can’t be read right now',
  unreadChip: 'not available',
  deals: (n: number): string => (n === 1 ? '1 deal closed' : `${n} deals closed`),
  manage: 'Manage…',
  manageLabel: 'Manage connected wallets',
  sheet: 'Connected wallets',
  intro: 'Cut off a wallet you no longer trust. Cutting off moves no money.',
  none: 'Nobody is connected yet. Connect a wallet in Signet with four words.',
  connected: 'connected',
  cutOff: 'cut off',
  line: (key: string, since: string, deals: string): string => `key ${key} · since ${since} · ${deals}`,
  act: 'Cut off…',
  actLabel: (name: string, key: string): string => `Cut off ${name}, key ${key}`,
  ask: (name: string): string => `Cut off ${name}?`,
  who: 'Who',
  key: 'Their key',
  stops: 'What stops',
  stopsWhat: 'Messages they sign are no longer accepted: no offer, answer or receipt from them gets through.',
  open: 'Open deals with them',
  openWhat: 'Not closed. Nothing they send moves them forward; each ends by its own deadline or by your decision.',
  after: 'Afterwards',
  afterWhat: 'They stay in your list, marked as no longer connected, so your record stays whole.',
  money: 'Cutting off moves no money.',
  hold: (name: string): string => `Hold to cut off ${name}`,
  holdHint: 'Press and hold to cut off, or hold Space',
  cutting: 'Cutting off…',
  done: (name: string): string => `${name} is cut off. Nothing they sign is accepted now.`,
  failed: 'Not cut off',
  keep: 'Keep them',
  back: 'Back to the list',
  unlock: 'Unlock…',
  unlocking: 'Unlocking…',
  lockedWhy: 'Cutting off asks for your fingerprint, face or PIN first.',
} as const;

// Words for the rescue area of the console (rebuild WP3). Owned by the WP3 builder of this area; every
// user-facing string of the area goes here, never inline. Re-exported from lib/words.ts by one
// `export *` line, so importers keep `import { X } from '../lib/words'`. Rules (docs/ux/UX-GUIDE.md):
// sentence case, Maya's words, no internals (commands, ids, clause numbers, raw states), PayPal is
// the only vendor name, every needs-you line carries "If you do nothing". Prefix exports with the
// area (e.g. `RESCUE_`): two areas exporting one name is a type error in lib/words.ts.
// (The four old page names are lib/words.ts RESCUE_VIEW_LABEL, repeated here as literals: this file
// is re-exported by lib/words.ts and may not import from it.)

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The Rescue's nested views: the crumb label and the view's heading. */
export const RESCUE_VIEWS_TITLE = {
  failed: 'Needs a fix',
  progress: 'Fixes in progress',
  recovered: 'Recovered money',
  watch: 'Watching',
  compare: 'Compare every fix',
} as const;

type FixKey = 'DISCOUNT_THIS_CYCLE' | 'PAUSE' | 'RETRY_AFTER_FIX' | 'DOWNGRADE';

export const RESCUE = {
  title: 'Rescue',
  /** The "what the subscriber would get" mock on each fix. */
  get: {
    label: 'What the subscriber would get',
    theyGet: 'They’d get',
    kind: (kind: string) => `They’d get · ${kind}`,
    nothing: 'Nothing: not offered for this renewal',
  },
  loading: 'your rescues',
  ledgerWhat: 'Ledger',
  bookWhat: 'Fixes and recovered money can’t be read',
  approvalWhat: 'Approval window',
  opensApproval: 'Opens the approval window.',
  none: 'None',
  ifNothing: 'If you do nothing',
  yourCall: 'Your call',
  openDeal: 'Open deal ›',
  never: 'Never a price change for everyone on the plan: changing the plan price would change it for every subscriber, not just the one who is struggling. No fix, agent or approval can do that from here, by design.',

  answer: {
    one: (name: string, amount: string, asks: boolean) => `${name}’s ${amount} renewal failed.${asks ? ' Your call.' : ' PayPal retries on its own.'}`,
    many: (n: number, sums: string, asks: boolean) => `${n} renewals failed, ${sums} in all.${asks ? ' Your call on each.' : ' PayPal retries on its own.'}`,
    retries: 'If you do nothing, PayPal retries the payment by itself.',
    soonest: (name: string, amount: string) => `Soonest: ${name}’s ${amount} renewal.`,
    none: 'No renewal is failing right now.',
    waiting: (n: number) => `${n} fix${n === 1 ? ' is' : 'es are'} waiting for the subscriber.`,
    nothing: 'Nothing to rescue.',
    got: (m: string) => `${m} recovered so far.`,
  },

  cards: {
    renewals: (n: number) => plural(n, 'renewal', 'renewals'),
    atRisk: (m: string) => `${m} at risk`,
    nothing: 'Nothing',
    nothingToFix: 'Nothing to fix',
    fixes: (n: number) => plural(n, 'fix', 'fixes'),
    waitingFor: (m: string) => `${m} waiting for the subscriber`.trim(),
    nothingWaiting: 'Nothing waiting',
    noneYet: 'None yet',
    countedOnce: 'Counted once PayPal shows it paid',
    unread: 'Can’t be read',
    reading: 'Reading…',
    watchNote: 'Rules and watched subscriptions',
  },

  how: {
    title: 'How rescue works',
    items: [
      { title: 'A renewal failed', text: 'A subscriber’s payment didn’t go through.' },
      { title: 'Pick one fix', text: 'One fix, for that one subscriber.' },
      { title: 'Doing nothing is safe', text: 'PayPal retries on its own. Nothing is sent without you.' },
    ],
  },

  failedSub: 'Pick one fix for one subscriber, or do nothing. The approval window is the only place a fix is approved.',
  compareSub: 'Every fix of every failed renewal, side by side. Pick a renewal to choose its fix.',
  progressSub: 'Invoices sent, waiting for the subscriber to pay',
  recoveredSub: 'Only what PayPal shows paid counts',
  watchSub: 'Subscriptions your wallet checks, and the fixes you allow',
  empty: {
    failed: 'No failed renewals. Nothing to rescue.',
    progress: 'No fix is waiting for a subscriber.',
    recovered: 'No rescue on record yet.',
  },

  replay: 'Replay a renewal',
  review: 'Review & approve',
  reviewFix: (short: string) => `Review ${short}`,
  handoffTitle: 'Opens the approval window, the only place a fix can be approved. Nothing is sent until you approve there.',
  question: (name: string) => `${name}’s renewal failed. What should happen?`,
  whyLine: 'PayPal couldn’t take the payment, so nothing was recovered yet.',
  invoiceTo: 'The invoice would go to',
  reportedTitle: 'PayPal reported this failed renewal',
  defaultSilence: 'nothing is sent, PayPal retries on its own',
  picksLabel: 'What to do about this renewal',
  doNothing: 'Do nothing',
  defaultTitle: 'The safe default: nothing is sent',
  selected: 'Selected',
  retriesIn: (t: string) => `PayPal retries in ${t}`,
  staysUnpaid: 'This month stays unpaid',
  offerLine: (pct: string, invoice: string, cycle: string) => `${pct} off: ${invoice} instead of ${cycle}`,
  whyOff: { REPLAY: 'Not for a replay: no real balance to collect', 'retry <24h': 'Not now: PayPal retries within a day', NOT_BUILT: 'Not available yet' },
  pick: {
    DISCOUNT_THIS_CYCLE: { name: 'Offer a discount', does: 'A cheaper invoice for this month only' },
    PAUSE: { name: 'Pause for a while', does: 'Pause now, restart on a date you agree' },
    RETRY_AFTER_FIX: { name: 'Retry later', does: 'They fix their card first, then you collect' },
    DOWNGRADE: { name: 'Smaller plan', does: 'Move them to a cheaper plan' },
  } satisfies Record<FixKey, { name: string; does: string }>,
  whyNotOffered: 'Why aren’t these offered?',
  nothingSafe: 'Doing nothing is always safe: PayPal retries on its own.',

  nothingDoes: {
    sent: 'Nothing is sent: no PayPal call, no email.',
    retry: (left: string, at: string) => `PayPal retries the payment by itself in ${left} (${at}). If that works, it is paid without a fix.`,
    noRetry: 'PayPal has no retry scheduled. This month stays unpaid.',
    never: 'If you never decide, nothing is ever sent.',
  },
  fix: {
    aboutNone: 'What doing nothing does',
    about: (name: string) => `What “${name}” does`,
    does: (invoice: string, cycle: string, pct: string) => `One PayPal invoice for this cycle at ${invoice} instead of ${cycle} (${pct} off). This cycle only; the plan and its price stay the same.`,
    checks: 'Checks',
    sees: 'What the subscriber sees',
    wording: 'The invoice’s wording',
    emails: (to: string) => `PayPal emails it to ${to}. The wording is your wallet’s, the same for every subscriber; no agent writes it.`,
    calls: 'What PayPal is asked to do',
  },
  cmp: {
    head: { NONE: 'Do nothing', DISCOUNT_THIS_CYCLE: 'Discount', PAUSE: 'Pause', RETRY_AFTER_FIX: 'Retry later', DOWNGRADE: 'Smaller plan' },
    nothingSent: 'Nothing sent',
    retry: (t: string) => `retry in ${t}`,
    noRetry: 'no retry set',
    off: (pct: string) => `${pct} off`,
    notNow: 'Not now',
    notYet: 'Not yet',
    replay: 'a replay',
    retrySoon: 'retry due soon',
    gist: { DISCOUNT_THIS_CYCLE: 'cheaper bill', PAUSE: 'pause a while', RETRY_AFTER_FIX: 'fix card first', DOWNGRADE: 'cheaper plan' } satisfies Record<FixKey, string>,
  },

  counted: 'PayPal shows this invoice paid and your wallet saved the receipt, so it counts as money you got back.',
  replayNotCounted: 'This renewal failure was replayed, not reported by PayPal, so what it brings in is never counted as money you got back.',
  sentNotCounted: 'Sent is not paid: it counts only once PayPal shows the invoice paid.',
  unverified: 'PayPal hasn’t shown this paid with a saved receipt, so it doesn’t count yet.',
  countChip: { counts: 'counts as recovered', not: 'not counted', notPaid: 'not paid yet' },
  desk: {
    making: 'Invoice being made · nothing is paid yet',
    sent: (to: string | null) => `Invoice sent${to ? ` to ${to}` : ''} · waiting for the subscriber to pay`,
    paidVerified: 'Paid on PayPal · receipt saved',
    paidReplay: 'Paid to you · a replay, never counted',
    paid: 'Paid to you',
  },
  k: {
    what: 'What', money: 'Money', fix: 'Fix', source: 'Source', deadline: 'Deadline',
    fixLine: (pct: string, cycle: string) => `${pct} off ${cycle}, this cycle only`,
  },

  recovered: {
    total: 'Recovered so far:',
    noneYet: 'none yet',
    rule: 'Only an invoice PayPal shows paid, with its receipt saved, counts, and only for a renewal PayPal reported failed. Replays never do, and sent is not paid. Each currency is added up on its own.',
    counts: 'Counts', notCounts: 'Doesn’t count', closed: 'Closed',
    countsLine: 'Counts as money you got back',
  },
  notCounted: {
    REPLAY: 'A replayed failure, never counted',
    scripted: 'A practice-agent row',
    failing: 'Renewal still failing · nothing recovered yet',
    sent: 'Invoice not paid yet',
    unverified: 'Paid, but not shown paid by PayPal with a saved receipt',
    closed: 'Closed · nothing recovered',
  } satisfies Record<'REPLAY' | 'scripted' | 'failing' | 'sent' | 'unverified' | 'closed', string>,

  watch: {
    reading: 'Reading…',
    unread: 'Can’t be read right now',
    none: 'Watch a subscription and your wallet checks it with PayPal for a failed renewal. Checking never moves money.',
    failing: (n: number) => `${n} with a failed renewal · checked with PayPal every few hours; checking never moves money`,
    checked: 'Checked with PayPal every few hours for a failed renewal; checking never moves money',
    reads: (today: number, max: number) => `${today} of ${max} checks today`,
    manage: 'Manage',
    add: 'Watch a subscription',
  },
  rules: {
    title: 'Your rescue rules',
    what: 'Your rules',
    signed: 'Signed', fixes: 'Fixes', scope: 'Scope', never: 'Never', invoice: 'Invoice',
    cover: (n: number) => `${plural(n, 'rule set covers', 'rule sets cover')} rescues`,
    noneSigned: 'no signed rules cover rescues yet',
    noFixes: 'no fixes allowed yet',
    scopeText: 'one fix acts on one subscriber only',
    neverText: 'a price change for everyone on the plan',
    invoiceText: 'a fixed wording from your wallet, never written by an agent',
    open: 'Open agent rules',
  },
} as const;

/** Why a watched subscription is not being checked right now (the wallet would otherwise check it). */
export const RESCUE_WATCH_HOLD: Record<'paused' | 'not_connected' | 'no_rules' | 'no_key', string> = {
  paused: 'Not checking while your agents are paused.',
  not_connected: 'Not checking: PayPal isn’t connected.',
  no_rules: 'Not checking: no signed rules allow fixes for failed renewals.',
  no_key: 'Not checking: the agent that signed your rescue rules isn’t set up on this device.',
};

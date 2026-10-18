// Words for the shield area of the console (rebuild WP3). Owned by the WP3 builder of this area; every
// user-facing string of the area goes here, never inline. Re-exported from lib/words.ts by one
// `export *` line, so importers keep `import { X } from '../lib/words'`. Rules (docs/ux/UX-GUIDE.md):
// sentence case, Maya's words, no internals (commands, ids, clause numbers, raw states), PayPal is
// the only vendor name, every needs-you line carries "If you do nothing". Prefix exports with the
// area (e.g. `SHIELD_`): two areas exporting one name is a type error in lib/words.ts.
// (The four old page names and subs are lib/words.ts SHIELD_VIEW_LABEL / SHIELD_*_SUB, repeated here
// as literals: this file is re-exported by lib/words.ts and may not import from it.)

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The Shield's nested views: the crumb label and the view's heading (the four old pages keep their names). */
export const SHIELD_VIEWS_TITLE = {
  stopped: 'Stopped',
  through: 'Let through',
  week: 'This week',
  safe: 'Looked safe',
  paused: 'Paused for you',
  how: 'How the shield decides',
} as const;

export const SHIELD = {
  title: 'Shield',
  loading: 'the shield',
  ledgerWhat: 'Ledger',
  none: 'None',
  unknown: 'unknown',
  count: (n: number) => plural(n, 'payment', 'payments'),
  ifNothing: 'If you do nothing',
  nothingSentPrefix: 'Nothing sent',

  answer: {
    onePaused: (amount: string, who: string) => `A ${amount} payment to ${who} is paused. Your call.`,
    manyPaused: (n: number) => `${n} payments are paused for you. Your call.`,
    nothingSent: 'Nothing was sent to PayPal.',
    blocked: (n: number) => `${plural(n, 'payment', 'payments')} blocked for good.`,
    safe: (n: number) => `${plural(n, 'payment', 'payments')} looked safe.`,
    stopped: (n: number) => `${plural(n, 'payment was', 'payments were')} stopped for your safety.`,
    stoppedParts: (blocked: number, closed: number): string => {
      const parts = [blocked ? `${blocked} blocked for good` : null, closed ? `${closed} paused, then closed` : null].filter((x): x is string => !!x);
      if (!parts.length) return '';
      const s = parts.join(' and ');
      return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
    },
    neverAsked: 'PayPal was never asked.',
    nothingNeeds: 'Nothing needs you.',
    quiet: 'All quiet. Nothing suspicious happened.',
    quietSub: 'Nothing is paused and nothing was stopped.',
    notYet: 'The shield hasn’t had to check anyone yet.',
  },

  cards: {
    blocked: (n: number) => `${n} blocked for good`,
    nothingStopped: 'Nothing stopped',
    letGo: 'You let these go on',
    noneReleased: 'No paused payment released',
    checked: (n: number) => `${n} checked`,
    weekNote: (paused: number, blocked: number) => `${paused} paused · ${blocked} blocked`,
    nothingFound: 'Nothing suspicious found',
    nothingChecked: 'Nothing looked safe yet',
  },

  pausedSub: 'Each one waits for you. Releasing happens in the approval window, where you type the payee’s name.',
  stoppedSub: 'Payments the shield stopped, and why',
  throughSub: 'Paused payments you let go on',
  safeSub: 'Payments where the shield found nothing',
  weekSub: 'What the shield checked, and every check side by side',
  empty: {
    paused: 'Nothing is paused for you.',
    stopped: 'Nothing was stopped.',
    through: 'You haven’t let a paused payment go on.',
    safe: 'No payment has been checked and found safe yet.',
  },

  noVerdict: 'no verdict',
  noVerdictTitle: 'The shield has not recorded a verdict for this deal.',
  release: 'Review & release',
  review: 'Review',
  releaseTitle: 'Opens the approval window, where you type the payee’s name to release it',
  reviewTitle: 'Opens the approval window to decide. Nothing moves until you confirm there.',
  releaseMeans: 'You start here; you type the payee’s name and release it in the approval window. Releasing doesn’t pay: you still approve the payment on PayPal after.',
  reviewMeans: 'The approval window decides. Nothing moves until you confirm there.',
  opened: 'The approval window is open · type the payee’s name there to release. Releasing doesn’t pay: you still approve on PayPal after.',
  approvalWhat: 'Approval window',
  openDeal: 'Open deal ›',
  openDealMeans: 'See the whole deal. Nothing moves from here.',
  refuse: 'Refuse…',
  refuseWhat: 'Refuse',
  refuseTitle: (title: string) => `Refuse “${title}”?`,
  keepPaused: 'Keep it paused',
  refuseAct: 'Refuse purchase',
  refusing: 'Refusing…',
  refused: (title: string) => `${title} refused · no money moved and PayPal was never asked.`,
  refuseFacts: [
    ['What happens', 'The purchase is cancelled for good.'],
    ['Money', 'None moves. PayPal was never asked, so there is nothing to undo.'],
    ['Where', 'Right here. Saying no never needs the approval window.'],
  ] as ReadonlyArray<readonly [string, string]>,
  pausedBefore: 'Paused before PayPal',
  letGo: (who: string) => `Let this payment to ${who} go ahead?`,
  whatNow: (who: string) => `What should happen with the payment to ${who}?`,
  whyPaused: 'Why it was paused',
  closedChip: 'Paused, then closed',
  closedTitle: 'The shield paused it and it closed without being released',

  row: {
    blocked: (why: string | null, paypal: string) => `Blocked for good${why ? ` · ${why.toLowerCase()}` : ''} · it can’t be released · ${paypal}`,
    paused: (why: string | null) => `Paused for you${why ? ` · ${why.toLowerCase()}` : ''}`,
    closed: (why: string | null, then: string, paypal: string) => `Paused by the shield${why ? ` · ${why.toLowerCase()}` : ''} · then ${then} · ${paypal}`,
    clear: (state: string) => state,
    released: (module: string) => `You let it go on after a pause · decided in ${module}`,
    other: (why: string | null, module: string) => `${why ? `${why.toLowerCase()} · ` : ''}decided in ${module}`,
  },

  scope: { label: 'Which payments', week: 'This week', all: 'Everything checked' },
  show: { label: 'Show', all: 'Everything', outcome: 'Outcome only', outcomeTitle: 'Fade the checks and keep what the shield said and what you decided' },
  unshown: 'Payee match reports only through “Shield says”. Friends & family and the message check are not active yet.',
  checksLabel: 'Every payment the shield checked',
  checksEmpty: 'Nothing paused, nothing blocked. The shield hasn’t had to check anyone yet.',
  checksEmptyWeek: 'The shield checked nothing this week. Everything older is under “Everything checked”.',
  col: { payee: 'Payee', amount: 'Amount', says: 'Shield says', newPayee: 'New payee', price: 'Price vs typical', paypal: 'PayPal', decision: 'Your decision' },
  filter: { label: 'Show', paused: 'Waiting for you', blocked: 'Blocked', newPayee: 'New payee', price: 'Odd price', clear: 'Looked safe' },
  move: {
    blocked: 'Blocked for good',
    yours: 'Paused · your call',
    closed: (state: string) => `Closed · ${state}`,
    elsewhere: (module: string) => `Nothing to do · ${module} decides`,
  },

  story: {
    payee: 'Payee',
    wants: 'Wants', amount: 'Amount', now: 'Now', firstSeen: 'First seen', who: 'Who', house: 'the house seller built into this app',
    says: 'Shield says',
    decidedBy: 'Decided by:',
    released: 'You let it go on after a pause, for these terms only. A change to the deal is checked again.',
    strictest: 'The strictest result wins. A check can only make a payment safer, and a block is final.',
    price: 'Price against typical',
    paypal: 'PayPal',
    moneyNow: (now: string) => `Money right now: ${now}.`,
    order: 'Order', hold: 'Hold', payment: 'Payment',
    note: 'Their note, shown as plain text',
    decision: 'Your decision',
    blockFinal: 'Nothing to decide: blocked for good. No button anywhere can release a block, and no PayPal link was ever opened.',
    nothing: (verdict: string, module: string) => `“${verdict}” only means nothing stopped it here. Whether it is approved is decided by your rules, in ${module}.`,
  },
  noTypical: 'No typical price on file, so the shield asks you.',
  typical: 'typical',
  pauseLine: 'pause line',
  bandLabel: (price: string, typical: string, lo: string, hi: string, pause: string) => `Price ${price}; typical ${typical}, usually ${lo} to ${hi}; the shield pauses above ${pause}`,
  bandHint: (lo: string, hi: string, typical: string) => `Usually ${lo} to ${hi} · typical ${typical} · a reference, not advice`,

  how: {
    title: 'How the shield works',
    short: [
      { title: 'New payees get checked', text: 'Every payee is looked at before any PayPal call.' },
      { title: 'Odd prices pause it', text: 'A price far above typical stops the payment.' },
      { title: 'Only you can unpause', text: 'Releasing happens in the approval window.' },
    ],
    all: 'All the checks ›',
    lede: 'Before any money goes to a payee, the shield runs these checks. The strictest result wins, and a check can only make a payment safer, never approve one.',
    checks: 'The checks',
    ifFinds: 'If it finds something:',
    noPrice: 'With no typical price to compare, the price check never waves a payment through: it asks you.',
    results: 'What each result means',
    messages: 'Their messages',
    messagesText: 'The wallet does not read a payee’s message for scam signs yet, and it does not check for friends & family requests yet. Neither counts in the verdict today. Your agents never act on what the payee wrote.',
    hatch: 'no typical price to compare, so it asks you',
    noteChip: 'note ›',
    noteText: 'their own words, shown as plain text',
  },
} as const;

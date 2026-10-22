// Words for the book area of the console (rebuild WP3). Owned by the WP3 builder of this area; every
// user-facing string of the area goes here, never inline. Re-exported from lib/words.ts by one
// `export *` line, so importers keep `import { X } from '../lib/words'`. Rules (docs/ux/UX-GUIDE.md):
// sentence case, Maya's words, no internals (commands, ids, clause numbers, raw states), PayPal is
// the only vendor name, every needs-you line carries "If you do nothing". Prefix exports with the
// area (e.g. `BOOK_`): two areas exporting one name is a type error in lib/words.ts.

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The Book's nested views: the crumb label and the view's heading. */
export const BOOK_VIEWS_TITLE = {
  ledger: 'The ledger',
  recent: 'Recent payments',
  outlook: 'Outlook',
  record: 'The record',
  ask: 'Ask your book',
  proof: 'Check a proof file',
} as const;

/** The console footer's "paid out today" (scale finding #9): what it leaves out, in its tooltip. */
export const BOOK_TODAY = {
  nothing: 'nothing yet',
  title: (held: string | null, committed: string | null, budget: string | null, limit: string | null): string => [
    'Your agents’ payments PayPal collected today (from midnight UTC), as the Book counts them.',
    held && committed ? `Not counted here, because it is not paid: ${held} on hold and ${committed} agreed and waiting.` : 'Money on hold or agreed and waiting is not counted here: it is not paid.',
    budget && limit ? `Your agents agreed ${budget} today, of your ${limit} daily limit.` : null,
  ].filter(Boolean).join(' '),
} as const;

type OutlookWords = { label: (n: number) => string; short: string; totalNote: string; none: string; ifNothing: string };

export const BOOK = {
  title: 'Book',
  loading: 'your book',
  ledgerWhat: 'Ledger',
  dash: '—',
  in: 'in',
  out: 'out',
  goingOut: 'going out',
  comingIn: 'coming in',
  payments: (n: number) => plural(n, 'payment', 'payments'),
  checkingLine: (n: number) => `${plural(n, 'payment is', 'payments are')} being checked with PayPal: not paid, and not on hold.`,
  safety: 'Your safety record',
  safetyTitle: 'Every entry on record: who decided each money step, and what your agents were refused',

  answer: {
    nothing: 'Nothing yet. No payments are on record.',
    nothingSub: 'They appear here as soon as an agent proposes a deal.',
    both: (out: string, inn: string) => `This week: ${out} paid out, ${inn} paid in.`,
    out: (out: string) => `This week: ${out} paid out. Nothing paid in yet.`,
    in: (inn: string) => `This week: ${inn} paid in. Nothing paid out.`,
    none: 'This week: no money has moved yet.',
    /** Held money, said apart from paid money: it is not paid. */
    held: (out: string, inn: string): string | null => {
      if (out && inn) return `${out} going out and ${inn} coming in are on hold at PayPal, not paid yet.`;
      if (out) return `${out} is on hold at PayPal, not paid yet.`;
      if (inn) return `${inn} coming in is on hold at PayPal, not paid yet.`;
      return null;
    },
    stopped: (n: number) => `${plural(n, 'payment was', 'payments were')} stopped or paid back.`,
  },

  cards: {
    money: 'This week’s money',
    paidOut: (m: string) => `${m} paid out`,
    noOut: 'Nothing paid out',
    paidIn: (m: string) => `${m} paid in`,
    today: (m: string) => `Today ${m}`,
    nothingToday: 'nothing yet',
    outlook: 'Outlook',
    waits: (n: number) => plural(n, 'thing waits', 'things wait'),
    nothingWaits: 'Nothing waiting',
    outlookNote: (held: string) => (held ? `${held} on hold, not paid` : 'Holds, payment links and renewals'),
    outlookNone: 'No holds, links or renewals',
    check: 'Check',
    record: 'The record',
    recordValue: 'Every step, newest first',
    recordNote: 'Who took it, and on whose authority',
    ask: 'Ask your book',
    askValue: 'Ask in your own words',
    askNote: 'Or tap a question about your week',
  },

  how: {
    title: 'How your book works',
    items: [
      { title: 'Every payment, one list', text: 'All the money your agents moved or planned.' },
      { title: 'A hold isn’t a payment', text: 'PayPal keeps the money aside until it is collected, so it is never counted as paid.' },
      { title: 'Checked against PayPal', text: 'Each payment is matched to PayPal’s own statement.' },
      { title: 'Only reads', text: 'Nothing in the Book can move money or change a deal.' },
    ],
  },

  tiles: {
    label: 'Totals, each kept apart',
    out: 'Paid out', outNote: 'the money moved',
    in: 'Paid in', inNote: 'the money moved',
    held: 'On hold', heldNote: 'not paid yet',
    stopped: 'Stopped', stoppedNote: 'never paid, or paid back',
    why: (label: string) => `Why this figure for “${label}”?`,
  },

  scope: { label: 'Which deals', week: 'This week', all: 'Everything on record' },
  ledgerSubWeek: (n: number) => `${plural(n, 'deal', 'deals')} started or changed this week`,
  ledgerSubAll: (n: number) => `${plural(n, 'deal', 'deals')} on record`,
  recentSub: 'Every payment, newest first',
  list: {
    week: 'This week’s deals',
    all: 'Every deal on record',
    empty: 'No deals yet. They appear here as soon as an agent proposes one.',
    emptyWeek: 'No deal started or changed this week. Everything older is under “Everything on record”.',
    noMatch: 'No deal matches. Every deal is still here.',
  },
  filter: {
    label: 'Show',
    paid: 'Paid', held: 'On hold', motion: 'In progress', unconfirmed: 'Not confirmed', stopped: 'Stopped',
    checking: 'Checking with PayPal', checkingTitle: 'PayPal’s answer was lost: not paid, and not on hold',
  },
  sort: { newest: 'Newest first', oldest: 'Oldest first', largest: 'Largest first' },
  went: 'Where the money went, and does PayPal agree?',
  proofOpen: 'Check a proof file',
  proofTitle: 'Check a signed proof file someone sent you, or one you saved',
  csv: 'Export CSV',
  csvTitle: 'Save these deals as a spreadsheet file. Nothing is uploaded.',
  saved: (file: string, n: number, modes: string) => `${file} saved · ${plural(n, 'row', 'rows')}, each marked ${modes}. Nothing was uploaded.`,

  stmtReading: 'Reading PayPal’s statement for this payment',
  stmtUnread: 'PayPal’s statement for this payment could not be read',
  ofMarket: 'of the market range',
  noMarket: 'no market price to compare',
  marketTip: (where: string, lo: string, hi: string, mid: string) => `${where} · usual ${lo} to ${hi} · typical ${mid}`,
  checkedAt: (at: string) => `checked ${at}`,
  k: {
    with: 'With', what: 'What', money: 'Money', when: 'When', deadline: 'Time left', decided: 'Decided by', receipt: 'Receipt',
    statement: 'Statement', market: 'Market', vsMarket: 'Against the market', rules: 'Rules',
  },
  what: (kind: string, selling: boolean, qty: number, item: string) => `${kind} · you ${selling ? 'sell' : 'buy'} · ${qty > 1 ? `${qty} × ` : ''}${item}`,
  when: (started: string, changed: string | null) => `started ${started}${changed ? ` · last change ${changed}` : ''}`,
  noTime: 'no time recorded',
  rulesVersion: (v: number) => `signed rules, version ${v}`,
  proofWhat: 'PayPal proof',
  proofLoading: 'the PayPal proof',
  notesNever: 'Their notes never show here; open the deal to read them.',
  openDeal: 'Open the deal ›',

  outlookSub: 'What waits on a deadline. Counted from your deals, not a forecast.',
  outlookLabel: 'What waits',
  outlookList: 'The deals that wait',
  outlookEmpty: 'Nothing waits: no holds, open payment links, failing renewals or payments being checked.',
  soonest: 'Soonest:',
  notForecast: (n: number) => `${plural(n, 'deal waits', 'deals wait')} in all. Counted from your deals, not a forecast.`,
  outlook: {
    holds: { label: (n: number) => (n === 1 ? 'hold to decide' : 'holds to decide'), short: 'Holds', totalNote: 'on hold at PayPal in all, not paid', none: 'No money on hold', ifNothing: 'the hold is released, nothing is paid' },
    links: { label: (n: number) => (n === 1 ? 'payment link open' : 'payment links open'), short: 'Payment links', totalNote: 'in all, not paid yet', none: 'No open payment link', ifNothing: 'the link lapses, no money moves' },
    renew: { label: (n: number) => (n === 1 ? 'renewal failing' : 'renewals failing'), short: 'Renewals', totalNote: 'at risk in all', none: 'No renewal failing', ifNothing: 'PayPal retries on its own' },
    checking: { label: (n: number) => (n === 1 ? 'payment being checked with PayPal' : 'payments being checked with PayPal'), short: 'Being checked', totalNote: 'in all, neither paid nor held', none: 'Nothing being checked', ifNothing: 'what PayPal shows decides' },
  } satisfies Record<'holds' | 'links' | 'renew' | 'checking', OutlookWords>,

  record: {
    sub: 'Every step, newest first. Each one is linked to the one before it, so a change to an earlier step shows.',
    label: 'Every step on record',
    what: 'The record',
    loading: 'the record',
    todo: 'What to do',
    again: 'Check again',
    checking: 'Checking…',
    reading: 'Reading…',
    older: 'Read older steps',
    newest: 'Back to the newest',
    goDay: 'Go to a day',
    readSoFar: (n: number) => `${n.toLocaleString('en-GB')} newest steps read · older ones load as you scroll`,
    dayShort: 'The record could not be read back to that day yet. Try the day again, or read older steps.',
    readAll: (n: number) => `All ${n.toLocaleString('en-GB')} steps read`,
    empty: 'Nothing on record yet.',
    hint: 'Read-only. Opening a step that names a deal opens that deal.',
    filter: { label: 'Show', money: 'Money steps', decided: 'Decisions', you: 'Yours' },
    actor: { owner: 'You', policy: 'Your rules', agent: 'Your agent', pipeline: 'Your wallet', paypal: 'PayPal', house: 'The house seller', counterparty: 'The other side' },
    actorOther: 'Your wallet',
    action: {
      'deal.transition': 'A deal moved on',
      'deal.countersigned': 'A deal was approved',
      'deal.created': 'A deal started',
      'deadline.set': 'A deadline was set',
      'deadline.swept': 'Deadlines were checked',
      'intent.refused': 'Your agent was refused',
      'mandate.signed': 'Rules were signed',
      'pairing.confirmed': 'A wallet was connected',
      'preferences.changed': 'Settings changed',
      'engine.run': 'Your agent ran',
      'market.refresh': 'Market prices were checked',
      'reporting.polled': 'PayPal’s statement was checked',
      'money.authorized': 'PayPal put money on hold',
      'money.create_order': 'PayPal was asked to make an order',
      'money.authorize': 'PayPal was asked to hold the money',
      'money.capture': 'PayPal was asked to collect the money',
      'money.void': 'PayPal was asked to release a hold',
      'money.auto_void': 'A hold was released at its deadline',
      'money.refund': 'PayPal was asked to pay money back',
      'money.unconfirm': 'PayPal’s statement did not show a payment',
      'money.invoice': 'PayPal was asked to send an invoice',
    },
    paypalStep: 'A step at PayPal',
    dealStep: 'A step on a deal',
    actionOther: 'A step by your wallet',
  },

  ask: {
    sub: 'Only reads your deals. Nothing can change.',
    label: 'Ask the book',
    placeholder: 'Ask about your agents’ money, in your own words',
    title: 'For example: how much was paid this week, by shop? Enter asks, Esc clears.',
    ask: 'Ask',
    yours: 'Your question',
    slip: 'Your question and its answer',
    readOnly: 'Ask in your own words, or tap a question. Your wallet reads it itself: no AI, and nothing can change.',
    show: 'Show answer',
    runKey: 'Ctrl+Enter',
    clearKey: 'Esc',
    clear: 'Clear',
    discard: 'Discard',
    whatAsks: 'What this view asks',
    howAsked: 'How this answer was asked',
    chip: { unsure: 'not sure', blocked: 'can’t run', ready: 'ready', answer: 'answer', none: 'nothing found' },
    line: {
      unsure: 'nothing was looked up · try one of these',
      blocked: 'this view can’t run yet',
      drafted: 'only reads your deals · changes nothing',
      result: (n: number) => `${plural(n, 'deal', 'deals')} in the answer`,
      // The Simple view's week is a window on the ledger, an answer is not: say how far it reaches.
      older: (n: number) => `${plural(n, 'older deal', 'older deals')} from before this week`,
      everything: 'everything on record, not only this week',
    },
    thisView: 'This view',
    onlyReads: (n: number) => `It only reads your ${n} deals: no PayPal call, and nothing can change. Your wallet checks the question before it answers.`,
    queryKey: { view: 'Looks at', filter: 'Only', range: 'When', group_by: 'One line per', metrics: 'Shows' },
    groupHead: { kind: 'Kind', counterparty: 'Who', state: 'Status', day: 'Day', decided_by: 'Decided by' } as Record<string, string>,
    kinds: { haggle: 'Haggles', purchase: 'Purchases', shop_order: 'Shop orders', rescue: 'Rescues', invoice: 'Invoices' },
    allRows: 'all rows',
    inView: 'In this view',
    deals: 'Deals',
    vsMarket: 'vs market',
    recovered: 'Recovered',
    statement: 'PayPal statement',
    ofN: (n: number) => `of ${n}`,
    noMarket: 'no market price',
    noneWord: 'none',
    walletAnswering: 'the wallet’s answer',
    walletWhat: 'The wallet’s answer',
    walletLine: (n: number) => `Checked by your wallet · ${plural(n, 'line', 'lines')} · each currency and mode on its own line, and money out and money in on separate lines`,
    amountLeftOut: 'Amounts are left out here: with no status picked they would add paid, on hold, in progress and stopped money together. Pick a status, or ask by status, to see them.',
    currency: 'Currency', mode: 'Mode', money: 'Money', rows: 'Rows', amount: 'Amount',
    noRows: 'No rows match.',
    behind: (n: number) => `The ${plural(n, 'deal', 'deals')} behind this answer`,
    behindLabel: 'The deals behind this answer',
    none: 'No deal is in this answer.',
  },

  proof: {
    sub: 'A signed proof file someone sent you, or one you saved, checked by your wallet. Only reads.',
    choose: 'Choose a proof file',
    another: 'Check another file',
    checking: 'Checking…',
    what: 'Proof file',
    checks: 'What is checked',
  },
} as const;

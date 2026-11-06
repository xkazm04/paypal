// Prototype strings for the TOUR simulated first project, round 4: the AI-led setup, one step per turn.
// Every count reaches these functions as an argument (from useStart or the rules draft); no figure of
// the wallet is typed here. Each "why" is one sentence of at most 20 words.
import type { StartStepKey } from '../../../../../../lib/words';

export type StepWords = {
  /** Short name, for "Back to: …" and the turn header. */
  short: string;
  /** How the assistant brings the step up after the one before ("Next, the rules your agents follow."). */
  lead: string;
  /** One sentence of why, under the turn. */
  why: string;
  /** What the assistant says once the wallet calls it done. */
  done: string;
  /** The one spotlight after it: where the result now lives. */
  spot: string;
};

export const STEP: Record<StartStepKey, StepWords> = {
  paypal: {
    short: 'PayPal keys',
    lead: 'First, your PayPal sandbox keys.',
    why: 'Your agents pay through PayPal sandbox: test money only, so nothing real can move.',
    done: 'Keys saved.',
    spot: 'Every payment will land here, in Book.',
  },
  rules: {
    short: 'Rules',
    lead: 'Next, the rules your agents follow.',
    why: 'Here is a safe start. Your agents can never spend outside these rules.',
    done: 'Rules signed.',
    spot: 'Each purchase is checked against your rules. They show up in Spend.',
  },
  practice: {
    short: 'Practice shop',
    lead: 'Now meet the practice shop.',
    why: 'A demo shop that is always open. Your first deal there uses sandbox money.',
    done: 'The practice shop is connected.',
    spot: 'Practice deals show up here, in Tables.',
  },
  engine: {
    short: 'Agent app',
    lead: 'Last, the app your agents run in.',
    why: 'Pick an app on this computer, or keep the practice agent for now.',
    done: 'Agent app chosen.',
    spot: 'Ask your agents anything, right here.',
  },
};

export const TOUR_W = {
  open: 'Four quick steps and your agents can work.',
  resume: 'Welcome back.',
  stepOf: (n: number, total: number): string => `${n} of ${total}`,
  skip: 'Skip for now',
  skipTitle: 'Leave setup for now. Your progress is kept; “Continue setup” picks it up again.',
  paused: (n: number, total: number, short: string): string => `Setup paused at ${n} of ${total}, ${short}. Pick it up whenever you like.`,
  continue: 'Continue setup',
  backTo: (short: string): string => `Back to: ${short}.`,
  folded: 'Moved below.',
  // the secure step closed without finishing
  closed: 'Closed without finishing.',
  reopen: 'Open it again',
  // rules: the proposal
  rulesKick: 'Proposed rules',
  perDeal: (amount: string): string => `Up to ${amount} a deal`,
  perDay: (amount: string): string => `${amount} a day at most`,
  askAbove: (amount: string): string => `Asks you above ${amount}`,
  askAlways: 'Asks you before every payment',
  payees: 'Pays only the practice shop',
  payeesOther: (who: string): string => `Pays only ${who}`,
  until: (when: string): string => `Until ${when}`,
  looksRight: 'Looks right',
  change: 'Change something',
  changeHint: 'Tell me below what to change, like “$80 a deal”, “$200 a day” or “ask me above $20”.',
  changed: (parts: string): string => `Changed: ${parts}. Does it look right now?`,
  unchanged: 'I could not read a change in that, so the rules stay as they were.',
  rulesUnread: 'These rules could not be read. Skip for now and set them later.',
  part: {
    perDeal: (a: string): string => `up to ${a} a deal`,
    perDay: (a: string): string => `${a} a day`,
    askAbove: (a: string): string => `ask above ${a}`,
    ends: (w: string): string => w,
  },
  // practice: the shop's join
  paidTo: 'Paid to',
  paidToHint: 'your PayPal sandbox email',
  paidToTitle: 'Where money to you is paid: your PayPal sandbox email, or a name with no spaces.',
  connect: 'Connect to the shop',
  waking: 'Waking the shop…',
  shopWhat: 'Practice shop',
  shopUnavailable: 'This build has no practice shop. Skip this step for now.',
  // engine: one row of choices
  engineLabel: 'Agent app',
  enginePractice: 'Practice agent',
  enginePracticeTitle: 'Keep the practice agent for now; add an app any time',
  engineOff: 'not installed',
  // the end
  setUp: 'You’re set. Your agents can work now, and nothing pays outside your rules.',
  setUpPartial: (left: number): string => `That’s the tour. ${left === 1 ? 'One step is' : `${left} steps are`} left whenever you like.`,
  where: 'Where things are',
  pointers: [
    { region: 'status', label: 'Status line', spot: 'How things stand, in one line. Read it and you know your day.' },
    { region: 'side-list', label: 'Your deals', spot: 'Every deal, one line each. Click one to open it as a page.' },
    { region: 'ask', label: 'Ask box', spot: 'Ask anything. Press / to jump here from anywhere.' },
  ],
  spotLabel: 'Where to look',
  spotClose: 'Got it',
} as const;

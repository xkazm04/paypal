// Strings for the GUIDE simulation (spark abstract-first-home round 3): the assistant walks a brand-new
// owner through the first project in the conversation. Every number reaches these functions as an
// argument from useStart (the world), never from a model reply.
import type { StartStepKey } from '../../../../../../lib/words';

export const SG = {
  // ---- the opening turn
  open: 'Welcome. Let’s set up your first project together - about 3 minutes.',
  openBack: (done: number, total: number): string => `Welcome back. Let’s finish setting up your first project - ${done} of ${total} done.`,
  openSet: 'Your first project is already set up. Here is what you have.',
  planLead: 'In order, right here - each takes about a minute. When a step needs the wallet’s secure step, it opens inside this conversation.',
  planAsk: 'Ask me anything on the way: type below, and I pick up where we were.',
  start: 'Start',
  continue: 'Continue setup',
  skip: 'Skip for now',
  skipTitle: 'Back to your home. Your progress is kept; “Continue setup” picks it up.',
  progress: (done: number, total: number): string => `${done} of ${total} done`,
  progressLabel: 'Setup progress',
  stepOf: (n: number, total: number): string => `Step ${n} of ${total}`,
  // ---- a step's turn
  stepTurn: (n: number, total: number, title: string): string => `Step ${n} of ${total}: ${title}.`,
  backTo: (n: number, total: number, title: string): string => `Back to setup - step ${n} of ${total}: ${title}.`,
  movedBelow: 'Continued below.',
  stillOpen: 'Your secure step is still open above - finish it there, and I carry on.',
  jump: (title: string): string => `Back to: ${title}`,
  pausedHere: 'Paused here.',
  // ---- pause and resume
  paused: (done: number, total: number): string => `Paused at ${done} of ${total}. Your progress is kept - pick it up any time.`,
  // ---- the ending
  done: 'You’re set up.',
  doneLead: 'Your wallet is ready for a first safe deal. Everything you just did stays where I showed you.',
  doneWhere: [
    'The line at the top says whether your money is safe and the one thing that needs you.',
    'The side panel lists every item by module; a click opens it here as its own page.',
    'The box below answers anything, and can open the right module for you.',
  ],
  home: 'Show my home',
  homeTitle: 'Your home, on this new wallet',
  leave: 'Leave the simulation',
  leaveTitle: 'Back to the sample week',
  // ---- the secure step (the real approval page)
  secure: 'Secure step',
  secureInline: 'in the app this is its own window',
  secureFrameTitle: (what: string): string => `Secure step: ${what}`,
  secureNote: 'This is the real approval page, embedded here for the simulation. Only it can save keys, sign rules or confirm a shop; this conversation never can.',
  secureOpen: 'Open the secure step',
  secureWaiting: 'The secure step is open in its own window. Finish there - I carry on here when it’s done.',
  secureClose: 'Hide the secure step',
  // ---- per step
  keysBody: 'Test money only. Registering at developer.paypal.com gives you a sandbox business account with its keys.',
  keysSecret: 'In the secure step, press “Add PayPal keys”: a dialog the wallet owns takes each key. Nothing secret passes through this conversation.',
  rulesBody: 'Say what your agents may do first. Pick one to start - you can change every limit in the secure step before you sign.',
  rulesRead: 'I read it as',
  rulesNone: 'I can’t read that one as rules yet - pick another.',
  rulesAct: 'Review and sign',
  rulesPick: 'A first set of rules',
  practiceBody: 'A practice shop that is always open, with sandbox money. Your agents need someone to deal with before their rules can name who they may pay, so we meet the shop first. Connect here; then you check four words in the secure step, so you know it really is the shop.',
  practicePaid: 'Paid to',
  practicePaidHint: 'Where money to you is paid: your PayPal sandbox email, or a shop name with no spaces.',
  practiceAct: 'Connect to the practice shop',
  practiceWaking: 'Waking the shop…',
  practiceWords: 'The shop answered. Check these four words in the secure step:',
  practiceWhat: 'Practice shop',
  practiceUnavailable: 'This build has no practice shop. Skip this step for now.',
  engineBody: 'Your agents run in an app on this computer. Pick one, or keep the practice agent for now.',
  // ---- what the owner may ask at each step (goes through the real assistant)
  ask: {
    paypal: 'Why do I need PayPal sandbox keys?',
    rules: 'What can my agents do without rules?',
    practice: 'Is the practice shop real money?',
    engine: 'What is an agent app?',
  } satisfies Record<StartStepKey, string>,
  // ---- pointing at what just appeared
  where: {
    status: 'Your today line',
    book: 'Book · every payment',
    spend: 'Spend · read against your rules',
    tables: 'Tables · your deals',
    ask: 'Ask anything here',
  },
} as const;

/** The step titles in the guide's voice. */
export const SG_STEP: Record<StartStepKey, string> = {
  paypal: 'add your PayPal sandbox keys',
  rules: 'sign your agents’ rules',
  practice: 'meet the practice shop',
  engine: 'choose your agent app',
};

/** One line of onboarding after each step: what just appeared and where to find it again. */
export const SG_LEARNED: Record<StartStepKey | 'intro', string> = {
  intro: 'First, the line at the top: it always says whether your money is safe and the one thing that needs you. Right now, that’s setup.',
  paypal: 'Keys saved, in your computer’s secure store. Every payment will land in Book, in the side panel - empty until your first deal.',
  rules: 'Rules signed. Your agents act only inside them, and every purchase is checked against them in Spend.',
  practice: 'The practice shop is connected, so your rules can name it. Haggling lives in Tables: your first practice deal shows up there as a row, and a click opens it here as its own page.',
  engine: 'Your agents have their app. The box below is for anything else: ask, and I answer here or open the right module.',
};

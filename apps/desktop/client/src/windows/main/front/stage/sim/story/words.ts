// spark abstract-first-home round 3, sim STORY ("learn by doing a first deal"): prototype strings.
// Every figure reaches these functions as an argument (the recorded practice haggle, useStart's
// count); nothing here types a price. The goal sentences are read by the wallet's own fixed-grammar
// rules reader (lib/say/read.ts): story.test.ts pins that each one reads into rules.
import type { StartStepKey } from '../../../../../../lib/words';

export type GoalId = 'haggle' | 'askFirst';

/** The suggested first goals. Both are the practice shop's one item (the house seller sells a
 *  monitor), so the practice story the owner then watches is about the goal she picked. */
export const GOALS: Record<GoalId, { label: string; sub: string; sentence: string }> = {
  haggle: {
    label: 'Haggle for a monitor from the practice shop, up to $340',
    sub: 'Your agent bargains; above $250 it asks you first.',
    sentence: 'Haggle for a monitor, up to $340, ask me above $250, six offers, for 3 days',
  },
  askFirst: {
    label: 'Same monitor, but ask me before any payment',
    sub: 'Your agent bargains; you approve every payment yourself.',
    sentence: 'Haggle for a monitor up to $340 and ask me before paying, for 3 days',
  },
};

export const STORY = {
  // ---- the opening
  opening: 'What should your agents do first?',
  openingSub: 'Pick a first goal and we will do it together, as a practice deal with test money. I will set up only what the deal needs, when it needs it.',
  backAgain: 'Welcome back. Your first deal is where you left it.',
  progress: (done: number, total: number): string => `Setup ${done} of ${total}`,
  progressLabel: (done: number, total: number): string => `Setup progress: ${done} of ${total} steps done`,
  skip: 'Skip for now',
  skipTitle: 'Leave the story; your progress is kept and you can continue from the conversation',
  skipped: 'Paused. Everything you did is kept.',
  resume: 'Continue setup',
  resumeLine: (what: string): string => `Next in your first deal: ${what}.`,
  // ---- picking a goal
  picked: (label: string): string => `Good: ${label.charAt(0).toLowerCase()}${label.slice(1)}. Let’s make it happen.`,
  // ---- the agent app (only when needed)
  engineAsk: 'First, who bargains for you? Your agents run in an agent app on this computer.',
  engineBody: 'Pick one, or let the practice agent play this first deal. You can change it any time.',
  engineLooking: 'Looking for agent apps on this computer…',
  engineDone: (name: string): string => `Your agents run in ${name}.`,
  enginePracticeDone: 'The practice agent plays for you: a built-in agent with fixed price rules.',
  engineDoneWhere: 'You can change it later from Everything › Setup.',
  enginePractice: 'Let the practice agent play this first deal',
  // ---- the practice shop
  shopAsk: 'Now meet the shop. The practice shop is a demo seller built into the app: always open, test money only.',
  shopBody: 'Connecting gives both sides four matching words, then you confirm them in the secure step. Nothing is bought yet.',
  shopPayee: 'Paid to (if you ever sell)',
  shopPayeeHint: 'Your PayPal email or a shop name, no spaces.',
  shopPayeePlaceholder: 'you@example.com',
  shopConnect: 'Connect to the practice shop',
  shopWaking: 'Waking the practice shop…',
  shopWords: 'The shop answered with these four words:',
  shopConfirmLead: 'Confirm the four words',
  shopDone: 'Connected. The practice shop is now one of your connections.',
  shopDoneWhere: 'It will show in the side list once you have a deal with it.',
  // ---- the rules: the first moment money would be at stake
  rulesAsk: 'Before your agent makes a single offer, money would be at stake. So the wallet needs your rules, signed by you.',
  rulesBody: 'I read your goal with a fixed word list, no AI. Check what it allows, then sign it in the secure step.',
  rulesReads: 'Your goal, read as rules',
  rulesUnread: 'I could not read this goal as rules. You can write them in the secure step instead.',
  rulesSign: 'Review and sign',
  rulesDone: 'Signed. Your agents can now act, but only inside these rules.',
  rulesDoneWhere: 'Your rules live in Everything › Rules; ask me “what are my agents allowed?” any time.',
  // ---- the secure step (inline in the browser preview, its own window in the app)
  secureTag: 'In the app this is its own window',
  secureNoteInline: 'This is the real approval screen, running here because this is the browser preview. In the app it opens as its own small window that only you can use, and closes by itself when you are done.',
  secureOpen: 'Open the secure window',
  secureWaiting: 'Waiting for the secure step… I’ll carry on here when it’s done.',
  secureFrame: (what: string): string => `Secure step: ${what}`,
  secureWhat: { practice: 'confirm the practice shop', rules: 'sign your rules', paypal: 'save your PayPal sandbox keys' } as Record<Exclude<StartStepKey, 'engine'>, string>,
  // ---- the practice deal (simulated)
  dealAsk: 'Your agent opens the table with the practice shop. Watch it bargain.',
  dealOpen: 'Watch the practice deal',
  dealTitle: 'Monitor · practice shop',
  dealTag: 'Practice · simulated offers',
  dealTagTitle: 'A replay of a practice haggle the shipped practice agent recorded against the house seller. No deal was opened in your wallet.',
  dealSub: 'A replay of a recorded practice haggle: the same shop, the same agent, the same rules.',
  dealHappened: 'What happened',
  by: { seller: 'The shop', agent: 'Your agent', owner: 'You' } as const,
  act: {
    listing: 'listed it at', offer: 'offered', counter: 'came down to', accept: 'accepted', withdraw: 'walked away', refused: 'wanted to accept',
  } as const,
  refusedWhy: 'the wallet held it: your rules say you decide here',
  decisionLead: 'This is the decision moment.',
  decisionWhy: (price: string, limit: string): string => `The shop’s last price is ${price}. Your rules say above ${limit} your agent must ask you, so the wallet held the yes and put it in front of you.`,
  decisionWhyAsk: (price: string): string => `The shop’s last price is ${price}. Your rules say ask me before paying, so the wallet held the yes and put it in front of you.`,
  decisionAccept: (price: string): string => `Accept ${price}`,
  decisionWalk: 'Walk away',
  decisionNote: 'Practice: in a real deal this button opens the secure step to approve. Here nothing is signed or paid.',
  resultAgreed: (price: string): string => `Agreed at ${price}. Practice: no money moved.`,
  resultWalked: 'You walked away. No money moved.',
  resultWhere: 'In a real deal, this is where it lands:',
  resultTables: 'Tables: the deal and every offer',
  resultBook: 'Book: the payment, once it is made',
  resultEmpty: 'Both are empty now: your first real deal is the first row.',
  seeTables: 'Show me Tables',
  seeBook: 'Show me Book',
  dealDoneSay: 'That was your first deal, start to finish. The wallet held the one moment that needed you.',
  dealDoneWhere: 'Deals live in Tables on the right; the money they move lives in Book.',
  dealLoading: 'Loading the practice replay…',
  dealUnread: 'The practice replay could not load in this build.',
  dealNext: 'Next: make it real',
  // ---- keys last
  keysAsk: 'Make it real with PayPal sandbox. Real deals pay through your PayPal sandbox account: test money, but real PayPal.',
  keysBody: 'Registering at developer.paypal.com gives you a sandbox business account and its keys. You type them into a secure dialog, never into this window.',
  keysAct: 'Add my sandbox keys',
  keysLater: 'Later',
  keysDone: 'Keys saved securely on this computer.',
  // ---- the ending
  setUp: 'You’re set up.',
  setUpSub: 'Your rules are signed, the practice shop is connected and your agents know where to run. From now on, the first line here tells you if anything needs you.',
  setUpTour: [
    'The line at the top: is your money safe, does anything need you.',
    'The list on the right: every deal and payment, one row each. Pick one to open it here.',
    'The ask box: ask anything, like “what if I do nothing?”.',
  ],
  setUpGo: 'Go to my home',
  setUpPartial: (left: number): string => `${left === 1 ? 'One step is' : `${left} steps are`} still open; you can finish ${left === 1 ? 'it' : 'them'} any time from here.`,
  // ---- the progress line
  stepName: { engine: 'Agent app', practice: 'Practice shop', rules: 'Rules', paypal: 'PayPal keys' } as Record<StartStepKey, string>,
  nextWhat: {
    goal: 'pick a first goal', engine: 'choose who bargains for you', shop: 'meet the practice shop', rules: 'sign your rules',
    deal: 'watch your practice deal', keys: 'add your PayPal sandbox keys', done: 'nothing, you are set up',
  } as const,
} as const;

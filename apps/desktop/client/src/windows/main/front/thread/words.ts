// Prototype strings for the GREET front door (spark abstract-first-home, round 1). The opening
// message is composed here, locally, from what the board model already reads: no model call, no
// figure the model typed. Every number reaches these functions as an argument from the model.
import type { StartStepKey } from '../../../../lib/words';

export const GREET = {
  mainLabel: 'Your assistant',
  toConsole: 'Everything',
  toConsoleTitle: 'Open the full console: every module, every deal',
  // ---- the opening message
  hello: (part: 'morning' | 'afternoon' | 'evening'): string => `Good ${part}.`,
  safe: 'Your money is safe.',
  broken: 'Your safety record found something that broke your rules.',
  safeUnknown: 'I can’t read your safety record yet.',
  needsNone: 'Nothing needs you.',
  needsNoneSub: 'If you do nothing, nothing goes out by itself.',
  needsOne: 'One thing needs you.',
  needsSome: (n: number): string => `${n} things need you.`,
  soonest: 'The soonest first',
  theOne: 'The one thing',
  reading: 'Reading your wallet…',
  away: (since: string): string => `While you were away (${since})`,
  awayMore: (n: number): string => `and ${n} more`,
  // ---- the first need, as a card
  ifNothing: 'If you do nothing',
  review: 'Review in the approval window',
  open: 'Open this deal',
  allNeeds: (n: number): string => `See all ${n}`,
  // ---- suggested replies
  chipAway: 'What happened while I was away?',
  chipSilence: 'What if I do nothing?',
  chipEverything: 'Show me everything',
  chipAllowed: 'What are my agents allowed by the rules?',
  chipSteps: 'Show me all four steps',
  // ---- local answers
  awayAnswerQuiet: 'Nothing happened while you were away. No money moved.',
  everything: 'Here is every deal, newest first. Each module has a door at the top right.',
  steps: 'These are the four steps. Each one happens here, in this conversation.',
  // ---- the conversation
  you: 'You',
  me: 'Assistant',
  askLabel: 'Ask your assistant',
  engine: (name: string): string => `Answers by ${name}`,
  regionHint: 'Ask, or tap a module: answers land here, and Undo puts them back.',
  askPlaceholder: 'Ask anything: “what’s waiting on me?”, “show me Spend”…',
  send: 'Ask',
  stop: 'Stop',
  thinking: 'Thinking…',
  stopped: 'Stopped. Nothing changed on screen.',
  nothingSaid: 'I had nothing to say to that.',
  undo: 'Undo',
  // ---- the composition region
  modules: 'Your modules',
  moduleTitle: (name: string, long: string, needs: number): string => `${name} · ${long}${needs ? ` · ${needs} need you` : ''}`,
  goTo: (name: string): string => `Go to ${name}`,
  pin: 'Pin',
  unpin: 'Unpin',
  close: 'Close',
  suggested: 'Suggested',
  go: 'Go',
  goConsole: (where: string): string => `Open ${where} in the console`,
  // ---- set up together
  welcome: 'Welcome. Let’s set up together.',
  welcomeSub: 'Four short steps, right here. Nothing can pay until you say so, and waiting never sends money.',
  progress: (done: number, total: number): string => `${done} of ${total} done`,
  stepDone: (title: string): string => `Done: ${title}.`,
  stepNext: (n: number, title: string): string => `Step ${n}: ${title}.`,
  allDone: 'All four steps are done. Your wallet is ready; ask me anything.',
  protoTag: 'Prototype: inline signing needs a security review',
  // keys
  keysLead: 'Your PayPal sandbox keys',
  keysBody: 'Test money only. Registering at developer.paypal.com gives you a sandbox business account with its keys.',
  keysSecret: 'The keys are typed into a secure system dialog, never into this window: nothing secret passes through the app’s pages.',
  keysAct: 'Save keys securely',
  // rules
  rulesLead: 'Your agents’ rules',
  rulesBody: 'Say what your agents may do in one sentence. I read it with a fixed word list, no AI, and show the limits.',
  // the honest part of the prototype: the signature itself
  sealNote: 'The signature is checked by the wallet in its secure step. In this prototype that step still opens as its own small window; it closes by itself when you sign.',
  keysNote: 'In this prototype the secure dialog still opens from its own small window; it closes by itself when your keys are saved.',
  waiting: 'Waiting for the secure step… I’ll carry on here when it’s done.',
  opened: 'The secure step is open. Finish it there and come back here.',
  // practice
  practiceLead: 'A practice deal with the house seller',
  practiceBody: 'A demo shop that is always open, with sandbox money. Connect to it here.',
  // engine
  engineLead: 'Your agent app',
  engineBody: 'Your agents run in an app on this computer. Pick one, or keep the practice agent for now.',
  engineLooking: 'Looking for agent apps…',
  engineSet: (name: string): string => `Your agents now run in ${name}.`,
} as const;

/** The step titles in this conversation's voice (the shared START_STEP words stay the source for the rest). */
export const STEP_SAY: Record<StartStepKey, string> = {
  paypal: 'add your PayPal sandbox keys',
  rules: 'sign your agents’ rules',
  practice: 'try a practice deal',
  engine: 'choose your agent app',
};

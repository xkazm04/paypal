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
  regionHint: 'Ask, or tap a module: answers land here, and Undo puts them back.',
  askPlaceholder: 'Ask anything: “what’s waiting on me?”, “show me Spend”…',
  send: 'Ask',
  stop: 'Stop',
  thinking: 'Thinking…',
  stopped: 'Stopped. Nothing changed on screen.',
  nothingSaid: 'I had nothing to say to that.',
  undo: 'Undo',
  // ---- coming back (round 3): after the approval window or an act, a line says what happened
  backFromApproval: 'Back from the approval window.',
  backStillWaiting: (title: string): string => `Back from the approval window - ${title} is still waiting for you.`,
  backMoved: (title: string, state: string): string => `Back from the approval window - ${title}: ${state.charAt(0).toLowerCase()}${state.slice(1)}.`,
  actDone: (title: string): string => `Done: ${title}. Undo is in the card below.`,
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

/** STAGE fork (round 2): the side navigator and the item's stage. */
export const STAGE = {
  side: 'Everything, one row per item',
  all: 'All',
  allTitle: 'Every module',
  scopeTitle: (name: string, long: string, n: number, needs: number): string => `${name} · ${long} · ${n} ${n === 1 ? 'item' : 'items'}${needs ? `, ${needs} need you` : ''}`,
  filter: 'Filter by name',
  filterLabel: 'Filter the rows by name',
  colItem: 'Item',
  colAmount: 'Amount',
  colState: 'State',
  nothing: 'Nothing here yet.',
  noMatch: (q: string): string => `Nothing here matches “${q}”.`,
  fateOnly: (word: string): string => `Only: ${word}`,
  clearFate: 'Show all states',
  count: (shown: number, total: number): string => (shown === total ? `${total} ${total === 1 ? 'item' : 'items'}` : `${shown} of ${total}`),
  keysHint: '↑ ↓ to move, Enter to open, Esc to go back',
  // the stage
  today: 'Today',
  back: 'Back to today',
  stageLabel: (title: string): string => `${title}, item page`,
  facts: 'Where it stands',
  story: 'What happened',
  storyReading: 'Reading what happened…',
  storyNone: 'No signed messages on this deal yet.',
  storyUnread: 'What happened could not be read just now.',
  storyMore: (n: number): string => `and ${n} earlier`,
  openFull: 'Open the full deal page',
  openFullTitle: 'Every view of this deal, in the console',
  openModule: (name: string): string => `Open ${name}`,
  details: 'Details',
  notADeal: 'This row is not a deal: there is no story or decision behind it here.',
  gone: 'This item is no longer listed. Go back to today, or pick another row.',
  askAbout: (title: string): string => `Ask about ${title}`,
  aboutThis: 'You asked about this',
  about: (title: string): string => `About ${title}`,
  // a show op that is not a row
  panelCrumb: (title: string): string => title,
  // round 3: a reply about one deal offers its page instead of opening it
  openLink: (title: string): string => `Open ${title}`,
} as const;

/** Round 3: the simulated first project (sim/host.ts) - the entry, the badge, the crumb. */
export const SIM = {
  try: 'Try a first project',
  tryTitle: 'Walk through a brand-new wallet in a simulation: sandbox only, nothing real moves',
  menuTitle: 'A simulated first project',
  variant: {
    guide: { name: 'Guided', what: 'The assistant walks you through each step, here in the conversation.' },
    tour: { name: 'Tour', what: 'Spotlights on the screen, one region at a time.' },
    story: { name: 'Story', what: 'A short story of a first week, played out on this screen.' },
  },
  badge: 'Simulation · first project',
  leave: 'Leave simulation',
  leaveTitle: 'Back to your wallet as it was',
  crumb: 'First project',
} as const;

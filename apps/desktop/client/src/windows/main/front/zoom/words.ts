// spark abstract-first-home, variant "zoom": the prototype's own words. Shared words (START_STEP,
// BOARD_STANDING, SETUP_WAITING...) are imported where they already say the right thing; only what
// this front door adds lives here. Figures are never written into these strings by the assistant:
// every number is passed in from the board model.

export const ZOOM = {
  mainLabel: 'Your wallet, from the headline down',
  depthLabel: 'How far in you are',
  depthNames: ['Headline', 'Your three questions', 'Modules'] as const,
  depthGo: (name: string): string => `Zoom to ${name}`,
  zoomIn: 'More',
  zoomOut: 'Less',
  keysHint: '+ and − zoom · Esc zooms out · / asks',
  toConsole: 'Console',
  toConsoleTitle: 'Open the full console (every module, every deal)',

  // ---- the status line (depth 0, always on top) ----
  checking: 'Checking your wallet…',
  allSafe: 'All safe.',
  notSafe: 'Your safety record needs a look.',
  safeUnknown: 'Safety record not read yet.',
  needsNone: 'Nothing needs you.',
  needsSome: (n: number): string => (n === 1 ? 'One thing needs you' : `${n} things need you`),
  by: (when: string): string => ` by ${when}`,

  // ---- the first need card ----
  left: 'left',
  why: 'Why',
  ifNothing: 'If you do nothing',
  moreNeeds: (n: number): string => (n === 1 ? '1 more needs you' : `${n} more need you`),
  seeAll: 'See everything',
  calmTitle: 'Nothing is waiting for you',
  calmLine: 'Your agents work inside the rules you signed. Waiting never sends money.',

  // ---- away ----
  awayKicker: 'While you were away',
  awayIn: (m: string): string => `${m} came in`,
  awayOut: (m: string): string => `${m} went out`,
  awayHappened: (n: number): string => (n === 1 ? '1 thing happened' : `${n} things happened`),
  awayMore: (n: number): string => (n === 1 ? '1 more thing happened' : `${n} more things happened`),
  awayOpen: 'What happened',
  awayNeeds: 'and',

  // ---- depth 1 ----
  standingKicker: 'Your three questions',
  openPanel: 'Show',
  closePanel: 'Close',
  awayTitle: 'Since you last looked',

  // ---- depth 2 ----
  modulesKicker: 'Modules',
  tileNeeds: (n: number): string => `${n} need${n === 1 ? 's' : ''} you`,
  tileMoving: (n: number): string => `${n} moving`,
  tileQuiet: 'Quiet',
  tileUnknown: 'Not read yet',
  openModule: (name: string): string => `Open ${name}`,
  openModuleTitle: 'Opens this module in the console',
  wallet: 'Wallet',

  // ---- chat ----
  askPlaceholder: 'Ask about your wallet: “what needs me?”, “show my shop”…',
  askLabel: 'Ask the wallet',
  ask: 'Ask',
  stop: 'Stop',
  thinking: 'Thinking…',
  replyKicker: 'Answer',
  movedTo: (where: string): string => `Shown in ${where}`,
  dismiss: 'Dismiss',
  chips: ['What needs me?', 'Is my money safe?', 'Show my shop'] as const,

  // ---- setup (first run) ----
  setupTitle: 'Let’s get you set up',
  setupSteps: (n: number): string => `${n} short steps`,
  setupStepOf: (i: number, n: number): string => `Step ${i} of ${n}`,
  setupWaitTitle: 'Finish in the secure window',
  setupWaitLine: 'This page moves on by itself. Nothing is sent until you finish there.',
  setupNotDoneTitle: 'Not finished yet',
  setupNotDoneLine: 'The secure window closed before it was done. Nothing changed.',
  setupReopen: 'Reopen the secure window',
  setupSecure: 'Opens a separate secure window: only it can save keys or sign rules.',
  setupDone: 'Done',
  setupAllDone: 'You are set up.',
  setupAllDoneLine: 'Your first safe deal is one click away.',
  setupChecking: 'Checking what is already set up…',
  setupStepsKicker: 'The four steps',
  setupState: { done: 'Done', next: 'Now', todo: 'Later', unknown: 'Not known yet' } as const,
  setupPick: 'Do this step now',
  agentLooking: 'Looking for agent apps…',
} as const;

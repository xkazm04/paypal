// Words for the settings area of the console (rebuild WP3c). Owned by the WP3c builder; every
// user-facing string of the area goes here, never inline. Re-exported from lib/words.ts by one
// `export *` line, so importers keep `import { X } from '../lib/words'`. Rules (docs/ux/UX-GUIDE.md):
// sentence case, Maya's words, no internals (commands, ids, clause numbers, raw states), PayPal is
// the only vendor name, every needs-you line carries "If you do nothing". Prefix exports with the
// area (e.g. `SETTINGS_`): two areas exporting one name is a type error in lib/words.ts. This file
// imports nothing from lib/words.ts (it is re-exported from there; a cycle would read consts
// before they exist). Strings moved from the old Settings checklist (setup/CircuitView.tsx) are
// byte-identical where a test or a user knows them.

/** The frame every owner place shares (console/areas/settings/frame.tsx). */
export const PLACE_FRAME = {
  cards: 'At a glance',
  open: 'Open',
  close: 'Close',
} as const;

export const SETTINGS_KICKER = 'Settings · your wallet, your controls';

/** "If you do nothing" lines of the place. */
export const SETTINGS_IF = {
  firstRun: 'nothing is set up and no money moves',
  locked: 'it stays locked · no money moves',
  paused: 'they stay paused · deadlines still release holds',
  ready: 'your settings stay as they are',
} as const;

export const SETTINGS_OPEN_CHARTER = { act: 'Open your charter', title: 'The five setup lines: keys, rules, practice deal, agent app, unlock' } as const;
export const SETTINGS_TO_CONNECTIONS = { act: 'Choose an agent app', title: 'Connections: the agent app your agents think with' } as const;

/** The four cards. */
export const SETTINGS_CARD = {
  approving: 'Approving',
  agents: 'Your agents',
  appearance: 'Appearance',
  notify: 'Notifications',
} as const;

export const SETTINGS_LOCK = {
  locked: 'Locked',
  unlocked: 'Unlocked',
  lockedNote: 'Windows Hello unlocks it',
  unlockedNote: 'It locks after 15 quiet minutes.',
  locksIn: (min: number): string => `locks in ${min} min`,
  view: 'Approving money',
  sub: 'Everything that pays, signs or saves a key needs you, unlocked, in the approval window.',
  now: 'Now',
  nowLocked: 'locked',
  nowUnlocked: 'unlocked',
  in: 'Locks in',
  inLocked: 'locked now',
  inUnless: 'unless you act in the approval window',
  unread: 'can’t be read',
  reading: 'loading…',
  who: 'Who',
  whoFixed: '15 min · PayPal’s rule',
  hello: 'Windows Hello',
  helloYes: 'available on this computer',
  helloNo: 'not available on this computer',
  locks: 'Locks',
  locksWhat: 'saved keys · rules · connections · approvals · releases · paying on PayPal',
  never: 'Never locks',
  neverWhat: 'looking around · pausing agents · choosing the agent app · the house seller',
  unlock: 'Unlock with Windows Hello',
} as const;

export const SETTINGS_AGENTS = {
  paused: 'Paused',
  ready: 'Ready to work',
  working: (n: number): string => `${n} working`,
  readyNote: 'inside your rules',
  pausedNote: 'nothing new starts',
  view: 'Your agents',
  sub: 'They suggest and bargain, they never pay. Your rules check them first.',
  pause: 'Pause all agents',
  pauseTitle: 'One click, no confirmation: stopping is always free (P)',
  resume: 'Resume agents',
  pausedToast: 'All agents paused. Their work stops; deadlines still release holds.',
  resumedToast: 'Agents can work again. Start each deal yourself.',
  stillRuns: 'Deadlines and their safe defaults still run while they are paused: holds are released, offers lapse.',
  alsoIn: 'You can also pause them from the tray menu and the mini window.',
  roster: 'Who they are',
  rosterEmpty: 'Loading your agents…',
  rosterUnread: 'Your agents can’t be listed here.',
  follows: (rules: string): string => `follows ${rules}`,
  noRules: 'no rules signed for it yet',
  practice: 'practice agent',
  idle: 'idle',
  busy: (n: number): string => `${n} working`,
  now: 'Working now',
  nowEmpty: 'No agent is working right now.',
  nowUnread: 'Agent activity can’t be read.',
  starting: 'starting',
  workingWord: 'working',
  aDeal: 'A deal',
  more: (n: number): string => `and ${n} more`,
  ifPaused: 'they stay paused · no money moves',
  ifWorking: 'they keep working inside your rules · anything outside is refused',
} as const;

export const SETTINGS_LOOK = {
  dark: 'Dark',
  light: 'Light',
  calmOn: 'calm motion on',
  calmOff: 'calm motion off',
  view: 'How the wallet looks',
  sub: 'Only how this window looks. Nothing here changes what your agents may do.',
  theme: 'Theme',
  darkTitle: 'Blue-black, for long days',
  lightTitle: 'Chart paper, for bright rooms',
  calm: 'Calm motion',
  calmWhat: 'Stops the seal turning and the sheets moving; pages only crossfade.',
  calmOs: 'Your computer asks for reduced motion, so the window already stays still.',
  on: 'On',
  off: 'Off',
} as const;

export const SETTINGS_NOTIFY = {
  on: 'On',
  off: 'Off',
  dnd: 'Do not disturb',
  noteOn: 'the mini window and Windows tell you',
  noteOff: 'nothing pops up; the mini window still counts',
  view: 'Notifications',
  sub: 'When a decision needs you, the mini window and Windows can tell you. Waiting never sends money.',
  notifications: 'Windows notifications',
  notificationsWhat: 'A notice when something needs you.',
  dndLabel: 'Do not disturb',
  dndWhat: 'Holds every notice back until you turn it off. The mini window still shows what waits.',
  unread: 'Your notification settings can’t be read right now.',
  failed: 'Notifications',
  ifNothing: 'nothing changes · deadlines still apply',
} as const;

/** The rows under the cards. */
export const SETTINGS_MORE = {
  title: 'Also here',
  charter: 'Your wallet’s charter',
  charterLine: 'See the five setup lines again: keys, rules, practice deal, agent app, unlock',
  rules: 'Agent rules',
  rulesLine: 'What each agent may do, and your wallet limits',
  connections: 'Connections',
  connectionsLine: 'PayPal, the agent app, the house seller and the wallets you deal with',
  safety: 'Your safety record',
  safetyLine: 'Every money step and who decided it',
  firstRun: 'Show the first visit again',
  firstRunLine: 'The browser preview only: open a brand-new wallet, as a new owner sees it',
  quit: 'Quit The Table',
  quitLine: 'See what keeps running and what waits before the app closes',
  open: 'Open',
} as const;

/** "How your money is protected", one disclosure down. */
export const SETTINGS_PROTECT = {
  summary: 'How your money is protected',
  chain: [
    { title: 'Your agents', text: 'suggest and bargain, never pay' },
    { title: 'Your rules', text: 'refuse anything outside your limits' },
    { title: 'You', text: 'approve what pays' },
    { title: 'PayPal', text: 'moves money only after that' },
  ],
  onlyYou: 'Only you · in the approval window',
  onlyYouLocked: 'Only you · in the approval window · locked',
  youHere: 'You · here in The Table',
  fixed: 'Fixed',
  movesOn: 'Money moves only on',
  agentsNever: 'agents: never',
  agentsSuggest: 'agents: only suggest',
  agentsInside: 'agents: inside a table',
  rowsOnlyYou: [
    ['PayPal key', 'typed into a Windows dialog'],
    ['Market prices key', 'typed into a Windows dialog'],
    ['Agent rules', 'sign, change, cancel'],
    ['Connection words', 'confirms who you deal with'],
    ['Unlock after 15 quiet min', 'Windows Hello'],
  ],
  rowsYou: [
    ['Agent app', 'Connections'],
    ['Pause or resume agents', 'here, the tray or the mini window'],
    ['Open a table with the house seller', 'Connections'],
  ],
  rowsFixed: [
    ['Lock after', '15 quiet min · PayPal’s rule'],
    ['Sandbox or live', 'set by the app version'],
    ['House seller identity', 'built into the app'],
  ],
  moves: [
    'your decision in the approval window',
    'a rule you signed',
    'a safe default: release a hold or let an offer lapse, never a payment',
  ],
  movesNever: 'an agent: it has no tool that moves money',
} as const;

/** The hand-offs the "Your call" line offers (the old checklist's buttons). */
export const SETTINGS_ACT = {
  key: 'Add PayPal key',
  keyTitle: 'Opens the approval window, where you type your PayPal key into a Windows dialog',
  rules: 'Sign rules',
  rulesTitle: 'Opens the approval window, where you sign your agents’ rules',
} as const;

/** Settings at a glance (the Latest strip's read-only facts, rebuild WP4a): what the other places hold. */
export const SETTINGS_FACTS = {
  mode: 'Money mode',
  paypal: 'PayPal key',
  engine: 'Agent app',
  house: 'House seller',
  rules: 'Rule sets signed',
  working: 'Agents at work now',
  lockIn: 'Approving locks',
} as const;

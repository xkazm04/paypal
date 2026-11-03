// Words of the conversational board (windows/main/switchboard). Owned by WP1. Prefix: BOARD_.
// Rules (docs/ux/UX-GUIDE.md): sentence case, the owner's words, no internals (no command names, ids
// or clause numbers), PayPal is the only vendor name. The engine chip is the one place an engine id
// may be shown, because the product already names engines to the owner.
import type { Module } from '@bindings/Module';

export const BOARD_MAIN_LABEL = 'The board: one answer, three questions and every deal counted';
export const BOARD_TO_CONSOLE = 'Console';
export const BOARD_TO_CONSOLE_TITLE = 'Back to the console, the detailed view';
export const BOARD_TO_BOARD = 'Board';
export const BOARD_TO_BOARD_TITLE = 'Every module and every deal on one page';

/** The four columns: what is happening to the money. */
export const BOARD_FATE = {
  needs: { word: 'Needs you', short: 'Needs you', means: 'Waiting for your decision. If you do nothing, nothing moves.' },
  moving: { word: 'Moving by itself', short: 'Moving', means: 'Inside your rules and moving without you.' },
  stopped: { word: 'Stopped', short: 'Stopped', means: 'Refused, blocked, withdrawn or lapsed. No money is going out.' },
  paid: { word: 'Paid', short: 'Paid', means: 'PayPal confirmed the money moved.' },
} as const;

export const BOARD_MODULE_ROLE: Record<Module, string> = {
  tables: 'haggling', spend: 'agent purchases', counter: 'your shop', book: 'all payments', shield: 'scam checks', rescue: 'failed renewals',
};

export const BOARD_EMPTY_CELL = 'Nothing here';
export const BOARD_EMPTY_BOARD = 'Nothing on the board yet. Deals appear here as soon as you have one.';
export const BOARD_NO_DEADLINE = 'no deadline';
export const BOARD_NO_AMOUNT = 'no amount yet';
export const BOARD_IF_NOTHING = 'If you do nothing';
export const BOARD_MORE = (n: number): string => `+${n} more`;
export const BOARD_COUNT_SOON = (soonest: string): string => `soonest ${soonest}`;
export const BOARD_NOT_AVAILABLE = 'not available yet';

export const BOARD_GRID_LABEL = 'Six areas by what is happening to each deal';
export const BOARD_CORNER = 'Area';
/** The board column's total column head. */
export const BOARD_ALL = 'All';

export const BOARD_FILTER_ROW = (module: string): string => `Show only ${module}`;
export const BOARD_FILTER_COL = (fate: string): string => `Show only: ${fate}`;
export const BOARD_FILTER_ON = (what: string): string => `Showing only ${what}`;
export const BOARD_FILTER_CLEAR = 'Show everything';
export const BOARD_FOCUS_ON = (what: string): string => `Lit up: ${what}`;

// ---- the board column (BoardColumn.tsx): counts, what is lit, the sum and the lit keys ----------
export const BOARD_COLUMN = {
  title: 'The board',
  /** A cell read aloud: "Spend, Needs you: 1 deal, lit". */
  cell: (module: string, fate: string, n: number, lit: boolean): string => `${module}, ${fate}: ${n ? `${n} ${n === 1 ? 'deal' : 'deals'}` : BOARD_EMPTY_CELL}${lit ? ', lit' : ''}`,
  row: (module: string, role: string, n: number): string => `${module}, ${role}: ${n} ${n === 1 ? 'deal' : 'deals'}. ${BOARD_FILTER_ROW(module)}`,
  col: (fate: string, n: number): string => `${fate}: ${n} ${n === 1 ? 'deal' : 'deals'}. ${BOARD_FILTER_COL(fate)}`,
  /** "= 6 deals lit". */
  lit: (n: number): string => (n === 1 ? 'deal lit' : 'deals lit'),
  sumLabel: (n: number): string => `The lit cells add up to ${n} ${n === 1 ? 'deal' : 'deals'}`,
  noneLit: 'Nothing is lit. Hover a figure in the answer, or press a cell.',
  emptyLit: 'No deals where it is lit.',
  keysLabel: 'The lit deals, soonest first',
  /** A lit key read aloud: "D-0193, Refurbished monitor, $329.00, Needs you". */
  key: (label: string, title: string, amount: string | null, state: string): string => `${label}, ${title}, ${amount ?? BOARD_NO_AMOUNT}, ${state}`,
  moreTitle: 'Show every lit deal as a list',
} as const;

// ---- the says area (Says.tsx): the asked line, the one sentence, the wait, what changed --------
export const BOARD_ENGINE_SCRIPTED = 'Scripted preview, not a live model';
export const BOARD_ENGINE_LIVE = 'claude-code';
export const BOARD_SAYS = 'The board says';
export const BOARD_CANCELLED = 'Stopped. Nothing changed.';
export const BOARD_FALLBACK_NOTICE = 'The live engine did not answer, so this answer is from the scripted preview.';
export const BOARD_DROPPED = (n: number): string => `${n} ${n === 1 ? 'part' : 'parts'} could not be shown`;
export const BOARD_EMPTY_REPLY = 'The board had nothing to show for that. Try one of the suggestions.';
export const BOARD_SAYS_AREA = {
  label: 'The answer in one sentence',
  asked: 'You asked:',
  /** The opening line is composed from the three standing answers; it is never a reply. */
  opening: 'From your board, not an answer',
  openingTitle: 'Composed from your three questions below. Nobody was asked; ask anything to get an answer.',
  /** Said when a reply had no sentence but changed the screen. */
  shown: 'The answer is on the table below.',
  fallback: 'From the scripted preview',
  repaired: 'Tidied before it was shown',
  figureNote: 'What this figure is',
  holdTitle: 'Press to keep this lit; press again or Esc to let go',
} as const;
/** The wait: what is really happening, in plain words (a reply does not stream; it takes 2 to 60 s). */
export const BOARD_WAIT = {
  live: (engine: string): string => `Asking the live engine, ${engine}.`,
  scripted: 'The scripted preview is answering. No live model is running.',
  fallback: 'The live engine did not answer. The scripted preview is answering instead.',
  seconds: (n: number): string => `${n} s`,
  secondsLabel: 'Time since you asked',
  moveWins: 'If you move something on the board now, your move wins.',
} as const;
/** The top bar's way to the earlier answers of this sitting, read only. */
export const BOARD_EARLIER = {
  button: 'Earlier',
  title: 'Earlier in this sitting',
  none: 'Nothing has been asked yet.',
  now: 'Now',
  answering: 'Answering',
  stopped: 'Stopped',
  undone: 'Undone',
  held: 'Held: you moved the board',
  readOnly: 'Read only. The board shows the latest answer.',
} as const;
/** The keys help sheet. One row per binding of the board's one keymap (switchboard/keys.ts). */
export const BOARD_KEYS = {
  button: 'Keyboard shortcuts',
  title: 'Keyboard shortcuts',
  slash: 'Ask in your own words',
  escape: 'Let go of a figure, clear the answers, their pins, the filter and the light',
  arrows: 'Move between the cells and heads of the board',
  enter: 'On a cell: light it and show only it',
  tab: 'Reach every figure, answer action and lit deal',
  help: 'This list',
  arrowsShown: '← ↑ → ↓',
} as const;

// ---- the ask bar (AskBar.tsx) ----------------------------------------------------------------------
export const BOARD_ASK_LABEL = 'Ask about your wallet';
export const BOARD_ASK_PLACEHOLDER = 'Ask: what needs me, room left, failed renewals';
export const BOARD_ASK = 'Ask';
export const BOARD_STOP = 'Stop';
export const BOARD_BUSY = 'Looking through your board';
export const BOARD_CHIPS: readonly string[] = ['What needs me?', 'How much room is left today?', 'Show failed renewals', 'What was paid this week?', 'Which rules are in force?', 'Is my record intact?'];
export const BOARD_CHIPS_LABEL = 'Suggested questions';

// ---- the slots (Slots.tsx): three fixed places for answers; an empty one offers a real question ----
/** Each empty-slot offer: a question from BOARD_CHIPS, the panel it puts on the table and what it shows. */
export const BOARD_GHOSTS: readonly { kind: 'money' | 'needs' | 'rescue' | 'rules' | 'safety' | 'book'; q: string; about: string }[] = [
  { kind: 'money', q: 'How much room is left today?', about: 'Room left, what is held, what is paid' },
  { kind: 'needs', q: 'What needs me?', about: 'Everything waiting on you, soonest first' },
  { kind: 'rescue', q: 'Show failed renewals', about: 'Each failed renewal and what happens next' },
  { kind: 'rules', q: 'Which rules are in force?', about: 'The limits you signed, in plain words' },
  { kind: 'safety', q: 'Is my record intact?', about: 'What was stopped, and whether your record is intact' },
  { kind: 'book', q: 'What was paid this week?', about: 'Your payments, newest first' },
];
export const BOARD_SLOT = {
  ask: (q: string): string => `Ask: “${q}”`,
  free: 'Another answer fits here',
  pinned: 'Pinned',
  unpin: 'Unpin',
  focusTitle: 'Bring this answer into focus',
} as const;
export const BOARD_ANSWER_CLOSE = 'Close the answer';
export const BOARD_PANEL_TITLE = {
  needs: 'What needs you',
  decision: 'A decision for you',
  deal: 'This deal',
  money: 'Your money today',
  rules: 'Rules in force',
  rescue: 'Failed renewals',
  safety: 'Your safety record',
  book: 'Your payments',
  week: 'This week',
  setup: 'Getting ready',
} as const;
export const BOARD_PANEL_KIND = 'Answer';
/** The region of answers (windows/main/switchboard/region.ts): up to three, pins, the one-step undo. */
export const BOARD_REGION = {
  label: 'Answers on screen',
  pin: 'Pin',
  pinTitle: 'Keep this answer here. New answers will not take its place.',
  unpinTitle: 'Unpin it. New answers may take its place again.',
  pinFull: (n: number): string => `You can pin ${n} answers. Unpin one first.`,
  undo: 'Undo last change',
  undoTitle: 'Put the answers, the filter and the light back as they were before the board’s last reply. Your own moves stay.',
  undoNone: 'Nothing the board changed is left to undo.',
} as const;
/** The one line under a reply that says what it changed on screen. Never shown when nothing changed. */
export const BOARD_CHANGED = {
  label: 'What changed on screen',
  added: (names: string): string => `Added: ${names}.`,
  kept: (names: string): string => `Kept: ${names}.`,
  removed: (names: string): string => `Removed: ${names}.`,
  pinned: (name: string): string => `${name} (pinned)`,
  list: (names: readonly string[]): string => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`),
  filtered: (what: string): string => `${BOARD_FILTER_ON(what)}.`,
  unfiltered: 'Showing the whole board again.',
  lit: (what: string): string => `${BOARD_FOCUS_ON(what)}.`,
  unlit: 'The light is off.',
  undone: 'Undone: the screen is back as it was.',
  /** The reply arrived after she moved the board: her move wins, its layout is only offered. */
  held: 'Nothing changed on screen, because you moved the board while it answered.',
  applyHeld: 'Show what it suggested',
} as const;
export const BOARD_CRUMB_LABEL = 'Where you are';
export const BOARD_CRUMB_BOARD = 'Board';

export const BOARD_DECISION = {
  why: 'Why it needs you',
  amount: 'Amount',
  deadline: 'Deadline',
  with: 'State',
  review: 'Review in approval window',
  reviewTitle: 'Opens the approval window on this deal. Nothing is approved on this page.',
  opening: 'Opening…',
  unlock: 'Unlock first',
  notWaiting: 'This deal is not waiting for you.',
  gone: 'That deal is no longer on the board.',
  handoff: 'You decide in the approval window. Nothing is approved on this page.',
} as const;

export const BOARD_DEAL = {
  state: 'Where it stands',
  amount: 'Amount',
  module: 'Module',
  fate: 'Column',
  deadline: 'Time left',
  onSilence: BOARD_IF_NOTHING,
  none: 'Nothing is waiting on this deal.',
  open: 'Open in the console',
  openTitle: 'Switches to the console on this deal',
} as const;

export const BOARD_NEEDS = {
  none: 'Nothing is waiting for you. Your agents are working inside your rules.',
  lead: (n: number): string => `${n} ${n === 1 ? 'thing is' : 'things are'} waiting for you`,
  soonest: 'Soonest first',
} as const;

export const BOARD_MONEY = {
  lead: 'Today, against the limits you signed',
  none: 'Your money numbers are not available yet.',
  out: 'Agreed to pay today',
  held: 'Held or agreed, not paid yet',
  dealsDay: 'Deals agreed today',
  paidOut: 'Paid out, confirmed by PayPal',
  paidIn: 'Paid to you, in your records',
  roomLeft: 'Room left today',
} as const;

export const BOARD_RULES = {
  none: 'No rules are signed yet, so your agents cannot act.',
  count: (n: number): string => `${n} ${n === 1 ? 'set of rules is' : 'sets of rules are'} in force`,
  unknown: 'Your rules could not be read right now.',
  line: 'Your agents act only inside them. Anything outside them asks you first.',
  changeIn: 'Rules are changed in the approval window.',
} as const;

export const BOARD_RESCUE = {
  none: 'No failed renewals right now.',
  unknown: 'Failed renewals could not be read right now.',
  recovered: 'Recovered so far',
  watching: 'Subscriptions being watched',
  cases: (n: number): string => `${n} ${n === 1 ? 'case' : 'cases'}`,
} as const;

export const BOARD_SAFETY = {
  unknown: 'Your safety record could not be checked right now.',
  intact: 'Your record is intact',
  broken: 'Your record failed a check',
  entries: 'Entries checked',
  deals: 'Deals checked',
  refused: 'Requests refused',
  clean: 'Nothing broke the rules.',
  found: (n: number): string => `${n} ${n === 1 ? 'finding' : 'findings'} to look at`,
} as const;

export const BOARD_BOOK = {
  none: 'No deals in this part of your payments.',
  showing: (shown: number, all: number): string => (shown === all ? `${all} ${all === 1 ? 'deal' : 'deals'}` : `Showing ${shown} of ${all}`),
  more: 'Show more',
  scopeAll: 'every module and column',
} as const;

export const BOARD_WEEK = {
  none: 'No deals touched this week.',
  lead: (n: number): string => `${n} ${n === 1 ? 'deal' : 'deals'} touched this week`,
  paid: 'Paid',
  stopped: 'Stopped',
  waiting: 'Needs you',
} as const;

export const BOARD_SETUP = {
  lead: 'Four steps to your first safe deal',
  empty: 'Nothing on the board yet. It fills in once you have your first deal.',
  next: (title: string): string => `Next: ${title}`,
  allDone: 'Everything is set up.',
  promise: 'If you do nothing, no money moves.',
  elsewhereTitle: 'Opens the console, where this step happens',
} as const;

// ---- proposals from the assistant (the host resolves them; the words come from the resolved action) ----
export const BOARD_PROPOSAL = {
  label: 'Suggested next step',
  because: 'The board says',
  openDecision: (label: string): string => `Open the approval window on ${label}`,
  openSetup: { credentials: 'Open the approval window to add your PayPal keys', mandate: 'Open the approval window to sign your rules', unlock: 'Open the approval window to unlock' },
  openConsole: 'Open this in the console',
  confirm: 'Opens the approval window. Nothing is approved on this page.',
  confirmConsole: 'Switches to the console. Nothing is approved on this page.',
  disarmed: 'Not available',
  whyDisarmed: {
    gone: 'that deal is not on the board',
    notWaiting: 'that deal is not waiting for you',
    badTarget: 'that step is not one the board can open',
    badRoute: 'that page is not one the board can open',
  },
} as const;

// ---- safe acts: the consent box the host draws for a proposal that changes the wallet (reversibly) ----
// Every word here is fixed or filled from the wallet's own data, never from the assistant's reply.
// docs/design/conversational-home-safe-acts.md
export const BOARD_ACT = {
  needsOk: 'Needs your OK',
  boxLabel: 'Check what this does before you press it',
  undo: 'Undo',
  undoing: 'Undoing…',
  failed: 'That did not happen',
  undoFailed: 'The undo did not happen',
  pause: {
    title: 'Pause all your agents',
    does: (working: number | null): string =>
      working === null
        ? 'How many agents are working is not available yet. Nothing new starts while they are paused.'
        : working === 0
          ? 'No agent is working right now. Nothing new starts while they are paused.'
          : `${working} ${working === 1 ? 'agent working now stops' : 'agents working now stop'}, and nothing new starts.`,
    doesNot: 'Nothing is paid, approved or cancelled. Deadlines keep running, and anything left waiting lapses with no money moving.',
    reverse: 'You can undo this here, or press Resume in Settings, Your agents.',
    press: 'Pause all agents',
    pressing: 'Pausing…',
    done: 'All agents paused. Their work stopped; nothing new starts.',
    undoTitle: 'Resume your agents. Nothing restarts by itself.',
    undone: 'Agents resumed. Nothing restarts by itself; restart a table in Settings if you want one back.',
  },
  /** One agent, named by the fixed words below. */
  pauseOne: {
    name: { negotiator: 'negotiator', shopper: 'shopper', assistant: 'assistant agent' },
    role: { negotiator: 'It haggles at your tables.', shopper: 'It makes agent purchases.', assistant: 'It reads the book and drafts shop and rescue work.' },
    title: (name: string): string => `Pause your ${name}`,
    does: (role: string): string => `${role} Its work stops now, and nothing new starts for it. Your other agents keep working.`,
    doesNot: 'Nothing is paid, approved or cancelled. Deadlines keep running, and anything left waiting lapses with no money moving.',
    reverse: 'You can undo this here.',
    press: (name: string): string => `Pause the ${name}`,
    pressing: 'Pausing…',
    done: (name: string): string => `Your ${name} is paused. Its work stopped; nothing new starts for it.`,
    undoTitle: (name: string): string => `Resume your ${name}. Nothing restarts by itself.`,
    undone: (name: string): string => `Your ${name} is back. Nothing restarts by itself.`,
  },
  /** Let one ask lapse. `label` is the deal's own label (D-0190), never counterparty text. */
  lapse: {
    title: (label: string): string => `Let ${label} lapse`,
    does: 'It leaves your list now and lapses at its deadline, exactly as if you did nothing.',
    doesNot: 'No money moves. Nothing is agreed, and nothing is cancelled early.',
    reverse: 'You can undo this here until its deadline.',
    press: 'Let it lapse',
    pressing: 'Setting it aside…',
    done: (label: string): string => `${label} will lapse at its deadline. No money moves.`,
    undoTitle: 'Put it back on your list before its deadline.',
    undone: (label: string): string => `${label} is back on your list.`,
  },
  whyDisarmed: {
    alreadyPaused: 'your agents are already paused',
    pausedUnknown: 'whether your agents are paused is not available yet',
    agentPaused: 'that agent is already paused',
    allPaused: 'all your agents are already paused',
    gone: 'that deal is not on the board',
    notLapsable: 'that deal cannot be left to lapse from here',
    changed: 'things changed since this was shown; check it again',
  },
} as const;

/** Said under an answer the board had to tidy before showing it (text cleaned, gaps filled). */
export const BOARD_REPAIRED = 'This answer was tidied before it was shown. The buttons come from the board, not from its words.';

export const BOARD_HANDOFF_FAILED ='The approval window did not open. Nothing was changed.';

// ---- the three standing questions (windows/main/switchboard/standing.ts; docs/ux/UX-GUIDE.md) ----
/** Up to three labels, then "and n more". */
const someLabels = (labels: readonly string[]): string =>
  labels.length > 3 ? `${labels.slice(0, 3).join(', ')} and ${labels.length - 3} more` : BOARD_CHANGED.list(labels);
/** "holds are released, asks lapse and ..." with its first letter raised. */
const happensLine = (parts: readonly string[]): string => {
  const s = BOARD_CHANGED.list(parts);
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** The three questions she answers on any screen in two seconds, and the board's short answers. */
export const BOARD_STANDING = {
  label: 'Your three questions',
  question: { safe: 'Is my money safe right now?', needs: 'Does anything need me?', nothing: 'What happens if I do nothing?' },
  /** What pressing a standing answer asks the board. */
  asks: { safe: 'Is my record intact?', needs: 'What needs me?', nothing: 'What if I do nothing?' },
  ask: (q: string): string => `Ask the board: “${q}”`,
  notYet: 'Not available yet',
  notSetUp: 'Not set up yet',
  setUpFirst: 'Nothing can be paid until setup is done',
  nextStep: BOARD_SETUP.next,
  // Is my money safe right now? (the safety record)
  safe: 'Safe',
  safeDetail: (entries: number | null): string => (entries === null ? 'Nothing broke your rules' : `${entries} ${entries === 1 ? 'entry' : 'entries'} checked · nothing broke your rules`),
  broken: BOARD_SAFETY.broken,
  brokenDetail: 'Look at your safety record now',
  // Does anything need me? (the Needs you column)
  needsNone: 'Nothing needs you',
  needsSome: (n: number): string => `${n} ${n === 1 ? 'needs' : 'need'} you`,
  area: (name: string, n: number): string => `${name} ${n}`,
  // The soonest deadline first: the strip is one line, and at 500 deals the areas run past its end.
  needsWhere: (areas: readonly string[], soonest: string | null): string => [...(soonest ? [BOARD_COUNT_SOON(soonest)] : []), ...areas].join(' · '),
  // What happens if I do nothing? (the needs-you keys' If you do nothing lines)
  stays: 'Nothing moves by itself',
  happens: {
    release: 'holds are released',
    lapse: 'asks lapse',
    retry: 'failed renewals retry at PayPal',
    check: 'payments being checked follow what PayPal shows',
    stays: 'the rest waits for you',
  },
  staysOnly: 'Everything waits for you as it is',
  /** The detail names at most two happenings; the rest are counted ("... and 3 more"). */
  happensMore: (n: number): string => `${n} more`,
  happensLine,
  comesIn: (n: number): string => (n === 1 ? 'A payment can come in by itself' : `${n} payments can come in by themselves`),
  comesInDetail: (labels: readonly string[]): string => `${someLabels(labels)} · nothing goes out by itself`,
  goesOutNothing: 'Nothing goes out by itself',
  unknownDetail: (labels: readonly string[]): string => `What happens to ${someLabels(labels)} is ${BOARD_NOT_AVAILABLE}`,
} as const;

// ---- the figures in the board's sentence (windows/main/switchboard/figures.ts) ----------------------
type FigureFate = keyof typeof BOARD_FATE;
const dealsWord = (n: number): string => `${n} ${n === 1 ? 'deal' : 'deals'}`;
/** "need you", "moving by itself", "stopped", "paid", agreeing with n. */
const fatePhrase = (n: number, fate: FigureFate): string =>
  fate === 'needs' ? (n === 1 ? 'needs you' : 'need you') : fate === 'moving' ? (n === 1 ? 'moving by itself' : 'moving by themselves') : fate;

/** What a linked figure is, in plain words: the line a hover or a focus on it shows. */
export const BOARD_FIGURE = {
  label: 'What this figure is',
  fatePhrase,
  /** "D-0193: Used road bike, $329.00, needs you". */
  deal: (label: string, title: string, amount: string | null, state: string): string => `${label}: ${title}, ${amount ?? BOARD_NO_AMOUNT}, ${state.toLowerCase()}`,
  /** "D-0193 closes in 3 h 58 m. If you do nothing: the offer lapses ...". */
  dealLeft: (label: string, left: string, onSilence: string | null): string => `${label} closes in ${left}. ${BOARD_IF_NOTHING}: ${onSilence ?? BOARD_NOT_AVAILABLE}`,
  fact: {
    room: 'your room left today',
    cap: 'your daily limit',
    held: 'held at PayPal, or agreed and waiting',
    heldAt: 'held at PayPal',
    heldBefore: 'agreed and waiting to be paid',
    heldCap: 'the most you hold at once',
    paidOut: 'paid out today, confirmed by PayPal',
    paidIn: 'paid to you, in your records',
    outToday: 'agreed to pay today',
  },
  /** "$860.00 is your room left today", "$329.00 appears on 2 deals: D-0193 and D-0199". */
  money: (text: string, facts: readonly string[], deals: readonly { label: string; title: string }[]): string => {
    const parts: string[] = [];
    if (facts.length) parts.push(`${text} is ${BOARD_CHANGED.list(facts)}`);
    if (deals.length === 1) parts.push(`${facts.length ? 'and' : `${text} is`} ${deals[0]!.label}, ${deals[0]!.title}`);
    else if (deals.length > 1) parts.push(`${facts.length ? 'it also' : text} appears on ${dealsWord(deals.length)}${deals.length <= 4 ? `: ${BOARD_CHANGED.list(deals.map((d) => d.label))}` : ''}`);
    return parts.join('; ');
  },
  /** "6 deals need you: Tables 2, Spend 1, Counter 1, Shield 1, Rescue 1". */
  count: (n: number, fate: FigureFate, areas: readonly string[]): string => `${dealsWord(n)} ${fatePhrase(n, fate)}${areas.length ? `: ${areas.join(', ')}` : ''}`,
  /** "Spend: 1 deal needs you". */
  cellCount: (area: string, n: number, fate: FigureFate): string => `${area}: ${dealsWord(n)} ${fatePhrase(n, fate)}`,
  areaCount: (area: string, n: number): string => `${area} ${n}`,
  /** "23 deals on the board: 6 need you, 7 moving, 6 stopped, 4 paid". */
  whole: (n: number, parts: readonly string[]): string => `${dealsWord(n)} on the board: ${parts.join(', ')}`,
  /** "6 need you", "1 needs you", "7 moving", "6 stopped", "4 paid". */
  fateCount: (n: number, fate: FigureFate): string => `${n} ${fate === 'needs' ? (n === 1 ? 'needs you' : 'need you') : BOARD_FATE[fate].short.toLowerCase()}`,
  /** "Spend: 6 deals on the board". */
  rowTotal: (area: string, n: number): string => `${area}: ${dealsWord(n)} on the board`,
  /** "Spend, agent purchases: 6 deals · 1 needs you · 0 moving · 3 stopped · 2 paid". */
  area: (name: string, role: string, total: number, parts: readonly string[]): string =>
    total ? `${name}, ${role}: ${dealsWord(total)} · ${parts.join(' · ')}` : `${name}, ${role}: no deals here`,
  today: (n: number, cap: number | null): string => (cap === null ? `Deals your agents agreed to today: ${n}` : `Deals your agents agreed to today: ${n}, of ${cap} allowed a day`),
  rules: BOARD_RULES.count,
} as const;

// Words of the conversational board (windows/main/switchboard). Owned by WP1. Prefix: BOARD_.
// Rules (docs/ux/UX-GUIDE.md): sentence case, the owner's words, no internals (no command names, ids
// or clause numbers), PayPal is the only vendor name. The engine chip is the one place an engine id
// may be shown, because the product already names engines to the owner.
import type { Module } from '@bindings/Module';

export const BOARD_TITLE = 'Board';
export const BOARD_SUB = 'every deal at a glance';
export const BOARD_MAIN_LABEL = 'Your whole wallet, one deal per key';
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

export const BOARD_NOTHING_YET = 'nothing yet';
export const BOARD_EMPTY_CELL = 'Nothing here';
export const BOARD_EMPTY_BOARD = 'Nothing on the board yet. Deals appear here as soon as you have one.';
export const BOARD_NO_DEADLINE = 'no deadline';
export const BOARD_NO_AMOUNT = 'no amount yet';
export const BOARD_IF_NOTHING = 'If you do nothing';
export const BOARD_MORE = (n: number): string => `+${n} more`;
export const BOARD_MORE_TITLE = (n: number, module: string, fate: string): string => `Show the ${n} other ${n === 1 ? 'deal' : 'deals'} in ${module}, ${fate}`;
export const BOARD_COUNT_SOON = (soonest: string): string => `soonest ${soonest}`;
export const BOARD_NOT_AVAILABLE = 'not available yet';

export const BOARD_KEY_LABEL = (module: string, fate: string, label: string, amount: string | null, left: string | null): string =>
  `${module}, ${fate}: ${label}${amount ? `, ${amount}` : ''}${left ? `, ${left} left` : ''}`;

export const BOARD_GRID_LABEL = 'Six modules by what is happening to each deal';
export const BOARD_CORNER = 'Module';
export const BOARD_WEEK_HEAD = 'This week';
export const BOARD_WEEK_LABEL = (module: string, total: number): string => `${module}: ${total} ${total === 1 ? 'deal' : 'deals'} touched this week`;
export const BOARD_WEEK_TODAY = 'today';

export const BOARD_FILTER_ROW = (module: string): string => `Show only ${module}`;
export const BOARD_FILTER_COL = (fate: string): string => `Show only: ${fate}`;
export const BOARD_FILTER_ON = (what: string): string => `Showing only ${what}`;
export const BOARD_FILTER_CLEAR = 'Show everything';
export const BOARD_FOCUS_ON = (what: string): string => `Lit up: ${what}`;

// ---- the instrument strip ----------------------------------------------------------------------
export const BOARD_STRIP_LABEL = 'Your money today';
export const BOARD_INST = {
  room: 'Room left today',
  roomOf: (cap: string): string => `of ${cap} a day`,
  roomNone: 'No daily limit signed',
  deals: 'Deals today',
  dealsOf: (n: number): string => `of ${n} a day`,
  held: 'Held',
  heldAt: (m: string): string => `${m} at PayPal`,
  heldBefore: (m: string): string => `${m} before PayPal`,
  confirmed: 'Confirmed by PayPal',
  confirmedOut: (m: string): string => `${m} out today`,
  confirmedIn: (m: string): string => `${m} in, in your records`,
  records: 'Your records',
  recordsIntact: 'Intact',
  recordsBroken: 'Broken',
  recordsCount: (n: number): string => `${n} ${n === 1 ? 'entry' : 'entries'} checked`,
  recordsBrokenLine: 'Look at your safety record now',
} as const;

// ---- the chat rail -----------------------------------------------------------------------------
export const BOARD_RAIL_LABEL = 'Ask the board';
export const BOARD_RAIL_TITLE = 'Ask the board';
export const BOARD_ENGINE_SCRIPTED = 'Scripted preview, not a live model';
export const BOARD_ENGINE_LIVE = 'claude-code';
export const BOARD_ASK_LABEL = 'Ask about your wallet';
export const BOARD_ASK_PLACEHOLDER = 'Ask: what needs me, room left, failed renewals';
export const BOARD_ASK = 'Ask';
export const BOARD_STOP = 'Stop';
export const BOARD_BUSY = 'Looking through your board';
export const BOARD_CANCELLED = 'Stopped. Nothing changed.';
export const BOARD_HINT = 'Enter asks · / focuses here · Esc back to the board · arrows move between keys';
export const BOARD_CHIPS: readonly string[] = ['What needs me?', 'How much room is left today?', 'Show failed renewals', 'What was paid this week?', 'Which rules are in force?', 'Is my record intact?'];
export const BOARD_CHIPS_LABEL = 'Suggested questions';
export const BOARD_YOU = 'You';
export const BOARD_THREAD_LABEL = 'Conversation';
export const BOARD_THREAD_EMPTY = 'Ask a question and the board answers here, and lights up the part it means.';
export const BOARD_FALLBACK_NOTICE = 'The live engine did not answer, so this answer is from the scripted preview.';
export const BOARD_DROPPED = (n: number): string => `${n} ${n === 1 ? 'part' : 'parts'} could not be shown`;
export const BOARD_EMPTY_REPLY = 'The board had nothing to show for that. Try one of the suggestions.';
export const BOARD_SAYS = 'The board says';

// ---- answer area ---------------------------------------------------------------------------------
export const BOARD_ANSWER_LABEL = 'Answer';
export const BOARD_ANSWER_EMPTY = 'Click a key on the board, or ask a question.';
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

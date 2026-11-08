// Words of the assistant (lib/assistant: the scripted replies and the chat rail's labels). Owned by
// WP2. Rules (docs/ux/UX-GUIDE.md): sentence case, Maya's words, no internals (ids, commands), PayPal
// is the only vendor name, every needs-you line carries "If you do nothing". Prefix: ASSISTANT_.
// Imports nothing (the scripted engine formats numbers; these are only sentences). Replies built from
// these must survive lib/assistant/validate.ts unchanged: no links, markup, brackets, braces, and no
// decimal number directly followed by a slash.

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
/** Drop a trailing full stop so a clause can sit inside a sentence. */
const clause = (s: string): string => s.trim().replace(/[.!\s]+$/, '');

export const ASSISTANT_NOT_YET = 'not available yet';

export const ASSISTANT_ENGINE_SCRIPTED = 'Scripted preview';
export const ASSISTANT_ENGINE_CLAUDE_CODE = 'claude-code';
export const ASSISTANT_ENGINE_FALLBACK = (reason: string): string => `The live engine could not answer (${reason}), so this answer is from the scripted preview.`;

export const ASSISTANT_SUGGESTIONS = [
  'What needs me?',
  'What if I do nothing?',
  'How much room is left today?',
  'What did Shield stop?',
  'Failed renewals',
  'What happened this week?',
  'My rules',
  'Show the book',
] as const;

export const ASSISTANT_MODULE_NAME = {
  tables: 'Tables',
  spend: 'Spend',
  counter: 'Counter',
  book: 'Book',
  shield: 'Shield',
  rescue: 'Rescue',
} as const;

export const ASSISTANT_FATE_WORD = {
  needs: 'need you',
  moving: 'moving by themselves',
  stopped: 'stopped',
  paid: 'paid',
} as const;

export const ASSISTANT_SETUP_STEP = {
  paypal: 'Connect PayPal',
  rules: 'Sign your rules',
  practice: 'Try a practice deal',
  engine: 'Pick an engine',
} as const;

export const ASSISTANT_NO_MONEY_MOVES = 'If you do nothing, no money moves by itself.';

/** "2 h 10 m" style, from minutes; negative means overdue. */
export const ASSISTANT_DUR = (min: number): string => {
  if (min < 0) return 'overdue';
  if (min < 60) return `${min} min left`;
  if (min < 1440) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h} h${m ? ` ${String(m).padStart(2, '0')} m` : ''} left`;
  }
  return `${plural(Math.floor(min / 1440), 'day', 'days')} left`;
};

export const ASSISTANT_SAY = {
  help: 'I can show what needs you, what happens if you do nothing, your money today, your rules, failed renewals, your safety record, the week, or any one module or deal. Try one of these:',
  miss: (nearest: string): string => `I can't answer that from what the board knows, and I won't guess. The nearest I have is ${nearest}.`,
  missNearestNeeds: 'what needs you now',
  missNearestSetup: 'the setup steps',

  needsNone: 'Nothing waits on you right now.',
  needsFirstRun: 'Nothing waits on you yet, because no deal exists yet. Setup comes first.',
  needsSome: (n: number, soonest: string, left: string | null): string =>
    `${plural(n, 'thing waits', 'things wait')} on you. The soonest is ${soonest}${left ? `, ${left}` : ''}. ${ASSISTANT_NO_MONEY_MOVES}`,
  silenceNone: 'Nothing waits on you, so there is nothing to ignore. No money moves by itself.',
  silenceHead: 'If you do nothing, no money moves by itself. Here is what each waiting item does on its own:',
  silenceItem: (label: string, onSilence: string | null): string => `${label}: ${onSilence ? clause(onSilence) : 'what it does on its own is not available yet'}.`,
  silenceMore: (n: number): string => `${plural(n, 'more waits', 'more wait')} on you, shown in the list.`,

  moneyNone: 'Your limits are not available yet.',
  moneyRoom: (room: string, cap: string | null): string => (cap ? `Room left today is ${room} of ${cap}.` : `Room left today is ${room}.`),
  moneyRoomUnknown: 'Room left today is not available yet.',
  // The digest's held figure is held at PayPal PLUS agreed and not yet at PayPal (BoardMoney.held_minor,
  // useBoardModel: held + committed), so the sentence names both halves; the board's own words
  // (BOARD_FIGURE.fact.held, BOARD_MONEY.held). The split is not in the digest (contract.ts BoardMoney).
  moneyHeld: (held: string): string => `${held} is held at PayPal or agreed and waiting to be paid.`,
  moneyHeldUnknown: 'What is held is not available yet.',
  moneyPaid: (paid: string): string => `Paid today: ${paid}.`,
  moneyDeals: (n: number, cap: number | null): string => (cap === null ? `${plural(n, 'deal', 'deals')} today.` : `${n} of ${cap} deals today.`),

  rulesUnknown: 'How many rules are in force is not available yet.',
  rulesNone: 'You have not signed any rules yet.',
  rulesSome: (n: number): string => `${plural(n, 'rule set is', 'rule sets are')} in force.`,

  rescueNone: 'No failed renewals on the board.',
  rescueSome: (needs: number, moving: number, stopped: number, paid: number): string => {
    const parts = [
      needs ? `${needs} ${needs === 1 ? 'needs' : 'need'} you` : '',
      moving ? `${moving} ${moving === 1 ? 'is' : 'are'} retrying by itself` : '',
      stopped ? `${stopped} stopped` : '',
      paid ? `${paid} recovered` : '',
    ].filter(Boolean);
    return `Renewals: ${parts.join(', ')}.`;
  },

  safetyNone: 'No checks have run yet, because no deal exists yet.',
  safetyStopped: (n: number, byShield: number): string =>
    n === 0
      ? 'Nothing has been stopped on this board.'
      : `${plural(n, 'deal was', 'deals were')} stopped${byShield ? `, ${byShield} of them by Shield` : ''}.`,

  bookCounts: (total: number, needs: number, moving: number, stopped: number, paid: number): string =>
    total === 0
      ? 'No deals on the board yet.'
      : `${plural(total, 'deal', 'deals')} on the board: ${needs} ${needs === 1 ? 'needs' : 'need'} you, ${moving} moving by ${moving === 1 ? 'itself' : 'themselves'}, ${stopped} stopped, ${paid} paid.`,
  weekHead: 'Here is the week replayed from your record.',

  setupFirstRun: 'Setup steps, in order. Nothing can be paid until they are done.',
  setupDone: 'All setup steps are done.',
  setupNext: (step: string): string => `Next: ${step}.`,
  setupUnknown: 'Setup progress is not available yet.',

  moduleCounts: (name: string, total: number, needs: number, stopped: number): string =>
    total === 0 ? `${name} has no deals on the board.` : `${name}: ${plural(total, 'deal', 'deals')}, ${needs} ${needs === 1 ? 'needs' : 'need'} you, ${stopped} stopped.`,
  moduleStopped: (name: string, n: number): string => (n === 0 ? `${name} has not stopped anything on this board.` : `${name} stopped ${plural(n, 'deal', 'deals')}.`),
  moduleFate: (name: string, fate: keyof typeof ASSISTANT_FATE_WORD, n: number): string => `${name}: ${n} ${ASSISTANT_FATE_WORD[fate]}.`,

  dealNeeds: (label: string, state: string, amount: string | null, left: string | null, onSilence: string | null): string =>
    `${label} is ${state.toLowerCase() || 'waiting on you'}${amount ? `, ${amount}` : ''}${left ? `, ${left}` : ''}. If you do nothing, ${onSilence ? clause(onSilence) : 'no money moves by itself'}.`,
  dealOther: (label: string, state: string, amount: string | null): string => `${label} is ${state.toLowerCase() || 'on the board'}${amount ? `, ${amount}` : ''}.`,
  dealMany: (n: number): string => `${n} deals match; showing the one that needs you first.`,
} as const;

export const ASSISTANT_WHY = {
  decision: (onSilence: string | null): string => `Opens the decision so you can look at it. If you do nothing, ${onSilence ? clause(onSilence) : 'no money moves by itself'}.`,
  credentials: 'Opens the step to connect your PayPal account. If you do nothing, nothing can be paid.',
  mandate: 'Opens the step where you sign your rules. If you do nothing, no rules are in force.',
  unlock: 'Opens the unlock step. If you do nothing, decisions stay locked.',
} as const;

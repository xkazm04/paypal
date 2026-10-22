// Words for the safety area of the console (rebuild WP3c): "Your safety record". Owned by the WP3c
// builder; every user-facing string of the area goes here, never inline. Re-exported from
// lib/words.ts by one `export *` line. Rules (docs/ux/UX-GUIDE.md): sentence case, Maya's words, no
// internals on the first view (the chain head and the precise finding live one level down), PayPal
// is the only vendor name. The verdict sentences themselves are windows/main/safety/model.ts's
// (pure, tested). Imports nothing from lib/words.ts. Strings moved from safety/SafetySheet.tsx are
// byte-identical.

/** The kicker; `null` while the record has not been checked (reading, or it could not be read). */
export const SAFETY_KICKER = (when: string | null): string => (when === null ? 'Your safety record' : `Your safety record · checked ${when}`);
export const SAFETY_READING = 'Checking your record…';
export const SAFETY_READING_SUB = 'The wallet reads every entry and every deal again. Nothing is assumed until it answers.';
export const SAFETY_UNREAD = 'Your safety record couldn’t be checked right now';
export const SAFETY_UNREAD_SUB = 'Nothing has changed with your money. Try again in a moment.';

export const SAFETY_FOUND = {
  label: 'What broke the rules',
  one: 'Look at this now',
  many: (n: string): string => `Look at these ${n} now`,
  open: 'Open deal ›',
  first: (shown: string, all: string): string => `Showing the first ${shown} of ${all}.`,
  ifNothing: 'the finding stays on record · nothing moves by itself',
} as const;

export const SAFETY_CARD = {
  records: 'Your record',
  recordsValue: (n: string): string => `${n} ${n === '1' ? 'record' : 'records'}`,
  unbroken: 'unbroken, each links to the one before',
  broken: 'the chain is broken',
  money: 'Money steps',
  moneyNote: 'who decided each one',
  moneyNone: 'none yet',
  refused: 'Refused',
  refusedValue: (n: string): string => `${n} ${n === '1' ? 'request' : 'requests'}`,
  refusedNone: 'Nothing refused',
  refusedNote: 'PayPal was never asked for any of them',
  refusedNoteCalls: 'see what reached PayPal',
  deals: 'Deals checked',
  dealsValue: (a: string, b: string): string => `${a} of ${b}`,
} as const;

export const SAFETY_VIEW = {
  who: 'Who decided each money step',
  whoSub: 'Every money step at PayPal, by who allowed it. An agent never did.',
  whoLabel: (parts: string): string => `Who decided each money step: ${parts}`,
  refused: 'Why your agents were refused',
  refusedSub: 'Every refusal happened before PayPal was asked.',
  refusedNone: 'Your agents haven’t been refused anything.',
  /** Refusals the wallet counted but did not write to your record (too many in one minute), since it started. */
  refusalsSkipped: (n: string): string => `${n} more ${n === '1' ? 'refusal was' : 'refusals were'} not written to your record: too many came in one minute. Counted since your wallet started.`,
  /** Refusals the wallet tried to write to your record and could not. */
  refusalsLost: (n: string): string => `${n} ${n === '1' ? 'refusal' : 'refusals'} could not be written to your record. Counted since your wallet started.`,
  details: 'The record itself',
  detailsSub: 'How the wallet checked it, for anyone who wants the proof.',
  records: 'Records',
  chain: 'Chain',
  chainOk: 'each record links to the one before it',
  chainBroken: 'broken',
  latest: 'Latest record',
  latestTitle: 'The fingerprint of the newest record. Any change to an earlier record changes it.',
  dealsChecked: 'Deals checked',
  of: (a: string, b: string): string => `${a} of ${b}`,
  histories: 'Message histories verified',
  refusedDeals: 'Refused deals',
  refusedDealsLine: (n: string, calls: string): string => `${n} · PayPal calls on them: ${calls}`,
  moneySteps: 'Money steps',
  checked: (t: string): string => `Checked ${t}.`,
} as const;

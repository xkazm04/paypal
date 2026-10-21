// Words for the rules area of the console (rebuild WP3c): Agent rules (the signed mandates) and the
// wallet limits. Owned by the WP3c builder; every user-facing string of the area goes here, never
// inline. Re-exported from lib/words.ts by one `export *` line. Rules (docs/ux/UX-GUIDE.md):
// sentence case, Maya's words, no internals (no clause numbers, no ids on the first view), PayPal
// is the only vendor name, every needs-you line carries "If you do nothing". Imports nothing from
// lib/words.ts (it is re-exported from there). Strings moved from setup/Mandates.tsx are kept.

export const RULES_KICKER = 'Agent rules · signed by you';

export const RULES_IF = {
  none: 'every agent request is refused · PayPal is never asked',
  off: 'those agents can’t act · PayPal is never asked',
  ok: 'your rules stay as signed',
} as const;

export const RULES_ACT = {
  first: 'Set your first rules',
  change: 'Change rules',
  changeOne: 'Change',
  title: 'Opens the approval window, where you sign rules',
  oneTitle: 'Opens the approval window, where you sign the new version',
} as const;

export const RULES_CARD = {
  inForce: 'In force',
  inForceValue: (n: number): string => (n === 1 ? 'One rule set' : `${n} rule sets`),
  inForceNote: (agents: number): string => (agents === 1 ? 'for one agent' : `for ${agents} agents`),
  off: 'Not in force',
  offValue: (n: number): string => (n === 0 ? 'None' : n === 1 ? 'One rule set' : `${n} rule sets`),
  offNote: 'retired, ended or to sign again',
  offNoteNone: 'every set you signed is working',
  ask: 'Asks you above',
  askNote: 'the lowest amount any rule asks you about',
  askNone: 'No rule asks you',
  limits: 'Wallet limits',
  limitsNote: 'one cap above every rule',
  /** The Wallet limits card's note: its figure is the day's budget, not the footer's "Paid out today". */
  limitsBudgetNote: 'budget used today · not the same as “Paid out today”',
  limitsNone: 'None signed',
} as const;

export const RULES_LIST = {
  label: 'Your rule sets',
  empty: 'No rules signed yet. Until you sign some, every agent request is refused before PayPal is asked.',
  noMatch: 'No rule set matches. Clear the search or the filter to see them all.',
  pick: 'Pick a rule set to read every rule in it.',
  inForce: 'In force',
  agentOf: (agent: string): string => `${agent} agent`,
  sort: { agent: 'By agent', newest: 'Newest version', ending: 'Ends soonest' },
} as const;

/** One rule set's state, in words (never a raw state name). */
export const RULES_STATE = {
  active: (d: string): string => `in force until ${d}`,
  ended: (d: string): string => `ended ${d}`,
  soon: (d: string): string => `starts ${d}`,
  unsigned: 'not signed',
  unsignedTitle: 'This rule set has no owner signature, so it allows nothing',
  again: 'needs signing again',
} as const;

/** What each deal kind a rule set covers is for, in Maya's words. */
export const RULES_CATEGORY = { office: 'office supplies', parts: 'parts', compute: 'computing', service: 'services', other: 'other things' } as const;

export const RULES_DOC = {
  kicker: (agent: string, version: number, signed: string): string => `${agent} · version ${version} · valid from ${signed}`,
  inForce: (left: string, n: number): string => `In force · until ${left} · ${n === 1 ? 'one rule' : `${n} rules`}, signed by you`,
  retired: 'Not in force. Deals made under it stay in the record; it allows nothing new.',
  refused: 'This rule set no longer fits what the wallet accepts, so its agent can’t act under it. Sign it again or withdraw it.',
  limits: 'The limits it can never pass',
  every: 'Every rule',
  proof: 'Proof details',
  version: 'Version',
  valid: (a: string, b: string): string => `${a} to ${b}`,
  validK: 'Valid',
  rulesId: 'Rules id',
  agentKey: 'Agent key',
  signature: 'Signature',
  signed: 'signed by you',
  missing: 'missing',
  changeHint: 'To change a rule, use Change: you read and sign the new version in the approval window.',
  purpose: {
    covers: (what: string): string => `for ${what}`,
    any: 'for any kind of deal',
  },
} as const;

export const RULES_EXPLAIN = {
  summary: 'What the rules do',
  body: [
    'Your agents can suggest anything. Only what fits a rule set you signed goes ahead; everything else is refused before PayPal is ever asked.',
    'Each change is a new signed version; the old one stays in your records. You sign in the approval window, where only you can.',
    'Wallet limits sit above every rule set: they can only make your rules stricter, never looser.',
  ],
} as const;

export const LIMITS_PLACE = {
  kicker: 'Agent rules · wallet limits',
  meters: 'Today against your limits',
  unread: 'Your wallet limits could not be read right now. Nothing has changed with your money.',
  reading: 'Reading your wallet limits…',
  mixed: 'Money went out in more than one currency today, so nothing is added up.',
  ifNothing: 'your limits stay as signed',
  /** The daily meter is the day's budget (every payment agreed today), never the footer's figure. */
  budget: 'Budget used today',
  budgetNote: 'Every payment your agents agreed to today counts here, paid or not. “Paid out today” at the bottom of the window counts only money PayPal collected.',
  factPaid: 'Paid out today (collected by PayPal)',
  factBudget: 'Budget used today (agreed, paid or not)',
  factLimits: 'Your signed limits',
  factIn: 'Money coming in',
  factInValue: 'Never limited',
  nothingYet: 'Nothing yet',
} as const;

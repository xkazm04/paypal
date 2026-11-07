// Words of the Rules flow (spark chat-configure): one question per card, the owner's words.
export const RULES_FLOW = {
  loading: 'Reading your current limits…',
  perDeal: {
    ask: 'The most an agent may spend on one deal?',
    sum: (v: string): string => `Most per deal: ${v}`,
  },
  perDay: {
    ask: 'The most all agents may spend in a day?',
    sum: (v: string): string => `Most per day: ${v}`,
  },
  askAbove: {
    ask: 'Above what amount should an agent ask you first?',
    sum: (v: string): string => `Ask me above: ${v}`,
  },
  ends: {
    ask: 'How long should these limits last?',
    asked: (date: string): string => `They now run until ${date}. How long should the new ones last?`,
    sum: (v: string): string => `Lasts: ${v}`,
  },
  keep: (v: string): string => `Keep ${v}`,
  durations: ['for a day', 'for 3 days', 'for a week', 'for a month'] as readonly string[],
  review: {
    ask: 'Here is what you would sign. Does it read right?',
    sum: 'Reviewed the new limits',
    sign: 'Looks right, sign it',
    again: 'Start over',
  },
  sign: {
    sum: 'Waiting for your signature',
    note: 'Signing happens in the approval window. Nothing changes until you sign there.',
  },
  unread: 'These limits cannot be read into rules. Nothing changed.',
  notSigned: 'Not signed. Your limits stay as they were.',
  changed: (sentence: string): string => `Limits changed: ${sentence}`,
  locked: 'Your wallet is locked. Unlock it to change your limits.',
} as const;

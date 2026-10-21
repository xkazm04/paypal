// Words for the rewind area of the console (rebuild WP3c): the week replayed from the wallet's own
// verified record. Owned by the WP3c builder; every user-facing string of the area goes here, never
// inline. Re-exported from lib/words.ts by one `export *` line. Rules (docs/ux/UX-GUIDE.md):
// sentence case, Maya's words, no internals, PayPal is the only vendor name. The narration itself is
// windows/main/logic.ts's (pure, tested). Imports nothing from lib/words.ts. Strings moved from
// RewindParts.tsx are byte-identical.

export const REWIND_KICKER = (week: string): string => `Rewind · ${week}`;
export const REWIND_THIS_WEEK = 'This week';
export const REWIND_ANSWER = {
  reading: 'Reading the week…',
  unread: 'The week’s record couldn’t be read right now',
  quiet: 'Nothing moved this week. Waiting never sent money.',
  /** `partial`: the week had more steps than one read returns, so the counts are a floor. */
  steps: (calls: number, refused: number, partial = false): string => {
    const c = calls === 1 ? 'One PayPal money step' : `${calls.toLocaleString('en-US')} PayPal money steps`;
    const r = refused === 0 ? '' : refused === 1 ? ', one refused before PayPal was asked' : `, ${refused.toLocaleString('en-US')} refused before PayPal was asked`;
    if (partial) return `At least ${calls === 1 ? 'one PayPal money step' : `${calls.toLocaleString('en-US')} PayPal money steps`} this week${r}. Waiting never sent money.`;
    return `${calls === 0 ? 'No PayPal money step' : c} this week${r}. Waiting never sent money.`;
  },
  sub: 'Replayed from the wallet’s own record. Play the week, drag the playhead, or open any step to see its deal.',
} as const;

export const REWIND_CARD = {
  owner: 'You decided',
  rule: 'Your rules decided',
  default: 'Safe default',
  refused: 'Refused',
  refusedNote: 'PayPal never asked',
  steps: (n: string): string => `${n} money steps`,
  none: 'None',
  ownerNote: 'in the approval window',
  ruleNote: 'a rule you signed allowed it',
  buyerNote: 'your shop rules collected',
  defaultNote: 'a deadline released or voided, never a payment',
} as const;

/** The scrubber and its hub (moved from RewindParts.tsx). */
export const REWIND_BAR = {
  label: 'Rewind the week',
  pause: 'Pause',
  pauseTitle: 'Pause (Space)',
  play: 'Play the week',
  playTitle: 'Play the week (Space)',
  before: 'The week before',
  after: 'The week after',
  legend: 'What the ticks mean',
  legendShort: { owner: 'You', rule: 'Your rule', buyer: 'Buyer approved', default: 'Safe default', refused: 'Refused', unknown: 'Not recorded' },
  now: 'Back to now',
  nowTitle: 'Leave Rewind and go back to the console as it is now (Esc)',
  playhead: 'Playhead',
  opens: 'opens the deal',
  failed: 'The week’s record',
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  jump: 'Jump to a day',
  jumpTo: (day: string): string => `Move the playhead to ${day}`,
} as const;

export const REWIND_HUB = {
  at: (t: string): string => `At the playhead · ${t}`,
  reading: 'reading the week…',
  noCall: 'no PayPal call',
  stoppedRules: 'Stopped by your rules',
  stoppedSafety: 'Stopped by a safety check',
  open: 'Open deal ›',
  calm: 'Nothing yet this week',
  count: (calls: number, refused: number): string => `${calls} PayPal ${calls === 1 ? 'call' : 'calls'} · ${refused} refused, PayPal never asked`,
} as const;

/** The tape: every step of the week, newest first. */
export const REWIND_TAPE = {
  title: 'Every step, newest first',
  label: 'Every step of the week',
  empty: 'Nothing happened this week. If you do nothing, no money moves.',
  noMatch: 'No step matches. Clear the search or the filter to see the whole week.',
  filter: 'Who decided',
  none: 'No PayPal call',
  sorts: { newest: 'Newest first', oldest: 'Oldest first' },
  paypal: 'PayPal',
} as const;

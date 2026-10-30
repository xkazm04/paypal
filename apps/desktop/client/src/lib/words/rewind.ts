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

/** The deal's charts (windows/main/charts.tsx): the offers coming together, the market band and its
 *  mini glyph. Amounts arrive formatted. */
export const CHART_WORDS = {
  noOffers: 'No offers yet. The chart fills in as offers arrive.',
  offersLabel: (max: string | null, who: string, last: string): string => `Offers coming together. ${max !== null ? `Most you’ll pay ${max}. ` : ''}Latest offer from ${who}: ${last}.`,
  you: 'you',
  typical: (lo: string, hi: string): string => `typical ${lo}–${hi}`,
  theirOffer: (name: string, listed: boolean, price: string, checked: boolean): string => `${name} ${listed ? 'listed it at' : 'offered'} ${price}${checked ? ' · signature checked' : ' · signature could not be checked'}`,
  yourOffer: (accepted: boolean, price: string, checked: boolean): string => `You ${accepted ? 'accepted' : 'offered'} ${price}${checked ? ' · signature checked' : ' · signature could not be checked'}`,
  outside: ' · outside your range',
  max: 'your max',
  min: (v: string): string => `your min ${v}`,
  axis: (unchecked: boolean): string => `first offer → latest${unchecked ? ' · some signatures could not be checked' : ''}`,
  bandLabel: (lo: string, hi: string, middle: string): string => `Typical price ${lo} to ${hi}, middle ${middle}`,
  middle: (v: string): string => `middle ${v}`,
  thisDeal: (v: string): string => `this deal ${v}`,
} as const;

/** The right of the gold "now" line (the walk-away forecast, drawn as dashed ticks on the same timeline). Money
 *  arrives formatted; the forecast never has a line that sends money out, so "leaves" is only ever $0 here. */
export const REWIND_AHEAD = {
  /** The track's name for a screen reader, and the line above it. */
  label: 'The week behind you and the next 72 hours',
  nowFlag: 'Now',
  nowAt: (t: string): string => `Now · ${t}`,
  /** The headline over the timeline: counts only what the forecast states. */
  walkAway: 'If you walk away',
  unknown: 'can’t be forecast right now',
  reading: 'is being read…',
  leaves: (out: string): string => `${out} leaves.`,
  holds: (n: number): string => (n === 1 ? '1 hold ends on its own.' : `${n} holds end on their own.`),
  comesIn: (sure: string): string => `${sure} comes in.`,
  comesInIf: (upTo: string): string => `Up to ${upTo} comes in only if a buyer approves.`,
  nothing: 'Nothing is scheduled.',
  /** One step ahead, in plain words: `title` is the deal's short title, `amt` the formatted amount. */
  said: {
    lapse: (title: string): string => `${title} lapses · nothing is paid`,
    expire: (title: string): string => `${title} payment request expires · nothing is paid`,
    auto_void: (title: string, amt: string): string => `${title} · the ${amt} hold ends on its own`,
    unconfirm: (title: string): string => `${title} ends as not confirmed by PayPal · nothing is paid`,
    create_order: (title: string): string => `${title} · the payment request goes to the buyer`,
    authorize: (title: string, amt: string): string => `${title} · ${amt} is put on hold for you`,
    capture: (title: string, amt: string): string => `${title} · ${amt} is collected for you`,
  },
  /** Who acts at that step, in the legend's words. */
  who: { default: 'Safe default', rule: 'Your signed rule', buyer: 'The buyer already approved', maybe: 'Only if the buyer approves' },
  whoShort: { default: 'Safe default', rule: 'Your rule', buyer: 'Buyer approved', maybe: 'If the buyer approves' },
  noMoney: 'no money moves',
  legend: 'Dashed ticks are forecast, not recorded',
  legendShort: 'Forecast',
  forecastWord: 'forecast',
  hub: {
    eyebrow: (t: string): string => `If nothing changes · ${t}`,
    nothingYet: 'Nothing is scheduled up to here',
    nothingAll: 'Nothing is scheduled. If you do nothing, nothing happens.',
    count: (n: number, until: string): string => (n === 0 ? 'Nothing scheduled in the next 72 hours' : `${n} ${n === 1 ? 'step' : 'steps'} ahead · forecast to ${until}`),
    unread: 'The forecast can’t be read right now, so nothing here is promised.',
    open: 'Open deal ›',
  },
  /** The tables open now for the item just said, each against the two numbers the owner gave. */
  peek: {
    label: (item: string): string => (item ? `Your open tables for the ${item}, at their latest price` : 'Your open tables for it, at their latest price'),
    note: 'if the price stays',
    alone: (price: string): string => `${price} · your agent could agree to this on its own`,
    asks: (price: string, ask: string): string => `${price} · above ${ask}, so your agent would stop and ask you`,
    over: (price: string, most: string): string => `${price} · over your most of ${most}, so your agent would not agree`,
    open: 'Open this deal',
  },
  zoom: { label: 'Scale', week: 'Week', ahead: 'Next 72 h', weekTitle: 'Show the whole week and the next 72 hours', aheadTitle: 'Zoom to the last day and the next 72 hours' },
  beyond: 'beyond the forecast',
  tickNow: 'Runs the next time The Table checks',
  tickIf: 'Only if the buyer approves on PayPal',
  jumpNow: 'Move the playhead to now',
  /** What the rules the owner said would allow, said under the headline. `until` is when the rules end. */
  rule: {
    asks: (until: string): string => `With these rules your agent asks you before every payment, until ${until}.`,
    alone: (amt: string, until: string): string => `With these rules your agent can agree up to ${amt} on its own, until ${until}. Above that it asks you.`,
    perDay: (amt: string): string => `Most ${amt} a day.`,
    ends: (until: string): string => `Your new rules end · ${until}`,
    endsTitle: (until: string): string => `The rules you said end ${until}. After that your agent can do nothing.`,
    reach: (amt: string): string => `Your agent may agree up to ${amt} alone`,
    reachAsks: 'Your agent asks you every time',
    label: 'What the rules you said would allow',
  },
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

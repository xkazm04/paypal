// BROWSER PREVIEW ONLY. "Maya's week" as data: one timeline that drives The Table, the Tumbler
// and the approval window on the mock world, for judges who will not install a binary and as the
// rehearsal rig for the video (design report §11, card client-foundation-2).
//
// Each beat has a time on the scenario clock (`at`, seconds from the start), a caption in plain
// words, the window the camera follows, and actions (actions.ts). The script never approves or
// pays: the approval window only opens, and whatever happens there is the viewer's own click.
import type { Action } from './actions';
import { HAGGLE, HOLD, MISMATCH, helpers as h } from './helpers';

export type ChapterId = 'intro' | 'haggle' | 'silence' | 'mismatch' | 'closed' | 'end';
export type Focus = 'desk' | 'main' | 'tumbler' | 'approval';

/** A chapter of a story; `C` is the story's chapter ids (Maya's week by default). */
export type Chapter<C extends string = ChapterId> = { id: C; title: string };

export type Beat<C extends string = ChapterId> = {
  id: string;
  chapter: C;
  /** Seconds from the start of the scenario at which the beat plays. */
  at: number;
  /** What a judge reads: plain words, no internals. */
  caption: string;
  focus: Focus;
  do: Action[];
};

export const CHAPTERS: readonly Chapter[] = [
  { id: 'intro', title: 'Maya’s week' },
  { id: 'haggle', title: 'The haggle' },
  { id: 'silence', title: 'She never answers' },
  { id: 'mismatch', title: 'A request that does not match' },
  { id: 'closed', title: 'The Table is closed' },
  { id: 'end', title: 'What silence did' },
];

/** The haggle's signed steps: 2 = Dan's list price and her first offer, 11 = Dan's last counter. */
const OPENING = 2;
const MIDWAY = 6;
const HER_LAST = 10;
const ALL_STEPS = Number.MAX_SAFE_INTEGER;
/** The mismatch deal while the haggle plays: Dan's $329 counter, not yet accepted. Agreed, it
 *  would sit on her wallet limits (most on hold at once) and the haggle's review could not go
 *  ahead, which is not this chapter's story. */
const COUNTERED = 3;
/** The mismatch deal before the seller's payment request: both sides accepted $329. */
const ACCEPTED = 4;

export const BEATS: readonly Beat[] = [
  {
    id: 'intro', chapter: 'intro', at: 0, focus: 'desk',
    caption: 'Maya runs a small monitor shop. Her AI agents haggle, buy and sell for her. Three windows: The Table, the small Tumbler on her desk, and the approval window, where only she decides.',
    do: [
      { do: 'rewind', deal: HAGGLE, upTo: OPENING },
      { do: 'rewind', deal: MISMATCH, upTo: COUNTERED, interim: { state: 'NEGOTIATING', shield: 'CLEAR' } },
      { do: 'main', open: true, route: '' },
      ...h.undock(),
    ],
  },
  {
    id: 'haggle-open', chapter: 'haggle', at: 9, focus: 'main',
    caption: 'Her agent wants a refurbished 27-inch monitor. Her signed rules: at most $340, six offers. Dan asks $389. Her agent offers $290.',
    do: [{ do: 'main', open: true, route: '#d=D-0193' }],
  },
  {
    id: 'haggle-trade', chapter: 'haggle', at: 18, focus: 'main',
    caption: 'They trade offers. Every number is signed by the agent that made it, and every one of hers stays inside her price range.',
    do: [{ do: 'rewind', deal: HAGGLE, upTo: MIDWAY }],
  },
  {
    id: 'haggle-close', chapter: 'haggle', at: 25, focus: 'main',
    caption: 'Her agent climbs to $327, one offer left.',
    do: [{ do: 'rewind', deal: HAGGLE, upTo: HER_LAST }],
  },
  {
    id: 'haggle-gate', chapter: 'haggle', at: 31, focus: 'desk',
    caption: 'Dan counters at $329. Her rules say: above $250, ask me. So the agent stops, and the Tumbler lights up gold.',
    do: [{ do: 'rewind', deal: HAGGLE, upTo: ALL_STEPS }],
  },
  {
    id: 'haggle-card', chapter: 'haggle', at: 39, focus: 'tumbler',
    caption: 'One click on the notification opens the card. From here she can withdraw or open the review. The Tumbler has no pay button.',
    do: h.notificationClicked(HAGGLE),
  },
  {
    id: 'haggle-review', chapter: 'haggle', at: 47, focus: 'approval',
    caption: 'She opens the review. This window is the only place she can agree to money. The preview never clicks for her.',
    do: [{ do: 'approval', deal: HAGGLE }],
  },
  {
    id: 'silence-soon', chapter: 'silence', at: 57, focus: 'tumbler',
    caption: 'She closes it without deciding and gets busy. Later, with under two hours left on Dan’s offer, the ring starts to breathe.',
    do: [{ do: 'approval', deal: null }, ...h.deadlineSoon(HAGGLE)],
  },
  {
    id: 'silence-now', chapter: 'silence', at: 65, focus: 'tumbler',
    caption: 'Fifteen minutes left. The Tumbler gets more insistent, but it still cannot pay.',
    do: h.deadlineNow(HAGGLE),
  },
  {
    id: 'silence-lapsed', chapter: 'silence', at: 72, focus: 'desk',
    caption: 'She never answers. At the deadline the offer lapses by itself. No money moved.',
    do: [...h.deadlinePasses(HAGGLE), { do: 'main', open: true, route: '#d=D-0193' }],
  },
  {
    id: 'mismatch-agreed', chapter: 'mismatch', at: 81, focus: 'main',
    caption: 'Another deal: Maya and Dan agreed on $329 for a QHD monitor. Now Dan’s side sends its payment request.',
    // the Tumbler goes back to its puck: the lapsed haggle's card is done, and the held request
    // should arrive on a quiet desk, not behind another deal's card
    do: [
      { do: 'rewind', deal: MISMATCH, upTo: ACCEPTED, interim: { state: 'AGREED', shield: 'CLEAR' } },
      { do: 'main', open: true, route: '#d=D-0199' },
      ...h.undock(),
    ],
  },
  {
    id: 'mismatch-arrives', chapter: 'mismatch', at: 88, focus: 'desk',
    caption: 'It asks for $339. The signed deal says $329. The wallet holds it before anything reaches PayPal.',
    do: [{ do: 'rewind', deal: MISMATCH, upTo: ALL_STEPS }],
  },
  {
    id: 'mismatch-card', chapter: 'mismatch', at: 96, focus: 'tumbler',
    caption: 'A held request has no pay button anywhere. The Tumbler only offers to show her why.',
    do: h.notificationClicked(MISMATCH),
  },
  {
    id: 'mismatch-review', chapter: 'mismatch', at: 103, focus: 'approval',
    caption: 'Even in the approval window, a payment request that does not match the deal cannot be paid.',
    do: [{ do: 'approval', deal: MISMATCH }],
  },
  {
    id: 'closed-table', chapter: 'closed', at: 112, focus: 'tumbler',
    caption: 'Maya closes The Table. The Tumbler stays on her desk and carries what is still open.',
    do: [{ do: 'approval', deal: null }, { do: 'main', open: false }, ...h.tableClosedFirstTime()],
  },
  {
    id: 'closed-hold', chapter: 'closed', at: 120, focus: 'tumbler',
    caption: 'A $64 dock for the test bench is on hold at PayPal: allowed by her rules, not yet paid.',
    do: h.notificationClicked(HOLD),
  },
  {
    id: 'closed-days', chapter: 'closed', at: 128, focus: 'tumbler',
    caption: 'Days pass and nobody pays for the dock. Two hours before the hold ends, the ring breathes.',
    do: h.deadlineSoon(HOLD),
  },
  {
    id: 'closed-last', chapter: 'closed', at: 135, focus: 'tumbler',
    caption: 'The last fifteen minutes.',
    do: h.deadlineNow(HOLD),
  },
  {
    id: 'closed-released', chapter: 'closed', at: 141, focus: 'tumbler',
    caption: 'The hold releases by itself at the deadline. When nobody decides, the hold is released, never paid. No money moved.',
    do: h.deadlinePasses(HOLD),
  },
  {
    id: 'end-table', chapter: 'end', at: 148, focus: 'main',
    caption: 'When she opens The Table again, the deal says what happened and who decided: the deadline, not an agent.',
    do: [{ do: 'main', open: true, route: '#d=D-0190' }, ...h.undock()],
  },
  {
    id: 'end-safety', chapter: 'end', at: 159, focus: 'main',
    caption: 'Her safety record checks every entry the wallet wrote: who decided each money step, and that PayPal never heard of a request her rules refused.',
    do: [{ do: 'main', open: true, route: '#m=book&p=safety' }],
  },
  {
    id: 'end', chapter: 'end', at: 170, focus: 'desk',
    caption: 'Every deadline this week ended the same way: nothing was paid. Waiting never sends money. That rule lives in the wallet’s code, not in an agent’s instructions.',
    do: [{ do: 'main', open: true, route: '' }],
  },
];

/** How long the last caption stays before the scenario ends. */
export const HOLD_LAST = 12;
export const SCRIPT_LENGTH = (BEATS[BEATS.length - 1]?.at ?? 0) + HOLD_LAST;

export function chapterOf(id: ChapterId): Chapter {
  return CHAPTERS.find((c) => c.id === id) ?? { id, title: '' };
}

/** Index of the last beat due at scenario time `t` (-1 before the first). */
export function beatAt(t: number, beats: readonly Beat<string>[] = BEATS): number {
  let i = -1;
  for (let k = 0; k < beats.length; k++) if ((beats[k]?.at ?? Infinity) <= t) i = k;
  return i;
}

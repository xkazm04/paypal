// BROWSER PREVIEW ONLY. The rehearsal rig's side of the beat file: what each beat must show on
// screen when it has settled, how a still of it is named, which beats a chapter take covers, and
// the story date a take starts on. `scripts/takes.mjs` drives the director with these through the
// read-only `window.__takes` hook the director page installs (see README.md in this folder).
//
// Everything here is pure: the director gathers what its three frames show into a `Seen` and
// `checkBeat` says what is missing. A broken beat fails loudly here before a take is recorded.
import type { DealState } from '@bindings/DealState';
import { BEATS, CHAPTERS, SCRIPT_LENGTH, type Beat, type Chapter } from './beats';
import { HAGGLE, HOLD, MISMATCH } from './helpers';

export type FrameName = 'main' | 'tumbler' | 'approval';

/** One thing a settled beat must (or must not) show. */
export type Expect =
  /** Text in a framed window (case-sensitive substring, whitespace folded, or a pattern).
   *  `absent`: must not be there. */
  | { in: FrameName; text: string | RegExp; absent?: true }
  /** A button a framed window offers (enabled and drawn), by its label. */
  | { in: FrameName; button: RegExp; absent?: true }
  /** A window the director shows or hides. */
  | { window: 'main' | 'approval'; open: boolean }
  /** A deal of the sample week, by label, is in this state on the mock world. */
  | { deal: string; state: DealState };

/** What the director's stage shows right now (gathered by the director, checked here). */
export type Seen = {
  /** The permanent preview banner of the director page, as rendered. */
  banner: string;
  /** Rendered text of each framed window ('' when it has no document). */
  text: Record<FrameName, string>;
  /** Labels of the enabled, drawn buttons and links in each framed window. */
  buttons: Record<FrameName, string[]>;
  open: { main: boolean; approval: boolean };
  /** Deal label -> state on the mock world, for the labels the expectations name. */
  states: Record<string, DealState | undefined>;
};

/** The banner every frame of every take carries. */
export const BANNER = 'Browser preview with sample data — not the wallet. No PayPal page is ever shown.';
/** The badge each framed window shows on the mock (shared/honesty.tsx MockBadge). */
export const MOCK_BADGE = 'Preview · sample data';

/** A button that pays, approves or captures: the Tumbler never has one, nor does a held request. */
const PAYS = /^\s*(pay|approve|accept|capture|release|confirm)\b/i;
const NO_PAY_IN_TUMBLER: Expect = { in: 'tumbler', button: PAYS, absent: true };
/** The Tumbler at rest (its puck): no card, so no "if you do nothing" line. */
const TUMBLER_AT_REST: Expect = { in: 'tumbler', text: 'If you do nothing', absent: true };
const LEFT_SOON = /\b1 h (3\d|4\d) min left\b/;
const LEFT_NOW = /\b1[34] min left\b/;

/** Each beat's settled end state, from the story tests (story.test.ts) as it shows on screen. */
export const EXPECT: Readonly<Record<string, readonly Expect[]>> = {
  intro: [
    { window: 'main', open: true },
    { window: 'approval', open: false },
    { in: 'main', text: 'This week' },
    TUMBLER_AT_REST,
    { deal: HAGGLE, state: 'NEGOTIATING' },
    { deal: MISMATCH, state: 'NEGOTIATING' },
  ],
  'haggle-open': [
    { in: 'main', text: 'Refurbished 27-inch 4K monitor' },
    { in: 'main', text: '$389.00' },
    { in: 'main', text: '$290.00' },
  ],
  'haggle-trade': [
    { in: 'main', text: 'Refurbished 27-inch 4K monitor' },
    { in: 'main', text: '$290.00' },
    { in: 'main', text: '$327.00', absent: true },
  ],
  'haggle-close': [
    { in: 'main', text: '$327.00' },
    { in: 'main', text: 'Accept Dan’s $329.00?', absent: true },
  ],
  'haggle-gate': [
    { in: 'main', text: 'Accept Dan’s $329.00?' },
    { in: 'tumbler', text: 'Approve $329.00' },
    { deal: HAGGLE, state: 'NEGOTIATING' },
  ],
  'haggle-card': [
    { in: 'tumbler', button: /Review and decide/ },
    { in: 'tumbler', button: /^Withdraw\b/ },
    NO_PAY_IN_TUMBLER,
  ],
  'haggle-review': [
    { window: 'approval', open: true },
    { in: 'approval', text: 'Accept the offer from Dan' },
    { in: 'approval', text: 'checking', absent: true },
    // the decision is really hers to take here: every check passes and the button is live
    { in: 'approval', text: /\b[1-9] failed\b/, absent: true },
    { in: 'approval', button: /Hold to approve \$329\.00/ },
    { deal: HAGGLE, state: 'NEGOTIATING' },
  ],
  'silence-soon': [
    { window: 'approval', open: false },
    { in: 'tumbler', text: LEFT_SOON },
    { in: 'tumbler', text: 'Approve $329.00' },
    NO_PAY_IN_TUMBLER,
  ],
  'silence-now': [
    { in: 'tumbler', text: LEFT_NOW },
    { in: 'tumbler', text: 'Approve $329.00' },
    NO_PAY_IN_TUMBLER,
  ],
  'silence-lapsed': [
    { in: 'tumbler', text: 'Withdrawn' },
    { in: 'tumbler', text: 'nothing paid' },
    { in: 'main', text: 'Refurbished 27-inch 4K monitor' },
    { deal: HAGGLE, state: 'WITHDRAWN' },
  ],
  'mismatch-agreed': [
    { in: 'main', text: 'Refurbished 27-inch QHD monitor' },
    { in: 'main', text: '$329.00' },
    { in: 'main', text: '$339.00', absent: true },
    TUMBLER_AT_REST,
    { deal: MISMATCH, state: 'AGREED' },
  ],
  'mismatch-arrives': [
    { in: 'main', text: '$339.00' },
    TUMBLER_AT_REST,
    { deal: MISMATCH, state: 'MISMATCH' },
  ],
  'mismatch-card': [
    { in: 'tumbler', text: 'Asked $339.00, not $329.00' },
    // the caption says the card only offers to show why: no withdraw on a held request
    { in: 'tumbler', button: /See why/ },
    { in: 'tumbler', button: /^Withdraw\b/, absent: true },
    NO_PAY_IN_TUMBLER,
  ],
  'mismatch-review': [
    { window: 'approval', open: true },
    { in: 'approval', text: 'Nothing can be paid' },
    { in: 'approval', button: PAYS, absent: true },
    { in: 'approval', text: 'checking', absent: true },
    { deal: MISMATCH, state: 'MISMATCH' },
  ],
  'closed-table': [
    { window: 'main', open: false },
    { window: 'approval', open: false },
    { in: 'tumbler', text: 'The Table is closed' },
  ],
  'closed-hold': [
    { window: 'main', open: false },
    { in: 'tumbler', text: 'Pay or release $64.00' },
    { in: 'tumbler', text: 'the hold is released at the deadline, nothing is paid' },
    { deal: HOLD, state: 'AUTHORIZED' },
  ],
  'closed-days': [
    { in: 'tumbler', text: LEFT_SOON },
    { in: 'tumbler', text: '$64.00' },
    { deal: HOLD, state: 'AUTHORIZED' },
  ],
  'closed-last': [
    { in: 'tumbler', text: LEFT_NOW },
    { in: 'tumbler', text: '$64.00' },
    { deal: HOLD, state: 'AUTHORIZED' },
  ],
  'closed-released': [
    { in: 'tumbler', text: 'Hold released' },
    { in: 'tumbler', text: 'nothing paid' },
    { deal: HOLD, state: 'AUTO_VOIDED' },
  ],
  'end-table': [
    { window: 'main', open: true },
    { in: 'main', text: 'USB-C dock for the test bench' },
    { deal: HOLD, state: 'AUTO_VOIDED' },
  ],
  'end-safety': [
    { window: 'main', open: true },
    { in: 'main', text: 'Your safety record' },
    { in: 'main', text: 'Nothing moved without your say-so.' },
    { in: 'main', text: 'PayPal was never asked for any of them' },
    { deal: HOLD, state: 'AUTO_VOIDED' },
  ],
  end: [
    { window: 'main', open: true },
    { in: 'main', text: 'This week' },
    { deal: HAGGLE, state: 'WITHDRAWN' },
    { deal: HOLD, state: 'AUTO_VOIDED' },
    { deal: MISMATCH, state: 'MISMATCH' },
  ],
};

/** Deal labels any expectation names (the director reads their states for `Seen.states`). */
export function expectedDeals(expect: Readonly<Record<string, readonly Expect[]>> = EXPECT): string[] {
  const out = new Set<string>();
  for (const list of Object.values(expect)) for (const e of list) if ('deal' in e) out.add(e.deal);
  return [...out];
}

const show = (t: string | RegExp) => (typeof t === 'string' ? `“${t}”` : String(t));
const fold = (s: string) => s.replace(/\s+/g, ' ');
const has = (hay: string, t: string | RegExp) => (typeof t === 'string' ? fold(hay).includes(fold(t)) : t.test(fold(hay)));
const WINDOW_WORD: Record<FrameName, string> = { main: 'The Table', tumbler: 'the Tumbler', approval: 'the approval window' };

/**
 * What is wrong with a settled beat, in words a rehearsal log can print (empty: all good).
 * Besides the beat's own expectations, every frame must carry the honesty marks: the director's
 * banner, and the preview badge in each window that is open.
 */
export function checkBeat(beatId: string, seen: Seen, expect: Readonly<Record<string, readonly Expect[]>> = EXPECT): string[] {
  const fail: string[] = [];
  if (!seen.banner.includes(BANNER)) fail.push('the preview banner is missing');
  const open: Record<FrameName, boolean> = { main: seen.open.main, tumbler: true, approval: seen.open.approval };
  for (const f of ['main', 'tumbler', 'approval'] as const) {
    if (open[f] && !seen.text[f].includes(MOCK_BADGE)) fail.push(`${WINDOW_WORD[f]} shows no “${MOCK_BADGE}” badge`);
  }
  const list = expect[beatId];
  if (!list || list.length === 0) {
    fail.push(`no expected end state is written for beat “${beatId}”`);
    return fail;
  }
  for (const e of list) {
    if ('window' in e) {
      if (seen.open[e.window] !== e.open) fail.push(`${WINDOW_WORD[e.window]} should be ${e.open ? 'open' : 'closed'}`);
    } else if ('deal' in e) {
      const s = seen.states[e.deal];
      if (s !== e.state) fail.push(`${e.deal} should be ${e.state}, is ${s ?? 'missing'}`);
    } else if ('button' in e) {
      const found = seen.buttons[e.in].filter((b) => e.button.test(b));
      if (e.absent && found.length) fail.push(`${WINDOW_WORD[e.in]} should offer no button like ${String(e.button)}, offers “${found.join('”, “')}”`);
      if (!e.absent && !found.length) fail.push(`${WINDOW_WORD[e.in]} should offer a button like ${String(e.button)}`);
    } else {
      const found = has(seen.text[e.in], e.text);
      if (e.absent && found) fail.push(`${WINDOW_WORD[e.in]} should not show ${show(e.text)}`);
      if (!e.absent && !found) fail.push(`${WINDOW_WORD[e.in]} should show ${show(e.text)}`);
    }
  }
  return fail;
}

/** File-safe slug: lower case, a-z 0-9 and dashes. */
export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * A still's file name: `NN-chapter-beat.png`, NN being the beat's index (the director's `?beat=`),
 * zero-padded to two digits. A beat id that already starts with its chapter is not repeated
 * (`haggle-gate` in chapter `haggle` → `04-haggle-gate.png`; `intro` → `00-intro.png`).
 */
export function stillName(index: number, beat: Pick<Beat, 'id' | 'chapter'>, ext = 'png'): string {
  const id = slug(beat.id);
  const chapter = slug(beat.chapter);
  const tail = id === chapter ? id : id.startsWith(`${chapter}-`) ? id : `${chapter}-${id}`;
  return `${String(index).padStart(2, '0')}-${tail}.${ext}`;
}

export type ChapterTake = {
  chapter: Chapter;
  /** Chapter number as the caption rail counts it (0 = the opening, 1 = the haggle, ...). */
  number: number;
  /** Index of the chapter's first and last beat. */
  first: number;
  last: number;
  /** Scenario seconds the take starts and ends at (end = the next chapter's start, or the end). */
  from: number;
  to: number;
};

/**
 * The beats a single-chapter take covers. `sel` is the chapter's number as the caption rail shows
 * it ("1 · The haggle" is 1; the opening is 0) or its id ("haggle"). Null when there is no such
 * chapter.
 */
export function selectChapter(sel: string | number, beats: readonly Beat[] = BEATS, chapters: readonly Chapter[] = CHAPTERS, length = SCRIPT_LENGTH): ChapterTake | null {
  const raw = typeof sel === 'number' ? String(sel) : sel.trim();
  const number = /^\d+$/.test(raw) ? Number(raw) : chapters.findIndex((c) => c.id === raw);
  const chapter = chapters[number];
  if (!chapter) return null;
  const idx = beats.map((b, i) => (b.chapter === chapter.id ? i : -1)).filter((i) => i >= 0);
  const first = idx[0];
  const last = idx[idx.length - 1];
  if (first === undefined || last === undefined) return null;
  const from = beats[first]?.at ?? 0;
  const to = beats[last + 1]?.at ?? length;
  return { chapter, number, first, last, from, to };
}

/** The whole story as one take. */
export function wholeTake(beats: readonly Beat[] = BEATS, length = SCRIPT_LENGTH): { first: number; last: number; from: number; to: number } {
  return { first: 0, last: beats.length - 1, from: beats[0]?.at ?? 0, to: length };
}

/**
 * The scenario's start as Unix seconds: 14:02:04 local time (the fixtures' "lapses at 18:00" and
 * "at 20:00" assume it) on `date` (`YYYY-MM-DD`, for a take that looks the same every time), or
 * today when `date` is missing or not a real date.
 */
export function storyStartOn(date: string | null | undefined, today: Date = new Date()): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  const d = new Date(today.getTime());
  if (m) {
    const [y, mo, da] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
    const want = new Date(y, mo, da);
    if (want.getFullYear() === y && want.getMonth() === mo && want.getDate() === da) d.setFullYear(y, mo, da);
  }
  d.setHours(14, 2, 4, 0);
  return Math.floor(d.getTime() / 1000);
}

/** What the rig reads from the page: the beat list and the take arithmetic, as plain data. */
export type TakePlan = {
  length: number;
  chapters: Array<{ id: string; title: string }>;
  beats: Array<{ index: number; id: string; chapter: string; at: number; focus: Beat['focus']; still: string }>;
};

export function takePlan(beats: readonly Beat[] = BEATS, chapters: readonly Chapter[] = CHAPTERS, length = SCRIPT_LENGTH): TakePlan {
  return {
    length,
    chapters: chapters.map((c) => ({ id: c.id, title: c.title })),
    beats: beats.map((b, index) => ({ index, id: b.id, chapter: b.chapter, at: b.at, focus: b.focus, still: stillName(index, b) })),
  };
}

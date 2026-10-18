// BROWSER PREVIEW ONLY. The rehearsal rig's side of the beat file: what each beat must show on
// screen when it has settled, how a still of it is named, which beats a chapter take covers, and
// the story date a take starts on. `scripts/takes.mjs` drives the director with these through the
// read-only `window.__takes` hook the director page installs (see README.md in this folder).
//
// Everything here is pure: the director gathers what its three frames show into a `Seen` and
// `checkBeat` says what is missing. A broken beat fails loudly here before a take is recorded.
import type { Clause } from '@bindings/Clause';
import type { DealState } from '@bindings/DealState';
import type { StartStepState } from '../lib/firstRun';
import type { MockDeal } from '../mock/fixtures';
import { APPROVAL_FIRST_RUN, CENTRE_TITLE, CHARTER_TITLE, FIRST_RUN_TITLE, IF_NOTHING, REWIND_CARD, SAFE_DEFAULT_LINE, SAFETY_PROMISE, TABLES_VIEWS, type StartStepKey, type TourStopId } from '../lib/words';
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
  | { deal: string; state: DealState }
  /** The tour's coach mark in a framed window shows this stop (null: no mark there). */
  | { in: FrameName; tour: TourStopId | null }
  /** A getting-started step drawn in a framed window is in this state. `absent`: drawn, and not in it. */
  | { in: FrameName; step: StartStepKey; state: StartStepState; absent?: true };

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
  /** The stop each framed window's coach mark shows (its `data-tour-stop`), null when none is drawn. */
  tour?: Record<FrameName, string | null>;
  /** The getting-started steps each framed window draws: step key -> state (`s-next`, `s-todo`, ...). */
  steps?: Record<FrameName, Record<string, string>>;
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
/** The Table on its decision centre (the console's home since the 2026-10-14 rebuild): its title, a
 *  decision with its "If you do nothing" line, and the safe-default line in the footer. */
const CENTRE: readonly Expect[] = [
  { in: 'main', text: CENTRE_TITLE },
  { in: 'main', text: IF_NOTHING },
  { in: 'main', text: SAFE_DEFAULT_LINE },
];

/** Each beat's settled end state, from the story tests (story.test.ts) as it shows on screen. */
export const EXPECT: Readonly<Record<string, readonly Expect[]>> = {
  intro: [
    { window: 'main', open: true },
    { window: 'approval', open: false },
    ...CENTRE,
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
    // halfway: her latest offer and the price range it stays inside (the deal page's facts)
    { in: 'main', text: '$314.00' },
    { in: 'main', text: 'Most you’ll pay $340.00' },
    { in: 'main', text: 'Offers used 3 of 6' },
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
  // a module summary (polish A): the Tables tab with its answer, cards and Latest strip
  'silence-tables': [
    { window: 'main', open: true },
    // the cards (labels are drawn as written; the kicker is upper-cased on screen)
    { in: 'main', text: TABLES_VIEWS.tables },
    { in: 'main', text: TABLES_VIEWS.closed },
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
  // the Rewind (polish A): the week by who decided, and the tape of every step
  'end-rewind': [
    { window: 'main', open: true },
    { in: 'main', text: REWIND_CARD.owner },
    { in: 'main', text: REWIND_CARD.default },
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
    ...CENTRE,
    { deal: HAGGLE, state: 'WITHDRAWN' },
    { deal: HOLD, state: 'AUTO_VOIDED' },
    { deal: MISMATCH, state: 'MISMATCH' },
  ],
};

/** The four getting-started steps on a brand-new wallet, as a window draws them: PayPal next, the
 *  agent app still to do on the practice agent, nothing done. The Table draws them as lines of its
 *  charter, under the charter's title (`charterSteps`); the Tumbler as a list titled by the four
 *  steps, the approval window as a list under the charter's name (it counts no steps: polish A). */
const FOUR_STEPS = (f: FrameName): Expect[] => [
  { in: f, text: f === 'main' ? CHARTER_TITLE : f === 'approval' ? APPROVAL_FIRST_RUN.title : FIRST_RUN_TITLE },
  { in: f, step: 'paypal', state: 'next' },
  { in: f, step: 'rules', state: 'done', absent: true },
  { in: f, step: 'practice', state: 'done', absent: true },
  { in: f, step: 'engine', state: 'todo' },
];
const NO_MARK = (f: FrameName): Expect => ({ in: f, tour: null });

/** Each First run beat's settled end state (firstRunStory.ts), kept apart from Maya's week's: the
 *  four steps where a window shows them and the stop each window's mark shows. */
export const FIRST_RUN_EXPECT: Readonly<Record<string, readonly Expect[]>> = {
  start: [
    { window: 'main', open: true },
    { window: 'approval', open: false },
    ...FOUR_STEPS('main'),
    { in: 'main', tour: 'main.hub' },
    TUMBLER_AT_REST,
    NO_MARK('tumbler'),
  ],
  'table-hub': [...FOUR_STEPS('main'), { in: 'main', tour: 'main.hub' }],
  'table-promise': [{ in: 'main', text: SAFETY_PROMISE }, { in: 'main', tour: 'main.promise' }],
  'table-steps': [...FOUR_STEPS('main'), { in: 'main', tour: 'main.steps' }],
  'table-engine': [{ in: 'main', step: 'engine', state: 'todo' }, { in: 'main', tour: 'main.engine' }],
  'table-approval': [{ window: 'approval', open: false }, { in: 'main', tour: 'main.approval' }],
  'tumbler-what': [...FOUR_STEPS('tumbler'), { in: 'tumbler', tour: 'tumbler.what' }, NO_PAY_IN_TUMBLER],
  'tumbler-needs': [...FOUR_STEPS('tumbler'), { in: 'tumbler', tour: 'tumbler.needs' }],
  'tumbler-engine': [{ in: 'tumbler', step: 'engine', state: 'todo' }, { in: 'tumbler', tour: 'tumbler.engine' }],
  'tumbler-waiting': [{ in: 'tumbler', text: SAFETY_PROMISE }, { in: 'tumbler', tour: 'tumbler.waiting' }, NO_PAY_IN_TUMBLER],
  'approval-only': [
    { window: 'approval', open: true },
    ...FOUR_STEPS('approval'),
    { in: 'approval', tour: 'approval.only' },
    { in: 'approval', button: PAYS, absent: true },
    TUMBLER_AT_REST,
    NO_MARK('tumbler'),
  ],
  'approval-steps': [...FOUR_STEPS('approval'), { in: 'approval', tour: 'approval.steps' }],
  'approval-engine': [{ in: 'approval', step: 'engine', state: 'todo' }, { in: 'approval', tour: 'approval.engine' }],
  'approval-config': [{ window: 'approval', open: true }, { in: 'approval', tour: 'approval.config' }, { in: 'approval', button: PAYS, absent: true }],
  end: [
    { window: 'main', open: true },
    { window: 'approval', open: false },
    ...FOUR_STEPS('main'),
    NO_MARK('main'),
    NO_MARK('tumbler'),
    TUMBLER_AT_REST,
  ],
};

/** Deal labels any expectation names (the director reads their states for `Seen.states`). */
export function expectedDeals(expect: Readonly<Record<string, readonly Expect[]>> = EXPECT): string[] {
  const out = new Set<string>();
  for (const list of Object.values(expect)) for (const e of list) if ('deal' in e) out.add(e.deal);
  return [...out];
}

/** The lines of The Table's charter (windows/main/setup/Charter.tsx, `SETUP_STEPS`), in order. */
export const CHARTER_LINES = ['keys', 'rules', 'practice', 'agent', 'unlock'] as const;
/** A charter line as the getting-started step it stands for (the unlock line stands for none). */
const CHARTER_STEP: Readonly<Record<(typeof CHARTER_LINES)[number], StartStepKey | null>> = { keys: 'paypal', rules: 'rules', practice: 'practice', agent: 'engine', unlock: null };

/**
 * The getting-started steps The Table's charter draws, from its lines' classes in order (`done`,
 * `unknown`, `waiting`, `todo`, plus `cur` on the line it shows): a line done is done, the line it
 * shows (or one waiting on the approval window) is next, the rest are to do.
 */
export function charterSteps(classes: readonly string[]): Record<string, StartStepState> {
  const out: Record<string, StartStepState> = {};
  classes.forEach((cls, i) => {
    const line = CHARTER_LINES[i];
    const key = line ? CHARTER_STEP[line] : null;
    if (!key) return;
    const c = cls.split(/\s+/);
    const state: StartStepState | null = c.includes('done') ? 'done' : c.includes('unknown') ? 'unknown' : c.includes('cur') || c.includes('waiting') ? 'next' : c.includes('todo') ? 'todo' : null;
    if (state) out[key] = state;
  });
  return out;
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
    } else if ('tour' in e) {
      const at = seen.tour?.[e.in] ?? null;
      if (at !== e.tour) fail.push(e.tour === null ? `${WINDOW_WORD[e.in]} should show no tour mark, shows “${at}”` : `${WINDOW_WORD[e.in]} should show the tour at “${e.tour}”, shows ${at ? `“${at}”` : 'no mark'}`);
    } else if ('step' in e) {
      const st = seen.steps?.[e.in]?.[e.step];
      if (st === undefined) fail.push(`${WINDOW_WORD[e.in]} should show the step “${e.step}”`);
      else if (e.absent && st === e.state) fail.push(`${WINDOW_WORD[e.in]} should not show the step “${e.step}” as ${e.state}`);
      else if (!e.absent && st !== e.state) fail.push(`${WINDOW_WORD[e.in]} should show the step “${e.step}” as ${e.state}, shows ${st}`);
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
export function stillName(index: number, beat: { id: string; chapter: string }, ext = 'png'): string {
  const id = slug(beat.id);
  const chapter = slug(beat.chapter);
  const tail = id === chapter ? id : id.startsWith(`${chapter}-`) ? id : `${chapter}-${id}`;
  return `${String(index).padStart(2, '0')}-${tail}.${ext}`;
}

export type ChapterTake = {
  chapter: Chapter<string>;
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
export function selectChapter(sel: string | number, beats: readonly Beat<string>[] = BEATS, chapters: readonly Chapter<string>[] = CHAPTERS, length = SCRIPT_LENGTH): ChapterTake | null {
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
export function wholeTake(beats: readonly Beat<string>[] = BEATS, length = SCRIPT_LENGTH): { first: number; last: number; from: number; to: number } {
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
  /** The story the page plays (`?story=`; Maya's week is `maya`). */
  story: string;
  length: number;
  chapters: Array<{ id: string; title: string }>;
  beats: Array<{ index: number; id: string; chapter: string; at: number; focus: Beat['focus']; still: string }>;
};

export function takePlan(beats: readonly Beat<string>[] = BEATS, chapters: readonly Chapter<string>[] = CHAPTERS, length = SCRIPT_LENGTH, story = 'maya'): TakePlan {
  return {
    story,
    length,
    chapters: chapters.map((c) => ({ id: c.id, title: c.title })),
    beats: beats.map((b, index) => ({ index, id: b.id, chapter: b.chapter, at: b.at, focus: b.focus, still: stillName(index, b) })),
  };
}

// ---- film capture (?take=film, scripts/film-capture.mjs) -----------------------------------------
//
// The demo film's capture adapter: the director films the desk wide and the rig logs where things
// are (video pixels), what was pressed and the figures a motion plate may show. Pure arithmetic and
// reductions here; the director measures and reads the mock world. Watch-only: a press is a
// beat's own action (the director's stand-in for a click), never a click the rig makes.

export type PxRect = { x: number; y: number; w: number; h: number };
/** The desk's CSS transform (translate, then uniform scale from the top-left corner). */
export type DeskTransform = { tx: number; ty: number; s: number };

const FRAMES: readonly FrameName[] = ['main', 'tumbler', 'approval'];

/**
 * A film target: `main|.sel`, `tumbler|.sel` or `approval|.sel` is a selector inside that framed
 * window; anything else is a selector in the director page itself.
 */
export function filmTarget(sel: string): { frame: FrameName | null; css: string } {
  const m = /^(\w+)\|(.*)$/s.exec(sel);
  if (m && (FRAMES as readonly string[]).includes(m[1] ?? '')) return { frame: m[1] as FrameName, css: (m[2] ?? '').trim() };
  return { frame: null, css: sel.trim() };
}

/** The desk transform from its computed matrix (no rotation or skew on the desk: `a` is the scale). */
export function deskTransform(m: { a: number; e: number; f: number } | null): DeskTransform {
  return m ? { tx: m.e, ty: m.f, s: m.a } : { tx: 0, ty: 0, s: 1 };
}

/**
 * A rectangle inside a framed window (its own viewport pixels) in page pixels of the recorded
 * viewport: through the frame's place on the desk (`frame`, desk pixels, untransformed), the desk's
 * transform, and where the desk's box starts on the page (`origin`, the stage's top-left).
 */
export function stageRect(local: PxRect, frame: { x: number; y: number }, desk: DeskTransform, origin: { x: number; y: number }): PxRect {
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    x: r(origin.x + desk.tx + desk.s * (frame.x + local.x)),
    y: r(origin.y + desk.ty + desk.s * (frame.y + local.y)),
    w: r(desk.s * local.w),
    h: r(desk.s * local.h),
  };
}

/** The centre of a rectangle, as a click point. */
export function centre(r: PxRect): { x: number; y: number } {
  return { x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) };
}

/**
 * What a beat's action stands in for pressing, by beat id: the director logs the target's centre as
 * a click at the beat's start (before the action changes the window). A film draws a ripple there;
 * nothing is clicked. The notification is the Tumbler's ticker, or its puck when it rests.
 */
export const FILM_PRESS: Readonly<Record<string, string>> = {
  'haggle-card': 'tumbler|.f.ticker, .puck-art',
  'haggle-review': 'tumbler|.ui-btn.gold',
  'mismatch-card': 'tumbler|.f.ticker, .puck-art',
  'closed-hold': 'tumbler|.f.ticker, .puck-art',
};

/** The haggle's figures for a film plate, from the mock world (never typed constants). */
export type HaggleRecord = {
  /** Her signed price ceiling for the item (dollars). */
  ceiling?: number;
  /** Her signed "ask me above" threshold (dollars). */
  askAbove?: number;
  /** Her agent's offers so far, in order (dollars). */
  offersMaya: number[];
  /** Dan's asks so far, his listing first (dollars). */
  offersDan: number[];
  /** The amount that stopped the agent and waits for her (dollars), once the gate is up. */
  gateAt?: number;
};

const dollars = (m: { minor: number } | null | undefined) => (m ? m.minor / 100 : undefined);

/**
 * Reduce a haggle deal, as the mock world shows it now (rewound part-way or whole), and the signed
 * mandate version it runs under, to the figures a plate may show. The ceiling is the mandate's band
 * for the deal's item (else the deal's own band); the threshold is its human-present clause; the
 * gate is the deal's open decision. Absent figures are omitted keys.
 */
export function haggleRecord(d: Pick<MockDeal, 'deal' | 'display' | 'transcript' | 'attention'>, clauses: readonly Clause[] = []): HaggleRecord {
  const band = clauses.find((c): c is Extract<Clause, { type: 'band' }> => c.type === 'band' && c.item_refs.includes(d.deal.terms.item_ref));
  const ask = clauses.find((c): c is Extract<Clause, { type: 'human_present_over' }> => c.type === 'human_present_over');
  const ceiling = dollars(band?.ceiling ?? d.display.band?.ceiling);
  const askAbove = dollars(ask?.amount);
  const priced = d.transcript.filter((t) => t.price);
  const out: HaggleRecord = {
    offersMaya: priced.filter((t) => t.by === 'you' && (t.typ === 'OFFER' || t.typ === 'COUNTER')).map((t) => dollars(t.price) as number),
    offersDan: priced.filter((t) => t.by === 'them' && (t.typ === 'LISTING' || t.typ === 'COUNTER')).map((t) => dollars(t.price) as number),
  };
  if (ceiling !== undefined) out.ceiling = ceiling;
  if (askAbove !== undefined) out.askAbove = askAbove;
  if (d.attention?.kind === 'gate') out.gateAt = d.attention.amount_minor / 100;
  return out;
}

/** "$1,234.00" as the windows draw a dollar amount. */
export function usdText(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Does the rendered window show the record's latest figures? (the latest offer each side made, and
 * the gate's amount). The words that are missing; empty when the record and the screen agree.
 */
export function recordShown(rec: Partial<HaggleRecord> | Record<string, unknown>, text: string): string[] {
  const last = (v: unknown) => (Array.isArray(v) ? v.at(-1) : undefined);
  const want = [last(rec.offersMaya), last(rec.offersDan), rec.gateAt].filter((n): n is number => typeof n === 'number');
  return [...new Set(want.map(usdText))].filter((t) => !text.includes(t)).map((t) => `the record says ${t}, The Table does not show it`);
}

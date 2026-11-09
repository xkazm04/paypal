// The motion presets (spark perfection-ten B1): the five named gestures the money moments use, each
// with its intent, a duration from the token ladder (DUR / --dur-*), an easing role (EASE / --ease*)
// and its reduced-motion fallback, designed together. presets.css holds their keyframes, the only
// keyframes the presets may use (kit.css imports it, so every window that loads ui.css has them). Motion is spent on a CHANGE, not on things appearing, and only on
// opacity and transform.
//
// One-shot: a change plays once, when the value changes in front of the owner. Never on mount, never
// on a refetch that returned the same value, never when a windowed row scrolls back into view. The
// memory that decides it is keyed by the deal (or row) id plus the value, never by the DOM node.
//
// Budget: at most MOTION_CAP gestures start inside one MOTION_WINDOW_MS; past it (twenty deals moving
// in a second) the rest simply show their new value. Calm (the OS setting or the in-app switch): no
// preset class is ever set, the new value just appears; base.css stops any that slipped through.
//
// Display only: nothing here reads, writes or decides anything, and no information lives only in the
// motion (the words and the numbers are always the final ones).
import { useRef, useState, useEffect } from 'react';
import { DUR, isCalm, type DurName, type EaseName } from './motion';

export type PresetName = 'changed' | 'advanced' | 'arrived' | 'left' | 'settled';

export type Preset = {
  /** The communicative job, in one sentence. */
  intent: string;
  /** The class that plays it (presets.css). */
  className: string;
  /** A step on the token ladder (--dur-*). */
  dur: DurName;
  /** The easing role (--ease, --ease-out, --ease-in). */
  ease: EaseName;
  /** What reduced motion and calm show instead. */
  reduced: string;
};

/** The vocabulary. Add a name here before any component plays a new gesture. */
export const PRESETS: Record<PresetName, Preset> = {
  changed: {
    intent: 'A figure took a new value: a brief lift draws the eye to the new number.',
    className: 'mo-changed', dur: 'slow', ease: 'settle',
    reduced: 'The new value appears at once; nothing moves.',
  },
  advanced: {
    intent: 'A deal moved to its next state: the new state slides in where the old one stood.',
    className: 'mo-advanced', dur: 'med', ease: 'out',
    reduced: 'The new state word and colour appear at once.',
  },
  arrived: {
    intent: 'A row joined a list the owner is looking at.',
    className: 'mo-arrived', dur: 'med', ease: 'out',
    reduced: 'The row is in its place at once.',
  },
  left: {
    intent: 'A row left a list: it fades where it stood, then the rows below close up.',
    className: 'mo-left', dur: 'med', ease: 'in',
    reduced: 'The row is gone at once; the rows below close up with no fade.',
  },
  settled: {
    intent: 'Money landed or a hold completed: one calm press-and-release, then stillness.',
    className: 'mo-settled', dur: 'sheet', ease: 'settle',
    reduced: 'The settled state shows at once; no press.',
  },
};

/** At most this many gestures start in one window; more show their new value with no motion. */
export const MOTION_CAP = 6;
/** The window the cap counts over (one slow beat). */
export const MOTION_WINDOW_MS = DUR.slow;

let started: number[] = [];
const clockNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** May one more gesture start now? Takes a slot when it may. */
export function takeMotion(now: number = clockNow()): boolean {
  started = started.filter((t) => now - t < MOTION_WINDOW_MS);
  if (started.length >= MOTION_CAP) return false;
  started.push(now);
  return true;
}

/** Slots free right now (a list asks before it plays a handful at once). */
export function motionRoom(now: number = clockNow()): number {
  started = started.filter((t) => now - t < MOTION_WINDOW_MS);
  return MOTION_CAP - started.length;
}

/** Test hook: forget every remembered value and every started gesture. */
export function resetMotionMemory(): void {
  started = [];
  values.clear();
}

/** The last value seen per preset + id, and whether its change got a slot: shared by every
 *  instance showing the same deal, so one change takes one slot however many places show it. */
const values = new Map<string, { value: string; play: boolean }>();

/**
 * The class to put on the element that shows `value` for `id` (a deal id): the preset's class only
 * when this mounted instance saw the value change, the change got a slot, and motion is not calm.
 * Put `key={value}` on that element too, so a second change restarts the gesture.
 * `id` null or undefined: never plays (a value without an identity cannot be told apart from a reuse).
 */
export function useChangeMotion(id: string | null | undefined, value: string | number | boolean | null | undefined, preset: PresetName = 'changed'): string {
  const own = useRef<{ key: string; shown: string; played: string | null } | null>(null);
  if (id === null || id === undefined) return '';
  const key = `${preset}:${id}`;
  const v = String(value);
  const seen = values.get(key);
  if (!seen) values.set(key, { value: v, play: false });
  else if (seen.value !== v) values.set(key, { value: v, play: !isCalm() && takeMotion() });
  const mine = own.current;
  if (!mine || mine.key !== key) {
    // First render of this instance (a mount, a windowed row back in view) or a reused instance
    // now showing another deal: the value is shown as it is.
    own.current = { key, shown: v, played: null };
    return '';
  }
  if (mine.shown !== v) {
    mine.shown = v;
    mine.played = values.get(key)?.play ? v : null;
  }
  return mine.played === v ? PRESETS[preset].className : '';
}

/** Rows a list draws while some leave: the leaving rows stay in their old places for one beat. */
export type RowMotion<T> = {
  rows: readonly T[];
  /** The class a row wears this render ('mo-arrived', 'mo-left' or ''). */
  cls: (key: string) => string;
  /** The row is leaving: draw it, but inert and hidden from assistive technology. */
  leaving: (key: string) => boolean;
};

/** How long after it joined a row still wears its arrival (a re-render inside the gesture keeps it). */
const ARRIVAL_MS = DUR.med + DUR.instant;

type Ghost<T> = { row: T; index: number; key: string };

/** The same rows in the same order (a list rebuilt with equal content is no change). */
function sameKeys<T>(a: readonly T[], b: readonly T[], getKey: (row: T) => string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (getKey(a[i] as T) !== getKey(b[i] as T)) return false;
  return true;
}

/**
 * Row arrival and departure for one list surface. `source` is every row the surface knows (before a
 * filter or a search), `shown` what it draws now. A row arrives when its key is new to `source` after
 * the surface's first render (a seen-set that only grows, so a row never arrives twice, and a filter,
 * a search, a page or a scroll never counts as arriving). A row leaves when it was drawn and is gone
 * from `source` (filtered rows just disappear). More than a handful at once, or calm: no motion.
 */
export function useRowMotion<T>(source: readonly T[], shown: readonly T[], getKey: (row: T) => string): RowMotion<T> {
  const mem = useRef<{ source: readonly T[] | null; known: Set<string>; fresh: Map<string, number>; now: Set<string> }>({ source: null, known: new Set(), fresh: new Map(), now: new Set() });
  const m = mem.current;
  if (m.source !== source) {
    // The first rows the surface sees are its baseline, also when they come after an empty first
    // render (a read still loading): data arriving is not a row joining.
    const first = m.source === null || m.known.size === 0;
    const nowKeys = new Set<string>();
    const added: string[] = [];
    for (const r of source) {
      const k = getKey(r);
      nowKeys.add(k);
      if (!m.known.has(k)) { m.known.add(k); if (!first) added.push(k); }
    }
    m.source = source;
    m.now = nowKeys;
    const t = clockNow();
    for (const [k, at] of m.fresh) if (t - at >= ARRIVAL_MS) m.fresh.delete(k);
    if (added.length && added.length <= MOTION_CAP && !isCalm() && motionRoom(t) >= added.length) {
      for (const k of added) if (takeMotion(t)) m.fresh.set(k, t);
    }
  }

  // Leaving rows: kept for one beat in the places they were drawn at.
  const [st, setSt] = useState<{ prev: readonly T[]; ghosts: Ghost<T>[] }>({ prev: shown, ghosts: [] });
  let ghosts = st.ghosts;
  if (st.prev !== shown && !sameKeys(st.prev, shown, getKey)) {
    const still = new Set<string>();
    for (const r of shown) still.add(getKey(r));
    const gone: Ghost<T>[] = [];
    let kept = 0;
    st.prev.forEach((row, index) => {
      const key = getKey(row);
      if (still.has(key)) kept += 1;
      else if (!m.now.has(key)) gone.push({ row, index, key });
    });
    // Only inside one continuous view: when no drawn row stays (another page, a new list), the old
    // rows are simply replaced.
    ghosts = kept > 0 && gone.length && gone.length <= MOTION_CAP && !isCalm() && motionRoom() >= gone.length && gone.every(() => takeMotion()) ? gone : [];
    setSt({ prev: shown, ghosts });
  }
  useEffect(() => {
    if (!st.ghosts.length) return;
    const t = setTimeout(() => setSt((s) => (s.ghosts.length ? { prev: s.prev, ghosts: [] } : s)), DUR.med);
    return () => clearTimeout(t);
  }, [st.ghosts]);

  let rows: readonly T[] = shown;
  const leavingKeys = new Set<string>();
  if (ghosts.length) {
    const out = [...shown];
    for (const g of ghosts) { out.splice(Math.min(g.index, out.length), 0, g.row); leavingKeys.add(g.key); }
    rows = out;
  }
  const t = clockNow();
  return {
    rows,
    leaving: (key) => leavingKeys.has(key),
    cls: (key) => {
      if (leavingKeys.has(key)) return PRESETS.left.className;
      const at = m.fresh.get(key);
      return at !== undefined && t - at < ARRIVAL_MS ? PRESETS.arrived.className : '';
    },
  };
}

// The onboarding tour as data: a few stops per window (main, tumbler, approval), each pointing at
// an element that is already on screen (its `data-tour` anchor) with a title and a sentence or two
// from words.ts. The tour only points: it never clicks, signs, saves or pays.
//
// Pure: the window, the getting-started facts, the saved progress and which anchors are on screen
// go in; the stop to show, "n of N" and where Next and Back go come out. A stop whose anchor is
// missing is passed over, never waited on. The tour starts by itself only on first run, and a
// finished or skipped tour stays closed until the owner reopens it ("Take the tour").
//
// Progress is kept per window in localStorage under one key (`table-tour`; the `?first_run=1`
// preview uses its own, lib/preview.ts). Storage can be missing or throw (private mode, blocked
// site data, previews), so every access is guarded like lib/theme.ts, and the tour still works
// for the session from memory.
import type { GettingStarted } from './firstRun';
import { firstRunPreview, worldKeys } from './preview';
import { TOUR_STOP, type TourStopId } from './words';

export type TourWindow = 'main' | 'tumbler' | 'approval';
export type TourStop = { id: TourStopId; window: TourWindow; anchor: string; words: { title: string; text: string } };

const stop = (id: TourStopId, window: TourWindow, anchor: string): TourStop => ({ id, window, anchor, words: TOUR_STOP[id] });

/** Every stop, in the order each window walks them. Anchors are `data-tour` values. */
export const TOUR_STOPS: readonly TourStop[] = [
  stop('main.hub', 'main', 'start-hub'),
  stop('main.promise', 'main', 'safety-promise'),
  stop('main.steps', 'main', 'start-steps'),
  stop('main.engine', 'main', 'step-engine'),
  stop('main.approval', 'main', 'approval-way'),
  stop('tumbler.what', 'tumbler', 'tumbler-welcome'),
  stop('tumbler.needs', 'tumbler', 'tumbler-steps'),
  stop('tumbler.engine', 'tumbler', 'step-engine'),
  stop('tumbler.waiting', 'tumbler', 'tumbler-promise'),
  stop('approval.only', 'approval', 'approval-answer'),
  stop('approval.steps', 'approval', 'start-steps'),
  stop('approval.engine', 'approval', 'step-engine'),
  stop('approval.config', 'approval', 'owner-config'),
];

/** The stops about the agent app: shown only while that step is not done. */
const ENGINE_STOPS: ReadonlySet<TourStopId> = new Set(['main.engine', 'tumbler.engine', 'approval.engine']);

/** This window's stops from the getting-started facts: the agent app stop drops out once an app is chosen. */
export function tourStops(win: TourWindow, gs: GettingStarted | null): readonly TourStop[] {
  const engineDone = gs?.steps.find((s) => s.key === 'engine')?.state === 'done';
  return TOUR_STOPS.filter((s) => s.window === win && !(engineDone && ENGINE_STOPS.has(s.id)));
}

/** new: never shown here · active: on a stop · skipped / finished: closed until reopened. */
export type TourStatus = 'new' | 'active' | 'skipped' | 'finished';
export type TourProgress = { status: TourStatus; at: TourStopId | null };
export const TOUR_NEW: TourProgress = { status: 'new', at: null };

export type TourView = {
  stop: TourStop;
  /** 1-based, among the stops whose anchors are on screen. */
  n: number;
  total: number;
  back: TourStopId | null;
  /** null on the last stop: Next reads Finish there. */
  next: TourStopId | null;
};

/**
 * The stop to show now, or null. `firstRun` (the getting-started path is showing) starts a new
 * tour; `present` says whether an anchor is on screen. When the saved stop's anchor is gone, the
 * next present stop in the window's order is shown (or the last present one), so the tour never
 * sticks on something that is not there.
 */
export function tourView(stops: readonly TourStop[], p: TourProgress, firstRun: boolean, present: (anchor: string) => boolean): TourView | null {
  if (p.status === 'skipped' || p.status === 'finished') return null;
  if (p.status === 'new' && !firstRun) return null;
  const shown = stops.filter((s) => present(s.anchor));
  if (!shown.length) return null;
  const at = p.status === 'active' && p.at ? stops.findIndex((s) => s.id === p.at) : 0;
  const from = at < 0 ? 0 : at;
  const current = shown.find((s) => stops.indexOf(s) >= from) ?? shown[shown.length - 1]!;
  const i = shown.indexOf(current);
  return { stop: current, n: i + 1, total: shown.length, back: shown[i - 1]?.id ?? null, next: shown[i + 1]?.id ?? null };
}

/** Next or Back: stand on that stop. */
export const tourMove = (to: TourStopId): TourProgress => ({ status: 'active', at: to });
/** Skip (Esc) or Finish: closed, and it stays closed. */
export const tourEnd = (how: 'skipped' | 'finished'): TourProgress => ({ status: how, at: null });
/** "Take the tour": back to this window's first stop, whatever happened before. */
export const tourReopen = (stops: readonly TourStop[]): TourProgress => ({ status: 'active', at: stops[0]?.id ?? null });

// ---- saved progress -----------------------------------------------------------------------------

export const TOUR_KEY = 'table-tour';
type Saved = Partial<Record<TourWindow, TourProgress>>;

/** The key for this page's world: the `?first_run=1` preview keeps its own progress. */
export function tourKey(preview: boolean = firstRunPreview()): string {
  return worldKeys(TOUR_KEY, TOUR_KEY, preview).store;
}

// What this session saved, by key: the fallback when storage is missing or throws.
const memory = new Map<string, Saved>();

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const STATUSES: readonly TourStatus[] = ['new', 'active', 'skipped', 'finished'];
const isStopId = (v: unknown): v is TourStopId => typeof v === 'string' && v in TOUR_STOP;

function parse(raw: string | null | undefined): Saved | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    const out: Saved = {};
    for (const w of ['main', 'tumbler', 'approval'] as const) {
      const p = (v as Record<string, unknown>)[w] as { status?: unknown; at?: unknown } | undefined;
      if (p && STATUSES.includes(p.status as TourStatus)) out[w] = { status: p.status as TourStatus, at: isStopId(p.at) ? p.at : null };
    }
    return out;
  } catch {
    return null;
  }
}

function readStored(key: string): Saved | null {
  try {
    return parse(storage()?.getItem(key));
  } catch {
    return null;
  }
}

/** This window's saved progress (new when nothing valid is saved). What this page saved in this
 *  session wins, so a write storage refused is not undone by an older stored value. */
export function loadTour(win: TourWindow, key: string = tourKey()): TourProgress {
  return memory.get(key)?.[win] ?? readStored(key)?.[win] ?? TOUR_NEW;
}

/** Saves this window's progress: in memory always, in storage when it can (other windows' progress kept). */
export function saveTour(win: TourWindow, p: TourProgress, key: string = tourKey()): void {
  const mine = { ...memory.get(key), [win]: p };
  memory.set(key, mine);
  const all = { ...readStored(key), ...mine };
  try {
    storage()?.setItem(key, JSON.stringify(all));
  } catch {
    // Storage blocked: the tour still works for this session.
  }
}

/** Tests only: forget what this session saved. */
export function resetTourMemory(): void {
  memory.clear();
}

// TOUR plan, pure: the stops in order, which of them apply now, and the saved progress.
//   mark  a coach mark over one Stage region (status -> need -> side switcher -> side list -> ask)
//   page  a setup step as a Stage item page in the main column (host.setMain)
//   after the mark that follows a finished page: what changed and where it now lives
// A page applies while its step is not done; an after-mark only once its page was visited and the
// step is done (so a step done elsewhere is passed over quietly, never celebrated twice).
import type { GettingStarted } from '../../../../../../lib/firstRun';
import { START_ORDER } from '../../../../../../lib/firstRun';
import type { StartStepKey } from '../../../../../../lib/words';
import type { SimRegion } from '../host';

export type MarkRegion = Extract<SimRegion, 'status' | 'need' | 'side-switcher' | 'side-list' | 'ask'>;
export const MARK_ORDER: readonly MarkRegion[] = ['status', 'need', 'side-switcher', 'side-list', 'ask'];

export type Stop =
  | { kind: 'mark'; id: string; region: MarkRegion }
  | { kind: 'page'; id: string; step: StartStepKey }
  | { kind: 'after'; id: string; step: StartStepKey; region: MarkRegion };

/** Where each finished step's mark points (practice also switches the side list to Tables). */
export const AFTER_REGION: Record<StartStepKey, MarkRegion> = { paypal: 'need', rules: 'status', practice: 'side-list', engine: 'ask' };

export const STOPS: readonly Stop[] = [
  ...MARK_ORDER.map((region): Stop => ({ kind: 'mark', id: region, region })),
  ...START_ORDER.flatMap((step): Stop[] => [
    { kind: 'page', id: `page:${step}`, step },
    { kind: 'after', id: `after:${step}`, step, region: AFTER_REGION[step] },
  ]),
];

export const stopIndex = (id: string | null | undefined): number => (id ? STOPS.findIndex((s) => s.id === id) : -1);

const stepDone = (gs: GettingStarted, k: StartStepKey): boolean => gs.steps.find((s) => s.key === k)?.state === 'done';

/** Whether a stop is shown now. `present` says whether a mark's region is on screen. */
export function applies(s: Stop, gs: GettingStarted, visited: ReadonlySet<StartStepKey>, present: (r: MarkRegion) => boolean): boolean {
  if (s.kind === 'mark') return present(s.region);
  if (s.kind === 'page') return !stepDone(gs, s.step);
  // An after-mark does not wait on its region: Stage brings it back from under the page a moment later.
  return visited.has(s.step) && stepDone(gs, s.step);
}

/** The next applicable stop from index `from` (inclusive) in direction `dir`; -1 past either end. */
export function seek(from: number, dir: 1 | -1, gs: GettingStarted, visited: ReadonlySet<StartStepKey>, present: (r: MarkRegion) => boolean): number {
  for (let i = from; i >= 0 && i < STOPS.length; i += dir) {
    const s = STOPS[i]!;
    // Back never lands on an after-mark (it is a moment, not a place) nor on a done page.
    if (dir === -1 && s.kind === 'after') continue;
    if (applies(s, gs, visited, present)) return i;
  }
  return -1;
}

/** "n of N" among the intro marks on screen (the after-marks and pages count setup instead). */
export function markCount(region: MarkRegion, present: (r: MarkRegion) => boolean): { n: number; total: number } {
  const shown = MARK_ORDER.filter(present);
  return { n: Math.max(1, shown.indexOf(region) + 1), total: shown.length };
}

/** The first page still to do after index `i` (for "Next: step 2 · Rules" on a mark's button). */
export function nextPage(i: number, gs: GettingStarted): StartStepKey | null {
  for (let j = i + 1; j < STOPS.length; j += 1) {
    const s = STOPS[j]!;
    if (s.kind === 'page' && !stepDone(gs, s.step)) return s.step;
  }
  return null;
}

// ---- saved progress (localStorage; may be missing or throw: then the tour lives in memory) -----------
/** new: never run · active: on a stop · skipped: paused by the owner · finished: walked to the end. */
export type TourStatus = 'new' | 'active' | 'skipped' | 'finished';
export type Progress = { status: TourStatus; at: string | null; visited: StartStepKey[] };
export const FRESH: Progress = { status: 'new', at: null, visited: [] };

/** Per world: the first-run preview keeps its own (its wallet is a world of its own too). */
export const progressKey = (firstRun: boolean): string => `stage-sim-tour${firstRun ? ':first-run' : ''}`;

export function loadProgress(key: string): Progress {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return FRESH;
    const v = JSON.parse(raw) as Partial<Progress>;
    const status: TourStatus = v.status === 'active' || v.status === 'skipped' || v.status === 'finished' ? v.status : 'new';
    const at = typeof v.at === 'string' && stopIndex(v.at) >= 0 ? v.at : null;
    const visited = Array.isArray(v.visited) ? v.visited.filter((k): k is StartStepKey => (START_ORDER as readonly string[]).includes(k)) : [];
    return { status, at, visited };
  } catch {
    return FRESH;
  }
}

export function saveProgress(key: string, p: Progress): void {
  try { localStorage.setItem(key, JSON.stringify(p)); } catch { /* blocked storage: the session keeps it */ }
}

/** Prototype-only `?st_at=<stop id>`: open the tour on a stop (screenshots, tests). */
export function stopFromSearch(search: string): string | null {
  try {
    const v = new URLSearchParams(search).get('st_at');
    return v && stopIndex(v) >= 0 ? v : null;
  } catch {
    return null;
  }
}

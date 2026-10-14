// The browser preview's worlds: `?first_run=1` opens a brand-new wallet in a world of its own, so
// anything a window stores (the mock's state, the tour's progress) gets its own key there and the
// sample week stays untouched. Dependency-free, so a window can ask without loading the mock
// (src/mock/firstRun.ts re-exports these for the mock backend).

export const FIRST_RUN_PARAM = 'first_run';

/** True when this page was opened as a first-run preview (`?first_run=1`). */
export function firstRunPreview(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  try {
    return new URLSearchParams(search).get(FIRST_RUN_PARAM) === '1';
  } catch {
    return false;
  }
}

// `?scale=small|large` opens the same sample wallet at two realistic sizes (src/mock/scale.ts):
// a one-person shop, or a busy merchant. Like first_run it is a world of its own (own storage key
// and broadcast channel), so the default sample week stays untouched. A brand-new wallet
// (`first_run=1`) has no data to scale, so it wins when both are given.

export const SCALE_PARAM = 'scale';
export type ScaleName = 'small' | 'large';

/** The scale this page was opened at (`?scale=small|large`), or null: the default sample week. */
export function scalePreview(search: string = typeof location === 'undefined' ? '' : location.search): ScaleName | null {
  try {
    const q = new URLSearchParams(search);
    if (q.get(FIRST_RUN_PARAM) === '1') return null;
    const v = q.get(SCALE_PARAM);
    return v === 'small' || v === 'large' ? v : null;
  } catch {
    return null;
  }
}

/** The storage key and broadcast channel of the world a page belongs to. */
export function worldKeys(store: string, channel: string, firstRun: boolean, scale: ScaleName | null = null): { store: string; channel: string } {
  if (firstRun) return { store: `${store}:first-run`, channel: `${channel}:first-run` };
  return scale ? { store: `${store}:scale-${scale}`, channel: `${channel}:scale-${scale}` } : { store, channel };
}

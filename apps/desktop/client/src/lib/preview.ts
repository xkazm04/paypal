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

/** The storage key and broadcast channel of the world a page belongs to. */
export function worldKeys(store: string, channel: string, firstRun: boolean): { store: string; channel: string } {
  return firstRun ? { store: `${store}:first-run`, channel: `${channel}:first-run` } : { store, channel };
}

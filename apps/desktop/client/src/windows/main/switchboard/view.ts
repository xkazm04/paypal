// Which view of the main window is showing: the board (the default home, spark the-proof-table) or
// the console. The rule, first match wins:
//   1. the address: `?view=board|console`;
//   2. a deep link into the console: a hash the console's router reads as anything but its home
//      (logic.ts parseHash: `#d=` a deal, `#r=rewind`, `#m=` a module, `#p=` a place, `#s=setup`,
//      `#w=waiting`, an old sheet link), so every link the Tumbler, the director and older builds
//      wrote still lands where it did;
//   3. the remembered choice (localStorage `table-home-view`);
//   4. the board.
// Switching remembers the choice and, when the address names a view, keeps the address truthful. One
// tiny store so the console's top-bar button and the App read the same value without remounting the
// providers. Storage is always wrapped: a private window or blocked storage just means the choice is
// not remembered.
import { useSyncExternalStore } from 'react';
import { parseHash } from '../logic';

export type HomeView = 'board' | 'console';
export const VIEW_KEY = 'table-home-view';

const isView = (v: unknown): v is HomeView => v === 'board' || v === 'console';

function fromAddress(): HomeView | null {
  try {
    const v = new URLSearchParams(window.location.search).get('view');
    return isView(v) ? v : null;
  } catch {
    return null;
  }
}

function fromStorage(): HomeView | null {
  try {
    const v = window.localStorage.getItem(VIEW_KEY);
    return isView(v) ? v : null;
  } catch {
    return null;
  }
}

/** The console when the hash is a deep link into it (any route but its home), else null. */
function fromConsoleLink(): HomeView | null {
  try {
    const h = window.location.hash;
    return h && h !== '#' && parseHash(h).route.level !== 'home' ? 'console' : null;
  } catch {
    return null;
  }
}

/** The view to open on right now: the address, a console deep link, the remembered choice, the board. */
export function initialView(): HomeView {
  return fromAddress() ?? fromConsoleLink() ?? fromStorage() ?? 'board';
}

let current: HomeView | null = null;
const subs = new Set<() => void>();

const read = (): HomeView => (current ??= initialView());

/** Switches the view, remembers it, and rewrites `?view=` in the address if it was there. */
export function setHomeView(v: HomeView): void {
  current = v;
  try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* not remembered */ }
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.has('view')) {
      u.searchParams.set('view', v);
      window.history.replaceState(window.history.state, '', u);
    }
  } catch { /* the address stays as it is */ }
  subs.forEach((f) => f());
}

/** Test seam: forget the in-memory choice so the next read starts from the address and storage again. */
export function resetHomeView(): void {
  current = null;
  subs.forEach((f) => f());
}

export function useHomeView(): HomeView {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, read, read);
}

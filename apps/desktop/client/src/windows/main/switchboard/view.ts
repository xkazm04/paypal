// Which view of the main window is showing: the console (default) or the board. The address
// (`?view=board|console`) wins, then the remembered choice (localStorage `table-home-view`), then the
// console. Switching remembers the choice and, when the address names a view, keeps the address
// truthful. One tiny store so the console's top-bar button and the App read the same value without
// remounting the providers. Storage is always wrapped: a private window or blocked storage just
// means the choice is not remembered.
import { useSyncExternalStore } from 'react';

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

/** The view to open on right now: address, then remembered choice, then the console. */
export function initialView(): HomeView {
  return fromAddress() ?? fromStorage() ?? 'console';
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

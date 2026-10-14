// Nested module pages: which detail view a module is showing, how it opens one, and what each
// view is called in the crumbs. A module file registers its views once at load:
//
//   registerViewLabels('book', { ledger: 'Ledger', outlook: 'Outlook' });
//
// and its components call `useModuleRoute()`: `view` is the open detail view (null = the summary,
// also for a key that was never registered), `open('ledger', 'ledger')` opens it (the second
// argument is the SummaryCard `id` to give focus back to), `open(null)` goes back to the summary.
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Module } from '@bindings/Module';

export type ViewLabels = Readonly<Record<string, string>>;

const labels = new Map<Module, ViewLabels>();
const listeners = new Set<() => void>();
let version = 0;

/** Register (or extend) a module's detail views: key (the `v=` in the hash) -> crumb label. */
export function registerViewLabels(module: Module, add: ViewLabels): void {
  labels.set(module, { ...(labels.get(module) ?? {}), ...add });
  version += 1;
  listeners.forEach((l) => l());
}

/** The crumb label of a registered view, else null (unknown views show the summary). */
export function viewLabel(module: Module, view: string | null | undefined): string | null {
  if (!view) return null;
  const l = labels.get(module);
  return l && Object.hasOwn(l, view) ? (l[view] ?? null) : null;
}

/** Same, re-rendering once a lazily loaded module registers its views. */
export function useViewLabel(module: Module, view: string | null | undefined): string | null {
  useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => version, () => version);
  return viewLabel(module, view);
}

export type ModuleRoute = {
  /** The open detail view, or null on the summary page. */
  view: string | null;
  /** Open a detail view (`cardId` = the SummaryCard to refocus on return), or null for the summary. */
  open: (view: string | null, cardId?: string) => void;
};

const NONE: ModuleRoute = { view: null, open: () => {} };
export const ModuleRouteContext = createContext<ModuleRoute>(NONE);

export function useModuleRoute(): ModuleRoute {
  return useContext(ModuleRouteContext);
}

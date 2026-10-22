// Small building blocks the Main window's layers still share: the module colour, the lock glyph,
// the counterparty lookup, the calm loading line and the toast re-export. The pre-v2 rows, chips
// and confirm that lived here went with the old module pages (rebuild WP4a); new parts use
// src/shared/ui. Styles: legacy.css (only the rules something still draws).
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import type { Module } from '@bindings/Module';
import { useCounterparties } from '../../lib/display';
import { COUNTERPARTY_PROVIDER_MISSING, MAIN_LOADING } from '../../lib/words';
import { MODULE } from '../../shared/modules';
import './legacy.css';

/** Module colour as --mc (theme-aware token, tokens.css --m-<key>). */
export const mc = (m: Module): CSSProperties => ({ '--mc': MODULE[m].cssVar } as CSSProperties);

// Static, trusted markup only - never data (it is set as innerHTML of the glyph's svg).
const LOCK_CLOSED = '<rect x="3" y="7" width="10" height="7.5" rx="1.6" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/>';
const LOCK_OPEN = '<rect x="3" y="7" width="10" height="7.5" rx="1.6" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 5.8-1.1" fill="none" stroke="currentColor" stroke-width="1.6"/>';

export function LockGlyph({ locked }: { locked: boolean }) {
  return <svg className="lockg" viewBox="0 0 16 16" aria-hidden={true} dangerouslySetInnerHTML={{ __html: locked ? LOCK_CLOSED : LOCK_OPEN }} />;
}

// ---- counterparties (counterparty_list, short key id if the read fails) -----------------------------

const CpCtx = createContext<ReturnType<typeof useCounterparties> | null>(null);
export function CounterpartyProvider({ children }: { children: ReactNode }) {
  const cp = useCounterparties();
  return <CpCtx.Provider value={cp}>{children}</CpCtx.Provider>;
}
export function useCpLookup() {
  const c = useContext(CpCtx);
  if (!c) throw new Error(COUNTERPARTY_PROVIDER_MISSING);
  return c;
}

// ---- toasts (moved to src/shared/ui/toast.tsx; re-exported so old imports keep working) --------

export { ToastProvider, useToast } from '../../shared/ui/toast';

export function Loading({ what }: { what: string }) {
  return <div className="loading" role="status"><span className="spin" aria-hidden="true" />{MAIN_LOADING(what)}</div>;
}

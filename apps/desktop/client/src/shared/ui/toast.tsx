// Toasts, shared by every window. One provider per window; useToast() returns push(node, tone).
// Toast text is our own strings; dynamic parts go in as React children (escaped), never as HTML.
// windows/main/ui.tsx re-exports ToastProvider / useToast so the old import paths keep working.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export type ToastTone = 'ok' | 'info' | 'bad' | 'gold';
type Toast = { id: number; node: ReactNode; tone: ToastTone };
export type PushToast = (node: ReactNode, tone?: ToastTone) => void;

const ToastCtx = createContext<PushToast>(() => {});
export const useToast = (): PushToast => useContext(ToastCtx);

export const TOAST_MS = 5200;
/** A refusal or a failure stays longer: it is the one toast a person must be able to finish reading. */
export const TOAST_BAD_MS = 9000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback<PushToast>((node, tone = 'info') => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, node, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? TOAST_BAD_MS : TOAST_MS);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="ui-toasts" role="status" aria-live="polite" data-layer-free="">
        {toasts.map((t) => <div key={t.id} className={`ui-toast ${t.tone === 'info' ? '' : t.tone}`}>{t.node}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

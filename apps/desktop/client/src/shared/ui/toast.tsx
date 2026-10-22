// Toasts, shared by every window. One provider per window; useToast() returns push(node, tone).
// Toast text is our own strings; dynamic parts go in as React children (escaped), never as HTML.
// windows/main/ui.tsx re-exports ToastProvider / useToast so the old import paths keep working.
// Each toast owns its dwell timer (cleared when it goes or its window does). Hover or focus on a
// toast pauses the clock; leaving gives a fresh dwell, because the person is reading it again.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type ToastTone = 'ok' | 'info' | 'bad' | 'gold';
type Toast = { id: number; node: ReactNode; tone: ToastTone };
export type PushToast = (node: ReactNode, tone?: ToastTone) => void;

const ToastCtx = createContext<PushToast>(() => {});
export const useToast = (): PushToast => useContext(ToastCtx);

export const TOAST_MS = 5200;
/** A refusal or a failure stays longer: it is the one toast a person must be able to finish reading. */
export const TOAST_BAD_MS = 9000;

function ToastItem({ toast, onDone }: { toast: Toast; onDone: (id: number) => void }) {
  const [held, setHeld] = useState(false);
  const { id, tone } = toast;
  useEffect(() => {
    if (held) return;
    const t = setTimeout(() => onDone(id), tone === 'bad' ? TOAST_BAD_MS : TOAST_MS);
    return () => clearTimeout(t);
  }, [held, id, tone, onDone]);
  const hold = () => setHeld(true);
  const free = () => setHeld(false);
  return (
    <div className={`ui-toast ${tone === 'info' ? '' : tone}`} onMouseEnter={hold} onMouseLeave={free} onFocus={hold} onBlur={free}>
      {toast.node}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback<PushToast>((node, tone = 'info') => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, node, tone }]);
  }, []);
  const done = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="ui-toasts" role="status" aria-live="polite" data-layer-free="">
        {toasts.map((t) => <ToastItem key={t.id} toast={t} onDone={done} />)}
      </div>
    </ToastCtx.Provider>
  );
}

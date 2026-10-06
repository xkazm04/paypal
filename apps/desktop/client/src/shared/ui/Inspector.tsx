// Layer 2 · Inspector: the right-hand detail column of a `ui-split` (`has-insp`).
//
// Inside the main window's module Shell, an <Inspector> anywhere in the page content is portalled
// into the Shell's own inspector column, so it sits flush right at full height like the prototype,
// and the Shell's split gets `has-insp` while it is mounted. Mount it to open, unmount to close.
// Outside a host (no InspectorHost provider) it renders in place; wrap it in <Split> yourself.
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLayer } from './layers';

type HostCtx = { el: HTMLElement | null; claim: () => () => void };
const InspectorHostCtx = createContext<HostCtx | null>(null);
export const InspectorHostProvider = InspectorHostCtx.Provider;

/** For a frame that owns an inspector column (the Shell): returns the ref for the column, whether
 *  any Inspector is mounted, and the provider value. */
export function useInspectorHost(): { ref: (el: HTMLElement | null) => void; open: boolean; value: HostCtx } {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => {
    setClaims((n) => n + 1);
    return () => setClaims((n) => Math.max(0, n - 1));
  }, []);
  const value = useMemo(() => ({ el, claim }), [el, claim]);
  return { ref: setEl, open: claims > 0, value };
}

export type InspectorProps = {
  /** Heading of the inspector (h2). */
  title?: ReactNode;
  /** Given: shows a ✕ and registers as a layer, so Esc closes the inspector before anything else. */
  onClose?: () => void;
  /** Small line under the title (ids, counterparty). */
  sub?: ReactNode;
  /** Accessible name of the column when there is no title. */
  label?: string;
  children?: ReactNode;
};

export function Inspector({ title, onClose, sub, label, children }: InspectorProps) {
  const host = useContext(InspectorHostCtx);
  const id = useId();
  const noop = useRef(() => {});
  useLayer(onClose ?? noop.current, 'inspector', !!onClose);
  const claim = host?.claim;
  useEffect(() => (claim ? claim() : undefined), [claim]);

  const body = (
    <div className="ui-inspector-body" role="region" aria-labelledby={title ? `${id}-h` : undefined} aria-label={title ? undefined : label ?? 'Details'}>
      {title || onClose ? (
        <div className="ui-inspector-h">
          {title ? <h2 id={`${id}-h`}>{title}</h2> : <span className="ui-spacer" />}
          {onClose ? <button type="button" className="ui-btn plain icon sm" aria-label="Close details" title="Close (Esc)" onClick={onClose}>✕</button> : null}
        </div>
      ) : null}
      {sub ? <div className="ui-hint">{sub}</div> : null}
      {children}
    </div>
  );
  if (host?.el) return createPortal(body, host.el);
  if (host) return null; // host column not attached yet; the next render portals
  return <aside className="ui-inspector">{body}</aside>;
}

/** A standalone split: optional sidebar, the content, and an optional inspector column. */
export function Split({ sidebar, inspector, children, className }: { sidebar?: ReactNode; inspector?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`ui-split ${sidebar ? '' : 'no-side'} ${inspector ? 'has-insp' : ''} ${className ?? ''}`}>
      {sidebar}
      {children}
      {inspector}
    </div>
  );
}

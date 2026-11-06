// spark abstract-first-home round 4: the approval window in bare mode (protocol.ts): the same
// session and toasts as App.tsx, then only the one form. No header, badges, demo strip, coach tour,
// graticule or way back: the host page owns the frame around it. The body is transparent when the
// page is framed (it sits on the host's surface) and has the app's ground when it is its own window.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { HOLD_MS } from '../../../design/motion';
import { backend } from '../../../lib/runtime';
import { ToastProvider } from '../../../shared/ui';
import { SessionProvider } from '../session';
import { closeThisWindow } from '../ui';
import { bareHeadless, isFramed, postToHost, SELF_EVENT, type BareKind, type BareMessage } from './protocol';
import { BARE_SHEET } from './words';
import { BareKeys } from './BareKeys';
import { BarePairing } from './BarePairing';
import { BareRules } from './BareRules';
import './bare.css';

export function BareApp({ kind }: { kind: BareKind }) {
  useLayoutEffect(() => {
    document.body.classList.add('w-bare');
    document.body.classList.toggle('w-bare-top', !isFramed());
    document.body.classList.toggle('w-bare-nohead', bareHeadless());
    return () => document.body.classList.remove('w-bare', 'w-bare-top', 'w-bare-nohead');
  }, []);
  return (
    <SessionProvider>
      <ToastProvider>
        <BareRoot kind={kind} />
      </ToastProvider>
    </SessionProvider>
  );
}

function BareRoot({ kind }: { kind: BareKind }) {
  const root = useRef<HTMLDivElement>(null);
  // Tell the host how tall the form is, now and whenever it changes (a field's hint, the editor).
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let last = -1;
    const report = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h === last) return;
      last = h;
      postToHost({ type: 'secure-size', height: h });
    };
    report();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Esc: she wants out. The host decides what that means (the sheet closes; inline ignores it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) postToHost({ type: 'secure-cancel' }); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // The desktop sheet window (its own frameless window, nobody to tell): done closes it after the
  // form's own success shows for a moment; Esc or the close button closes it at once. The Table
  // reads the wallet, never this page, for "done".
  const own = !isFramed() && sheetWindow();
  useEffect(() => {
    if (!own) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      const m = (e as CustomEvent<BareMessage>).detail;
      if (m.type === 'secure-cancel') void closeThisWindow();
      if (m.type === 'secure-done') { clearTimeout(t); t = setTimeout(() => void closeThisWindow(), HOLD_MS); }
    };
    window.addEventListener(SELF_EVENT, on);
    return () => { window.removeEventListener(SELF_EVENT, on); clearTimeout(t); };
  }, [own]);
  return (
    <div ref={root} className="sc-bare" data-bare={kind}>
      {own ? (
        <header className="sc-sheetbar" data-sheetbar>
          <span className="sc-sheetlock"><b>{BARE_SHEET.lock}</b> · {BARE_SHEET.where}</span>
          <button type="button" className="ui-btn plain icon" aria-label={BARE_SHEET.close} title={BARE_SHEET.closeEsc} onClick={() => void closeThisWindow()}>✕</button>
        </header>
      ) : null}
      <main>{kind === 'keys' ? <BareKeys /> : kind === 'rules' ? <BareRules /> : <BarePairing />}</main>
    </div>
  );
}

/** This page is the desktop app's sheet window (a real window, not the browser preview). */
function sheetWindow(): boolean {
  try { return backend().kind === 'tauri'; } catch { return false; }
}

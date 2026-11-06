// spark abstract-first-home round 4: the approval window in bare mode (protocol.ts): the same
// session and toasts as App.tsx, then only the one form. No header, badges, demo strip, coach tour,
// graticule or way back: the host page owns the frame around it. The body is transparent when the
// page is framed (it sits on the host's surface) and has the app's ground when it is its own window.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { ToastProvider } from '../../../shared/ui';
import { SessionProvider } from '../session';
import { bareHeadless, isFramed, postToHost, type BareKind } from './protocol';
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
  return (
    <div ref={root} className="sc-bare" data-bare={kind}>
      <main>{kind === 'keys' ? <BareKeys /> : kind === 'rules' ? <BareRules /> : <BarePairing />}</main>
    </div>
  );
}

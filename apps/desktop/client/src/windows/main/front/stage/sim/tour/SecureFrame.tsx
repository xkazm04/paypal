// The secure step, inline: the approval window's REAL page (approval.html) in a frame inside the setup
// page. Browser preview only, and labelled so ("in the app this is its own window").
//
// Why a frame and not approval_open: in the browser preview the main window's approval_open does not
// open a window; lib/runtime.ts demoOpener sends the WHOLE TAB to the sample approval
// (preview.ts openDemoApproval, `approval.html?demo=1`) and back on "Back to The Table" - exactly the
// "every choice leads into a new window" break this sim exists to remove. So the page loads the same
// address the mock's approval_open would open (mock/backend.ts: `approval.html?target=..` /
// `?pairing=..`, plus the world's parameters) into a frame, as the scenario director frames its
// approval window (director/Director.tsx).
//
// Why this is still the real secure step: the framed page boots its own backend with the label
// 'approval' and the approval capability (lib/runtime.ts initBackend('approval')), so set_credentials,
// mandate_sign and the pairing confirm run there with every gate the approval window has (label,
// token, idle lock, selection) and THIS page still cannot call them (mock privileged(): "privileged
// commands run only in the approval window"). Nothing here signs, saves or reads a secret; the
// result reaches this window over the world's BroadcastChannel (settings:changed, pairing:pinned),
// which is what useStart reads. In the desktop app this cannot happen (its CSP has frame-src 'none',
// lib/preview.ts previewPagesAvailable) and the step would be approval_open's own window.
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useCalm } from '../../../../../../design/motion';
import { demoFromSearch, previewSearch, withDemoSearch } from '../../../../../../lib/preview';
import { tx } from './motion';
import { TOUR_W } from './words';

/** The approval page's address for a selection, in this page's world (as mock approval_open builds it). */
export function approvalUrl(selection: { target: 'credentials' | 'mandate' } | { pairing: unknown }): string {
  const q = new URLSearchParams();
  if ('pairing' in selection) { q.set('pairing', JSON.stringify(selection.pairing)); q.set('target', 'pairing'); }
  else q.set('target', selection.target);
  return `approval.html${withDemoSearch(`?${q.toString()}`, demoFromSearch(previewSearch()))}`;
}

export function SecureFrame({ src }: { src: string | null }) {
  const calm = useCalm();
  const box = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setLoaded(false); }, [src]);
  // Once the secure step is up, bring it into view inside the page.
  useEffect(() => { if (loaded) box.current?.scrollIntoView?.({ block: 'start', behavior: calm ? 'auto' : 'smooth' }); }, [loaded, calm]);
  if (!src) return null;
  return (
    <motion.div ref={box} className="st-secure" data-loaded={loaded ? 'true' : 'false'}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={tx('slow', calm, '--ease-out')}>
      <div className="st-secure-h">
        <span className="st-seal" aria-hidden="true" />
        <b>{TOUR_W.secureLabel}</b>
        <span className="st-secure-note">{TOUR_W.secureNote}</span>
      </div>
      <div className="st-secure-body">
        <AnimatePresence initial={false}>
          {!loaded ? (
            <motion.p key="wait" className="st-quiet st-secure-wait" role="status" exit={{ opacity: 0 }} transition={tx('fast', calm)}>{TOUR_W.secureLoading}</motion.p>
          ) : null}
        </AnimatePresence>
        <iframe src={src} title={TOUR_W.secureFrame} className="st-secure-frame" onLoad={() => setLoaded(true)} />
      </div>
      <p className="st-quiet st-secure-why">{TOUR_W.secureWhy}</p>
    </motion.div>
  );
}

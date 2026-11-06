// TOUR round 4, the ONE spotlight mark: a lit ring on where a result now lives (or a region the
// "You're set" pointers name) and one sentence beside it. Just in time and light: no dim over the
// home (the next turn stays readable), no buttons to walk; it leaves by itself after SPOT_MS, on any
// key or click, or when another mark replaces it. Non-modal: the ring and the mark never take a click.
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCalm } from '../../../../../../design/motion';
import { keepClearBoxes, placeMark, ringBox } from '../../../../../../shared/tour';
import { tr } from '../../fx';
import type { StageHost } from '../host';
import { spotOff, useFlow, type SpotTarget } from './flow';
import { TOUR_W } from './words';

/** How long a mark stays when nothing dismisses it: long enough to read one sentence twice. */
export const SPOT_MS = 5000;

type Rect = { left: number; top: number; width: number; height: number };

/** The element a mark points at, or null when it is not on screen now. */
export function spotEl(host: StageHost, t: SpotTarget): HTMLElement | null {
  if ('region' in t) return host.region(t.region);
  return host.region('side-switcher')?.querySelector<HTMLElement>(`[data-scope="${t.segment}"]`) ?? null;
}

export function Spot({ host }: { host: StageHost }) {
  const { spot } = useFlow();
  const calm = useCalm();
  const markRef = useRef<HTMLDivElement>(null);
  const [ring, setRing] = useState<Rect | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const hostRef = useRef(host);
  hostRef.current = host;
  const id = spot?.id ?? null;

  // Leaves by itself, or on any key or click (the next thing she does is the next thing).
  useEffect(() => {
    if (id === null) return;
    const t = setTimeout(() => spotOff(id), SPOT_MS);
    // The press that put a mark up (a pointer of the end turn) must not take it down: listen from the next tick.
    let armed = false;
    const arm = setTimeout(() => { armed = true; }, 0);
    const off = (e: Event) => {
      if (!armed) return;
      if (e instanceof KeyboardEvent && (e.key === 'Shift' || e.key === 'Tab')) return;
      spotOff(id);
    };
    window.addEventListener('pointerdown', off, true);
    window.addEventListener('keydown', off, true);
    return () => { clearTimeout(t); clearTimeout(arm); window.removeEventListener('pointerdown', off, true); window.removeEventListener('keydown', off, true); };
  }, [id]);

  useLayoutEffect(() => {
    if (!spot) { setRing(null); setAt(null); return; }
    let raf = 0;
    const measure = () => {
      raf = 0;
      const el = spotEl(hostRef.current, spot.target);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const r = el?.getBoundingClientRect();
      if (!el || !r || r.width === 0 || r.height === 0 || el.closest('[inert], [aria-hidden="true"]')) { setRing(null); return; }
      const box = ringBox({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }, vw, vh, [], 4);
      setRing((o) => (o && o.left === box.left && o.top === box.top && o.width === box.width && o.height === box.height ? o : box));
      const m = markRef.current;
      if (!m) return;
      const next = placeMark({ top: box.top, bottom: box.top + box.height, left: box.left, width: box.width }, m.offsetWidth, m.offsetHeight, vw, vh, keepClearBoxes(m));
      setAt((o) => (o && o.left === next.left && o.top === next.top ? o : next));
    };
    const soon = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    // The mark is measured once it has drawn: place it again on the next frame.
    soon();
    window.addEventListener('resize', soon);
    window.addEventListener('scroll', soon, true);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(soon);
    const root = document.querySelector('[data-front="stage"]');
    if (root) ro?.observe(root);
    return () => { if (raf) cancelAnimationFrame(raf); window.removeEventListener('resize', soon); window.removeEventListener('scroll', soon, true); ro?.disconnect(); };
  }, [spot]);

  if (typeof document === 'undefined') return null;
  const show = spot !== null && ring !== null;
  return createPortal(
    <AnimatePresence>
      {show ? (
        <motion.div key={spot.id} className="st-spotwrap" data-st-overlay="" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tr('med', calm)}>
          <div className="st-ring" aria-hidden="true" style={ring} />
          <motion.div ref={markRef} className="st-mark" role="status" aria-label={TOUR_W.spotLabel} data-spot={spot.id}
            initial={{ y: 4 }} animate={{ y: 0 }} transition={tr('med', calm, 'out')}
            style={at ? { left: at.left, top: at.top } : { left: 8, top: 8, visibility: 'hidden' }}>
            <span className="st-mark-dot" aria-hidden="true" />
            <span>{spot.text}</span>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

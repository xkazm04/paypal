// The onboarding tour on screen (lib/tour.ts holds the stops and the rules): one coach mark next to
// the stop's element, a quiet ring around that element, the stop's words, "n of N", Back, Next
// (Finish on the last stop) and Skip tour. A labelled, non-modal dialog: focus moves into it while
// this window has focus (the Tumbler never takes the keyboard from another app) and goes back to
// where it was afterwards; Esc skips, the arrow keys move between stops. No gold button: the view's
// one gold action stays the view's. The tour only points: it never clicks, signs, saves or pays.
// Placement is CSSOM (React style), which the CSP allows; re-placed on resize and scroll and kept
// inside the viewport at any width.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { GettingStarted } from '../lib/firstRun';
import { loadTour, saveTour, TOUR_STOPS, tourEnd, tourFromStorage, tourKey, tourMove, tourReopen, tourStops, tourView, type TourProgress, type TourWindow } from '../lib/tour';
import { TOUR, tourCount } from '../lib/words';
import { Btn } from './ui';
import { useLayerCount } from './ui/layers';
import './tour.css';

const GAP = 10;
const EDGE = 8;

/** The anchor on screen for a `data-tour` value: the first one not inside a hidden part of the page. */
export function findAnchor(anchor: string, root: ParentNode = document): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`)) {
    if (!el.closest('[aria-hidden="true"], [hidden], [inert]')) return el;
  }
  return null;
}

/** Where the coach mark goes: below the anchor, else above, else at the bottom of the viewport;
 *  always inside it (8 px from each edge). */
export function placeMark(a: { top: number; bottom: number; left: number; width: number }, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  const left = Math.min(Math.max(EDGE, a.left + a.width / 2 - w / 2), Math.max(EDGE, vw - w - EDGE));
  let top: number;
  if (a.bottom + GAP + h <= vh - EDGE) top = a.bottom + GAP;
  else if (a.top - GAP - h >= EDGE) top = a.top - GAP - h;
  else top = vh - h - EDGE;
  return { left, top: Math.max(EDGE, top) };
}

// "Take the tour" anywhere in a window reopens that window's tour.
const reopeners = new Set<(win: TourWindow) => void>();

/** Reopens this window's tour on its first stop (saved, so it survives a reload). */
export function reopenTour(win: TourWindow, gs: GettingStarted | null, key: string = tourKey()): void {
  saveTour(win, tourReopen(tourStops(win, gs)), key);
  for (const r of reopeners) r(win);
}

/** The quiet button the getting-started views carry to walk the tour again. */
export function TakeTour({ win, gs, className }: { win: TourWindow; gs: GettingStarted | null; className?: string }) {
  return <Btn kind="plain" sm className={className} title={TOUR.takeTitle} onClick={(e) => { e.stopPropagation(); reopenTour(win, gs); }}>{TOUR.take}</Btn>;
}

type Box = { ring: { left: number; top: number; width: number; height: number }; mark: { left: number; top: number } };

export function Tour({ win, gs, firstRun, paused = false, storageKey }: {
  win: TourWindow;
  gs: GettingStarted | null;
  /** The getting-started path is showing: a tour never seen here starts by itself. */
  firstRun: boolean;
  /** Something else is in front (the intro): the mark waits. It also waits while any sheet,
   *  popover or confirm is open (the layer stack). */
  paused?: boolean;
  storageKey?: string;
}) {
  const key = useMemo(() => storageKey ?? tourKey(), [storageKey]);
  const [p, setP] = useState<TourProgress>(() => loadTour(win, key));
  // The stops change only when the facts change which stops apply, not on every new facts object.
  const ids = tourStops(win, gs).map((s) => s.id).join(' ');
  const stops = useMemo(() => TOUR_STOPS.filter((s) => ids.split(' ').includes(s.id)), [ids]);

  useEffect(() => {
    const r = (w: TourWindow) => { if (w === win) setP(loadTour(win, key)); };
    reopeners.add(r);
    return () => { reopeners.delete(r); };
  }, [win, key]);

  // Another page wrote this world's tour (the director's First run story points a framed window's
  // mark this way, never by a click): follow it when the write is to this key.
  useEffect(() => {
    const on = (e: StorageEvent) => { const np = tourFromStorage(win, key, e); if (np) setP(np); };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, [win, key]);

  // Which anchors are on screen, kept as a signature so a page change re-renders only when it matters.
  const presentSig = useCallback(() => stops.filter((s) => findAnchor(s.anchor)).map((s) => s.anchor).join(' '), [stops]);
  const [sig, setSig] = useState(presentSig);
  useEffect(() => {
    setSig(presentSig());
    if (typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(() => setSig(presentSig()));
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-tour', 'aria-hidden', 'hidden', 'inert'] });
    return () => mo.disconnect();
  }, [presentSig]);

  const present = useMemo(() => new Set(sig.split(' ').filter(Boolean)), [sig]);
  const covered = useLayerCount() > 0;
  const view = paused || covered ? null : tourView(stops, p, firstRun, (a) => present.has(a));

  const update = useCallback((np: TourProgress) => { saveTour(win, np, key); setP(np); }, [win, key]);
  const goNext = () => { if (!view) return; update(view.next ? tourMove(view.next) : tourEnd('finished')); };
  const goBack = () => { if (view?.back) update(tourMove(view.back)); };
  const skip = () => update(tourEnd('skipped'));

  // Placement: the ring hugs the anchor, the mark sits beside it inside the viewport.
  const markRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const stopId = view?.stop.id ?? null;
  const anchorName = view?.stop.anchor ?? null;
  useLayoutEffect(() => {
    if (!anchorName) { setBox(null); return; }
    const measure = () => {
      const a = findAnchor(anchorName);
      const m = markRef.current;
      if (!a || !m) return;
      const r = a.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pad = 4;
      const ring = {
        left: Math.max(2, r.left - pad), top: Math.max(2, r.top - pad),
        width: Math.max(0, Math.min(vw - 2, r.right + pad) - Math.max(2, r.left - pad)),
        height: Math.max(0, Math.min(vh - 2, r.bottom + pad) - Math.max(2, r.top - pad)),
      };
      setBox({ ring, mark: placeMark(r, m.offsetWidth, m.offsetHeight, vw, vh) });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    // The anchor or the mark changing size (a step ticked, the hub's text) moves it too.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    const a = findAnchor(anchorName);
    if (a) ro?.observe(a);
    if (markRef.current) ro?.observe(markRef.current);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); ro?.disconnect(); };
  }, [anchorName, stopId, sig]);

  // A stop whose element is scrolled away is brought into view once, without animation.
  useEffect(() => {
    if (anchorName) findAnchor(anchorName)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [stopId, anchorName]);

  // Focus: into the mark when it appears (only while this window has focus), back afterwards.
  const returnTo = useRef<HTMLElement | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const open = view !== null;
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    returnTo.current = active instanceof HTMLElement && active !== document.body ? active : null;
    if (document.hasFocus()) nextRef.current?.focus({ preventScroll: true });
    return () => {
      const mark = markRef.current;
      const inside = !document.activeElement || document.activeElement === document.body || (mark?.contains(document.activeElement) ?? false);
      const back = returnTo.current;
      returnTo.current = null;
      if (inside && back?.isConnected) back.focus({ preventScroll: true });
    };
  }, [open]);

  // A new stop is announced: focus moves to the dialog itself, so a screen reader reads its new
  // title and text. Only when focus is already inside the mark (Next, Back, the arrow keys), so a
  // stop that changes by itself never takes focus from the page. Programmatic focus on the
  // container shows no ring; :focus-visible handles the rest.
  const lastStop = useRef<string | null>(null);
  useEffect(() => {
    const prev = lastStop.current;
    lastStop.current = stopId;
    const mark = markRef.current;
    if (prev && stopId && prev !== stopId && mark?.contains(document.activeElement)) mark.focus({ preventScroll: true });
  }, [stopId]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') skip();
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { if (view?.next) update(tourMove(view.next)); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goBack();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const titleId = useId();
  const textId = useId();
  if (!view) return null;
  const w = view.stop.words;
  return createPortal(
    <>
      {box ? <div className="tour-ring" aria-hidden="true" style={box.ring} /> : null}
      <div ref={markRef} className={`tour-mark tour-${win}`} role="dialog" aria-modal="false" aria-labelledby={titleId} aria-describedby={textId} tabIndex={-1}
        data-tour-stop={view.stop.id} onKeyDown={onKeyDown} onClick={(e) => e.stopPropagation()}
        style={box ? box.mark : { left: EDGE, top: EDGE, visibility: 'hidden' }}>
        <div className="tour-head">
          <span className="tour-kick">{TOUR.label} · {tourCount(view.n, view.total)}</span>
          <Btn kind="plain" sm className="tour-skip" onClick={skip}>{TOUR.skip}</Btn>
        </div>
        <h2 id={titleId} className="tour-title">{w.title}</h2>
        <p id={textId} className="tour-text">{w.text}</p>
        <div className="tour-foot">
          {view.back ? <Btn sm onClick={goBack}>{TOUR.back}</Btn> : <span />}
          <Btn ref={nextRef} kind="primary" sm onClick={goNext}>{view.next ? TOUR.next : TOUR.finish}</Btn>
        </div>
      </div>
    </>,
    document.body,
  );
}

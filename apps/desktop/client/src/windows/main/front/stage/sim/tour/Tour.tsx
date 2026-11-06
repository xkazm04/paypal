// spark abstract-first-home round 3, simulated first project "TOUR": a spotlight tour over the real
// Stage home, then the setup steps as Stage item pages, then back to the tour where it left off.
//   1 Coach marks, one region at a time (status -> need -> side switcher -> side list -> ask): the
//     rest of the home is dimmed, the region is lit, a mark beside it says what it is for in one or
//     two sentences, with Back / Next / Skip for now. Enter next, Esc skip, arrows move.
//   2 The setup steps (START_ORDER, only those not done) as item pages in the main column
//     (host.setMain): "Today › Setup › Step 2 of 4 · Rules", the same page pattern as a deal.
//     Privileged steps (keys, rules, the pairing confirm) run in the approval window's real page,
//     framed inline in the browser preview (SecureFrame explains how and why that is honest).
//   3 When the wallet says a step is done (useStart), the page leaves and the tour comes back with a
//     mark on where the result now lives (practice also switches the side list to Tables).
//   4 The end: a "You're set up" turn in the conversation with where to find things again, and the
//     owner is on the ordinary Stage. Skip for now at any point: host.back(), progress kept, and a
//     "Continue setup" turn in the conversation picks the tour up at the same stop.
// The tour itself never acts: every mutation is the page's own control pressed by the owner.
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useCalm } from '../../../../../../design/motion';
import { firstRunPreview } from '../../../../../../lib/preview';
import { START_STEP, type StartStepKey } from '../../../../../../lib/words';
import { keepClearBoxes, placeMark, ringBox } from '../../../../../../shared/tour';
import { Btn, Icon, layerCount } from '../../../../../../shared/ui';
import { useStart } from '../../../../setup/start';
import type { SimProps, StageHost } from '../host';
import { tx } from './motion';
import {
  FRESH, loadProgress, markCount, progressKey, saveProgress, seek, stopFromSearch, stopIndex, STOPS,
  type MarkRegion, type Progress as Saved, type Stop,
} from './plan';
import { Progress, StepPage } from './StepPage';
import { AFTER, MARK, PAGE, TOUR_W } from './words';
import './tour.css';

const typingIn = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
const interactive = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (typingIn(t) || !!t.closest('button, a[href], [role="button"], [role="radio"], summary, label'));

export function TourSim({ host }: SimProps) {
  const gs = useStart();
  const key = useMemo(() => progressKey(firstRunPreview()), []);
  const [p, setP] = useState<Saved>(() => {
    const saved = loadProgress(key);
    const at = typeof location === 'undefined' ? null : stopFromSearch(location.search);
    return at ? { ...saved, status: 'active', at } : saved;
  });
  const gsRef = useRef(gs);
  gsRef.current = gs;
  const pRef = useRef(p);
  pRef.current = p;
  const update = useCallback((np: Saved) => { pRef.current = np; saveProgress(key, np); setP(np); tourStatus.set(np.status); }, [key]);
  useEffect(() => { tourStatus.set(pRef.current.status); }, []);
  const hostRef = useRef<StageHost>(host);
  hostRef.current = host;

  const known = gs.steps.some((s) => s.state !== 'unknown');
  const visited = useMemo(() => new Set(p.visited), [p.visited]);
  // A mark's region counts as there when Stage marked it, even while it is hidden under a page:
  // the conversation stays mounted, so Back from a page to a mark never skips it.
  const present = useCallback((r: MarkRegion) => markEl(hostRef.current, r) !== null, []);

  // ---- start: a new tour starts by itself once Stage has marked its regions and the steps are read
  const [regionsReady, setRegionsReady] = useState(false);
  useEffect(() => {
    if (regionsReady) return;
    const check = () => { if (hostRef.current.region('status')) setRegionsReady(true); };
    check();
    if (typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [regionsReady]);

  // ---- where the tour is: the saved stop, moved forward when it no longer applies (a page whose step
  // the wallet now calls done gives way to its after-mark; past the last stop the tour ends)
  const seekFrom = useCallback((from: number, dir: 1 | -1): number => seek(from, dir, gs, visited, present), [gs, visited, present]);

  const finish = useCallback(() => {
    const h = hostRef.current;
    update({ ...pRef.current, status: 'finished', at: null });
    h.setMain(null);
    h.back();
    const g = gsRef.current;
    h.say({ text: g.done === g.total ? TOUR_W.setUp : TOUR_W.tourDone, card: <DoneCard onRetake={() => apiRef.current.retake()} /> });
  }, [update]);

  const active = p.status === 'active' && regionsReady && known;
  const atIdx = stopIndex(p.at);
  // Normalise: a new tour opens on its first stop; a stop that no longer applies moves on.
  useEffect(() => {
    if (!regionsReady || !known) return;
    if (p.status === 'new') { update({ ...p, status: 'active', at: STOPS[0]!.id }); return; }
    if (p.status !== 'active') return;
    // An intro mark stays put even when its region is not marked yet (Stage adds the setup turn a
    // moment after the first paint): it shows unlit and lights up when the region arrives. Only a
    // page (its step now done) or an after-mark gives way by itself.
    if (atIdx >= 0 && STOPS[atIdx]!.kind === 'mark') return;
    const from = atIdx < 0 ? 0 : atIdx;
    const j = seekFrom(from, 1);
    if (j < 0) { finish(); return; }
    if (j !== atIdx) update({ ...p, at: STOPS[j]!.id });
  }, [regionsReady, known, p, atIdx, seekFrom, update, finish]);

  const stop: Stop | null = active && atIdx >= 0 ? STOPS[atIdx]! : null;
  const backIdx = stop && atIdx > 0 ? seekFrom(atIdx - 1, -1) : -1;
  const nextIdx = stop ? seekFrom(atIdx + 1, 1) : -1;
  // Moves read where to go when pressed: a region Stage marks after this render (the checklist turn)
  // is not passed over because the render that drew the buttons came before it.
  const moveRef = useRef<{ next: () => number; back: () => number }>({ next: () => -1, back: () => -1 });
  moveRef.current = {
    next: () => (atIdx >= 0 ? seekFrom(atIdx + 1, 1) : -1),
    back: () => (atIdx > 0 ? seekFrom(atIdx - 1, -1) : -1),
  };

  const go = useCallback((i: number) => {
    if (i < 0) { finish(); return; }
    const s = STOPS[i]!;
    const cur = pRef.current;
    update({ ...cur, status: 'active', at: s.id, visited: s.kind === 'page' && !cur.visited.includes(s.step) ? [...cur.visited, s.step] : cur.visited });
  }, [update, finish]);

  const skip = useCallback(() => {
    const h = hostRef.current;
    update({ ...pRef.current, status: 'skipped' });
    h.setMain(null);
    h.back();
    sayPaused();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update]);
  const sayChecklist = () => {
    hostRef.current.say({ text: TOUR_W.setupLead, card: <Checklist onSetup={() => apiRef.current.setup()} /> });
  };
  const sayPaused = () => {
    const g = gsRef.current;
    hostRef.current.say({ text: TOUR_W.paused(g.done, g.total), card: <ContinueCard onContinue={() => apiRef.current.resume()} /> });
  };

  // The conversation's cards call back through this (they keep the element they were given).
  const apiRef = useRef({ resume: () => {}, retake: () => {}, setup: () => {} });
  apiRef.current = {
    resume: () => update({ ...pRef.current, status: 'active' }),
    retake: () => update({ ...FRESH, status: 'active', at: STOPS[0]!.id }),
    // "Start setup" on the checklist turn: straight to the first step still to do.
    setup: () => {
      const j = seek(STOPS.findIndex((x) => x.kind === 'page'), 1, gsRef.current, new Set(pRef.current.visited), present);
      if (j < 0) { finish(); return; }
      go(j);
    },
  };

  // A pause owed to the conversation (see navRef.gone): said once today's conversation is on screen.
  const [owed, setOwed] = useState(false);
  useEffect(() => {
    if (!owed) return;
    const check = () => {
      const t = hostRef.current.region('transcript');
      if (!t || t.closest('[inert], [aria-hidden="true"]')) return;
      setOwed(false);
      if (pRef.current.status === 'skipped') sayPaused();
    };
    check();
    if (typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(check);
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['inert', 'aria-hidden'] });
    return () => mo.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owed]);

  // A tour paused in an earlier visit leaves its "Continue setup" turn again when the home opens.
  // When the home opens: the first need of a brand-new wallet is the setup itself, so a tour under way
  // leaves it in the conversation as a turn of its own (live ticks, "Start setup"; the "need" mark
  // lights it); a tour paused in an earlier visit leaves its "Continue setup" turn instead. Once.
  const opening = useRef(p.status);
  useEffect(() => {
    if (opening.current === 'finished' || !regionsReady || !known) return;
    const was = opening.current;
    opening.current = 'finished';
    if (was === 'skipped') sayPaused(); else sayChecklist();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionsReady, known]);

  // ---- the stop on screen: a page goes to main; a mark clears main (and an after-mark may move the side)
  const stopId = stop?.id ?? null;
  const autoOpen = useMemo(() => { try { return new URLSearchParams(location.search).get('st_open') === '1'; } catch { return false; } }, []);
  const navRef = useRef({ back: () => {}, later: () => {}, skip: () => {}, gone: (_step: string) => {} });
  navRef.current = {
    back: () => go(moveRef.current.back()), later: () => go(moveRef.current.next()), skip,
    // The owner opened something else over the page (a row of the side list): the tour pauses there,
    // exactly as Skip for now, so "Continue setup" brings the same page back.
    gone: (step: string) => {
      const cur = pRef.current;
      if (cur.status !== 'active' || cur.at !== `page:${step}`) return;
      // Not the owner (no click or key outside the page since it was put up): Stage moved main by
      // itself (its own setup narration jumps to today when the steps change). Put the page back.
      if (!outsideInput.current) {
        requestAnimationFrame(() => { if (pRef.current.status === 'active' && pRef.current.at === `page:${step}`) putPage(step as StartStepKey); });
        return;
      }
      mainIsPage.current = false;
      update({ ...cur, status: 'skipped' });
      // host.say brings the conversation back, which would close what she just opened: the
      // "Continue setup" turn waits until she is back on today.
      setOwed(true);
    },
  };
  const mainIsPage = useRef(false);
  const backRef = useRef(backIdx);
  backRef.current = backIdx;
  /** Puts a step's page on stage; it reads the wallet itself and calls back through navRef. */
  const putPage = (step: StartStepKey) => {
    mainIsPage.current = true;
    outsideInput.current = false;
    hostRef.current.setMain(<StepPage key={step} step={step} autoOpen={autoOpen}
      onBack={backRef.current >= 0 ? () => navRef.current.back() : null} onLater={() => navRef.current.later()} onSkip={() => navRef.current.skip()} onGone={() => navRef.current.gone(step)} />);
  };
  // A click or a key outside the page and the tour's own marks: the owner moved on her own.
  const outsideInput = useRef(false);
  useEffect(() => {
    const on = (e: Event) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t?.closest('[data-sim="tour"], [data-st-overlay]')) outsideInput.current = true;
    };
    window.addEventListener('pointerdown', on, true);
    window.addEventListener('keydown', on, true);
    return () => { window.removeEventListener('pointerdown', on, true); window.removeEventListener('keydown', on, true); };
  }, []);
  useEffect(() => {
    const h = hostRef.current;
    if (!stop) {
      if (mainIsPage.current) { h.setMain(null); mainIsPage.current = false; }
      return;
    }
    if (stop.kind === 'page') {
      if (!pRef.current.visited.includes(stop.step)) update({ ...pRef.current, visited: [...pRef.current.visited, stop.step] });
      putPage(stop.step);
      return;
    }
    if (mainIsPage.current) { h.setMain(null); mainIsPage.current = false; }
    if (stop.kind === 'after' && stop.step === 'practice') h.pick('tables', null);
  // Only when the stop changes: a page keeps the element it was given and reads the wallet itself.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopId]);

  // Stage's own setup narration sends main back to today whenever the next step changes; on a page
  // stop the tour puts its page back right after (see navRef.gone for the same from the other side).
  const gsNext = gs.next;
  useEffect(() => {
    const s = stop;
    if (s?.kind !== 'page' || !mainIsPage.current) return;
    const id = requestAnimationFrame(() => { if (pRef.current.status === 'active' && pRef.current.at === s.id) putPage(s.step); });
    return () => cancelAnimationFrame(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gsNext]);

  // ---- keys: Esc pauses the tour (a sheet or popover of the page closes first; a field with text keeps
  // it); on a mark Enter / → go on and ← goes back, unless the owner is on a control of the page
  const onMark = stop !== null && stop.kind !== 'page';
  useEffect(() => {
    if (!stop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
      if (e.key === 'Escape') {
        if (layerCount() > 0) return;
        if (typingIn(e.target) && (e.target as HTMLInputElement).value) return;
        e.preventDefault(); e.stopPropagation(); skip();
        return;
      }
      if (!onMark) return;
      const inMark = e.target instanceof HTMLElement && !!e.target.closest('.st-mark');
      if (e.key === 'Enter' && !(interactive(e.target) && !inMark)) {
        if (inMark && interactive(e.target)) return; // the focused button of the mark does it itself
        e.preventDefault(); e.stopPropagation(); go(moveRef.current.next());
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && (!interactive(e.target) || inMark)) {
        const to = e.key === 'ArrowRight' ? moveRef.current.next() : moveRef.current.back();
        if (e.key === 'ArrowLeft' && to < 0) return;
        e.preventDefault(); e.stopPropagation(); go(to);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [stop, onMark, go, skip]);

  if (!stop || stop.kind === 'page') return null;
  const words = stop.kind === 'mark' ? MARK[stop.region] : AFTER[stop.step];
  const nextStop = nextIdx >= 0 ? STOPS[nextIdx]! : null;
  const nextLabel = !nextStop ? TOUR_W.finish
    : nextStop.kind === 'page' ? (stop.kind === 'mark' ? TOUR_W.startSetup : TOUR_W.nextStep(gs.steps.find((s) => s.key === nextStop.step)?.n ?? 1, PAGE[nextStop.step].short))
      : TOUR_W.next;
  const count = stop.kind === 'mark' ? markCount(stop.region, present) : null;
  const kick = stop.kind === 'mark' ? `${TOUR_W.label} · ${TOUR_W.tourCount(count?.n ?? 1, count?.total ?? 1)}` : TOUR_W.stepDone(gs.steps.find((x) => x.key === stop.step)?.n ?? 1, gs.total);
  return (
    <Spotlight host={host} region={stop.region} stopId={stop.id} kick={kick} title={words.title} text={words.text} gsNode={<Progress gs={gs} current={null} />}
      nextLabel={nextLabel} onNext={() => go(moveRef.current.next())} onBack={backIdx >= 0 ? () => go(moveRef.current.back()) : null} onSkip={skip} />
  );
}

/** The tour's status for the turns it left in the conversation (they live in Stage's tree, not ours). */
const tourStatus = (() => {
  let v: Saved['status'] = 'new';
  const subs = new Set<() => void>();
  return {
    get: () => v,
    set: (n: Saved['status']) => { if (n !== v) { v = n; subs.forEach((f) => f()); } },
    sub: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
  };
})();

/** A mark's element: the region Stage marked, or for "need" on a brand-new wallet (Stage shows no
 *  first need while a sim owns the setup) the tour's own checklist turn in the conversation. */
function markEl(host: StageHost, r: MarkRegion): HTMLElement | null {
  const el = host.region(r);
  if (el || r !== 'need') return el;
  const own = document.querySelectorAll<HTMLElement>('[data-front="stage"] [data-st-setup]');
  return own.length ? own[own.length - 1]! : null;
}

type Rect = { left: number; top: number; width: number; height: number };
const NOW = { duration: 0 } as const;

/** The dimmed home with one region lit, and the coach mark beside it (portal, fixed, non-modal). */
function Spotlight({ host, region, stopId, kick, title, text, gsNode, nextLabel, onNext, onBack, onSkip }: {
  host: StageHost; region: MarkRegion; stopId: string; kick: string; title: string; text: string; gsNode: React.ReactNode;
  nextLabel: string; onNext: () => void; onBack: (() => void) | null; onSkip: () => void;
}) {
  const calm = useCalm();
  const markRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const [ring, setRing] = useState<Rect | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  // The spot and the mark glide only when the tour moves to another stop; while the owner stays on
  // a stop they follow the region at once (a tween chasing a moving region lags and restarts).
  const [glide, setGlide] = useState(false);
  const measuredFor = useRef<string | null>(null);
  const hostRef = useRef(host);
  hostRef.current = host;

  useLayoutEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const el = markEl(hostRef.current, region);
      const m = markRef.current;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const r = el?.getBoundingClientRect();
      const lit = !!el && !!r && r.width > 0 && r.height > 0 && !el.closest('[inert], [aria-hidden="true"]');
      const box = lit ? ringBox(r!, vw, vh, [], 6) : null;
      // Glide when the lit region changes from one stop to the next; the very first one just fades in.
      const first = measuredFor.current !== stopId && !!box;
      const fromAnother = measuredFor.current !== null;
      if (first) measuredFor.current = stopId;
      setGlide(first && fromAnother);
      setRing((o) => (sameRect(o, box) ? o : box));
      if (!m) return;
      // Without a lit region (it is coming back from under a page) the mark waits at the bottom centre.
      const a = box ? { top: box.top, bottom: box.top + box.height, left: box.left, width: box.width } : { top: vh, bottom: vh, left: vw / 2, width: 0 };
      const next = placeMark(a, m.offsetWidth, m.offsetHeight, vw, vh, keepClearBoxes(m).filter((b) => !box || !inside(b, box)));
      setAt((o) => (o && o.left === next.left && o.top === next.top ? o : next));
    };
    const soon = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    const el = markEl(hostRef.current, region);
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    window.addEventListener('resize', soon);
    window.addEventListener('scroll', soon, true);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(soon);
    if (el) ro?.observe(el);
    if (markRef.current) ro?.observe(markRef.current);
    // Layout moving the region without resizing it (web fonts arriving, the column above growing).
    const root = document.querySelector('[data-front="stage"]');
    if (root) ro?.observe(root);
    el?.parentElement && ro?.observe(el.parentElement);
    void document.fonts?.ready.then(soon);
    // Stage animating the conversation back (styles, inert, hidden) moves the region: follow it.
    // Its own spot and mark animating are not a reason to measure again.
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver((recs) => {
      if (recs.some((r) => !(r.target instanceof Element && r.target.closest('[data-st-overlay]')))) soon();
    });
    mo?.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'inert', 'aria-hidden', 'hidden'] });
    return () => { if (raf) cancelAnimationFrame(raf); window.removeEventListener('resize', soon); window.removeEventListener('scroll', soon, true); ro?.disconnect(); mo?.disconnect(); };
  }, [region, stopId]);

  // Focus moves to Next on each stop (only while this window has focus), so Enter goes on.
  useEffect(() => { if (document.hasFocus()) nextRef.current?.focus({ preventScroll: true }); }, [stopId]);

  const t = tx('med', calm);
  // One spot for the whole tour: it glides from region to region; with nothing lit it closes to a
  // point in the middle, so the whole home stays dimmed and the mark waits at the bottom.
  const vw = typeof window === 'undefined' ? 0 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 0 : window.innerHeight;
  const spot = ring ?? { left: vw / 2, top: vh / 2, width: 0, height: 0 };
  return createPortal(
    <MotionConfig reducedMotion="user">
      <motion.div className="st-spot" aria-hidden="true" data-st-overlay="" data-region={ring ? region : ''} data-lit={ring ? 'true' : 'false'}
        initial={spot} animate={spot} transition={glide ? t : NOW} />
      <motion.div ref={markRef} className="st-mark" data-st-overlay="" role="dialog" aria-modal="false" aria-label={TOUR_W.dialog} data-stop={stopId}
        initial={false} animate={at ? { left: at.left, top: at.top } : { left: 8, top: 8 }} style={at ? undefined : { visibility: 'hidden' }} transition={glide ? t : NOW}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={stopId} className="st-mark-in" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={tx('fast', calm)}>
            <div className="st-mark-h">
              <span className="st-kick">{kick}</span>
              <Btn kind="plain" sm onClick={onSkip} title={TOUR_W.skipTitle}>{TOUR_W.skip}</Btn>
            </div>
            <h2 className="st-mark-t">{title}</h2>
            <p className="st-mark-x">{text}</p>
            {gsNode}
            <div className="st-mark-f">
              {onBack ? <Btn sm onClick={onBack}>{TOUR_W.back}</Btn> : <span />}
              <span className="st-keys" aria-hidden="true">{TOUR_W.keys}</span>
              <Btn ref={nextRef} kind="primary" sm onClick={onNext}>{nextLabel}</Btn>
            </div>
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </MotionConfig>,
    document.body,
  );
}

const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);
/** A keep-clear box inside the lit region is part of what the mark points at: it may sit beside it. */
const inside = (b: { left: number; top: number; right: number; bottom: number }, r: Rect): boolean =>
  b.left >= r.left - 8 && b.top >= r.top - 8 && b.right <= r.left + r.width + 8 && b.bottom <= r.top + r.height + 8;

/** The setup checklist turn: the four steps with live ticks, and the way in. */
function Checklist({ onSetup }: { onSetup: () => void }) {
  const gs = useStart();
  const all = gs.done === gs.total;
  return (
    <div className="st-card st-check" data-st-setup="">
      <Progress gs={gs} current={gs.next} />
      <ol className="st-done-list">
        {gs.steps.map((s) => (
          <li key={s.key} className={s.state === 'done' ? 'is-done' : ''}>
            <span className="st-tick" aria-hidden="true">{s.state === 'done' ? <Icon name="check" size={12} /> : s.n}</span>
            <span>{s.state === 'done' ? START_STEP[s.key].done : START_STEP[s.key].title}</span>
          </li>
        ))}
      </ol>
      {all ? null : <div className="fs-acts"><Btn sm kind="primary" onClick={onSetup}>{gs.done ? TOUR_W.continue : TOUR_W.startSetup}</Btn></div>}
    </div>
  );
}

/** The "Continue setup" turn: picks the tour up at the stop it was paused on. */
function ContinueCard({ onContinue }: { onContinue: () => void }) {
  // Only while the tour is paused: once it runs again (or is done) the turn is history, not a button.
  const status = useSyncExternalStore(tourStatus.sub, tourStatus.get, tourStatus.get);
  if (status !== 'skipped') return null;
  return (
    <div className="st-card">
      <Btn kind="primary" sm onClick={onContinue}>{TOUR_W.continue}</Btn>
    </div>
  );
}

/** The ending turn: what is done, and where to find things again. */
function DoneCard({ onRetake }: { onRetake: () => void }) {
  const gs = useStart();
  const all = gs.done === gs.total;
  return (
    <div className="st-card st-done">
      <p className="st-body">{all ? TOUR_W.setUpSub : TOUR_W.almost(gs.done, gs.total)}</p>
      <ul className="st-done-list">
        {gs.steps.map((s) => (
          <li key={s.key} className={s.state === 'done' ? 'is-done' : ''}>
            <span className="st-tick" aria-hidden="true">{s.state === 'done' ? <Icon name="check" size={12} /> : s.n}</span>
            <span>{s.state === 'done' ? START_STEP[s.key].done : START_STEP[s.key].title}</span>
          </li>
        ))}
      </ul>
      <p className="st-kick">{TOUR_W.whereAgain}</p>
      <ul className="st-again">{TOUR_W.again.map((l) => <li key={l}>{l}</li>)}</ul>
      <div className="fs-acts"><Btn sm kind="plain" onClick={onRetake}>{TOUR_W.retake}</Btn></div>
    </div>
  );
}

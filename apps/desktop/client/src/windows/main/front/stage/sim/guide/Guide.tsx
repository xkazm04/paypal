// spark abstract-first-home round 3, simulated first project "GUIDE": the assistant walks a brand-new
// owner through it, in the conversation. Stage owns the screen; this drives it only through the
// StageHost (sim/host.ts):
//   say     the opening turn, one turn per step with its card (the step is done IN the card), a
//           one-line onboarding after each step, Paused / Continue setup, and "You're set up"
//   pick    the side panel switches to the module a finished step just gave meaning to
//   region  a brief ring with a caption on what just appeared (today line, side, ask box)
//   ask     a card's question chip goes to the real assistant; the guide then says the step again
//           under the answer, so the live step is always the latest turn
//   back    Skip for now and Show my home put main back on today's conversation
// Progress is never kept here: useStart (the world) is the only source, so a reload, the approval
// window or a skip all resume where the wallet actually is.
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DUR, useCalm } from '../../../../../../design/motion';
import type { GettingStarted } from '../../../../../../lib/firstRun';
import type { StartStepKey } from '../../../../../../lib/words';
import { useStart } from '../../../../setup/start';
import { tr } from '../../fx';
import type { SimProps, SimRegion } from '../host';
import { ContinueCard, DoneCard, JumpCard, PlanCard, StepCard } from './cards';
import { guideN, guideNext } from './order';
import { guideState, resetGuide, setGuide, type GuideCtl } from './store';
import { SG, SG_LEARNED, SG_STEP } from './words';
import './guide.css';

/** How long a ring stays on what it points at, and how long the transcript must be quiet after her
 *  question before the guide says the step again (an answer streams in; never interrupt it). */
const RING_MS = DUR.sheet * 5;
const QUIET_MS = DUR.sheet * 3;
/** After Start: how long the ring rests on the today line before the first step is said. */
const INTRO_MS = DUR.sheet * 4;

/** What a finished step lit up: the side module it gave meaning to, and where to point. */
const AFTER: Record<StartStepKey, { pick: 'book' | 'spend' | 'tables' | null; region: SimRegion; caption: string }> = {
  paypal: { pick: 'book', region: 'side-switcher', caption: SG.where.book },
  rules: { pick: 'spend', region: 'side-switcher', caption: SG.where.spend },
  practice: { pick: 'tables', region: 'side-list', caption: SG.where.tables },
  engine: { pick: null, region: 'ask', caption: SG.where.ask },
};

const doneKeys = (gs: GettingStarted): Set<StartStepKey> => new Set(gs.steps.filter((s) => s.state === 'done').map((s) => s.key));
/** Room above a region for the ring's caption; less, and the caption goes below. */
const CAPTION_ROOM = 48;
const known = (gs: GettingStarted): boolean => gs.steps.every((s) => s.state !== 'unknown');

/** A guide line with no card still carries this mark, so the guide can tell its own turns from hers. */
const MINE = <i data-sg-card="line" hidden />;

type Ring = { id: number; caption: string; region: SimRegion };

export function GuideSim({ host, exit }: SimProps) {
  const gs = useStart();
  const calm = useCalm();
  const hostRef = useRef(host);
  hostRef.current = host;
  const gsRef = useRef(gs);
  gsRef.current = gs;
  const exitRef = useRef(exit);
  exitRef.current = exit;
  const serial = useRef(0);

  // ---- pointing: a ring with a caption over the region, after the layout settles (a pick re-renders
  // the side; a say scrolls the conversation). `reveal` scrolls a region that may be out of view
  // (the today line, at the top of the conversation) into it first; the ring follows it there.
  const [ring, setRing] = useState<Ring | null>(null);
  const ringId = useRef(0);
  const findRegion = useCallback((r: SimRegion) => hostRef.current.region(r), []);
  const calmRef = useRef(calm);
  calmRef.current = calm;
  const point = useCallback((region: SimRegion, caption: string, reveal = false) => {
    window.setTimeout(() => {
      const el = hostRef.current.region(region);
      if (!el) return;
      if (reveal) el.scrollIntoView?.({ block: 'nearest', behavior: calmRef.current ? 'auto' : 'smooth' });
      setRing({ id: ++ringId.current, caption, region });
    }, DUR.slow);
  }, []);
  useEffect(() => {
    if (!ring) return;
    const t = window.setTimeout(() => setRing((r) => (r?.id === ring.id ? null : r)), RING_MS);
    return () => window.clearTimeout(t);
  }, [ring]);

  // ---- the conversation's moves (stable: they read the latest host and progress from refs)
  const ctlRef = useRef<GuideCtl | null>(null);
  const sayStep = useCallback((k: StartStepKey, again = false) => {
    const n = ++serial.current;
    setGuide({ phase: 'step', live: n });
    const g = gsRef.current;
    hostRef.current.say({ text: (again ? SG.backTo : SG.stepTurn)(guideN(k), g.total, SG_STEP[k]), card: <StepCard step={k} serial={n} ctl={ctlRef.current!} /> });
  }, []);
  const finish = useCallback(() => {
    setGuide({ phase: 'done', live: 0 });
    hostRef.current.say({ text: SG.done, card: <DoneCard ctl={ctlRef.current!} /> });
  }, []);
  const next = useCallback(() => {
    const k = guideNext(gsRef.current);
    if (k) sayStep(k); else finish();
  }, [sayStep, finish]);

  const ctl = useMemo<GuideCtl>(() => ({
    start() {
      if (guideState().phase !== 'intro') return;
      // The today line first (a ring on it), then the first step under it.
      setGuide({ phase: 'step', live: 0 });
      hostRef.current.say({ text: SG_LEARNED.intro, card: MINE });
      point('status', SG.where.status, true);
      window.setTimeout(() => { const g = guideState(); if (g.phase === 'step' && g.live === 0) next(); }, INTRO_MS);
    },
    skip() {
      const p = guideState().phase;
      if (p !== 'intro' && p !== 'step') return;
      setGuide({ phase: 'paused' });
      setRing(null);
      hostRef.current.back();
      const g = gsRef.current;
      hostRef.current.say({ text: SG.paused(g.done, g.total), card: <ContinueCard ctl={ctlRef.current!} /> });
    },
    resume() {
      if (guideState().phase !== 'paused') return;
      next();
    },
    ask(question) { hostRef.current.ask(question); },
    home() {
      setGuide({ phase: 'over' });
      hostRef.current.back();
      point('status', SG.where.status, true);
    },
    leave() { exitRef.current(); },
    point,
  }), [next, point]);
  ctlRef.current = ctl;

  // ---- the opening turn, once the wallet's progress is read (a return visit says how far it got)
  const prev = useRef<Set<StartStepKey> | null>(null);
  useEffect(() => {
    if (prev.current || !known(gs)) return;
    prev.current = doneKeys(gs);
    resetGuide();
    if (guideNext(gs) === null) {
      setGuide({ phase: 'done' });
      host.say({ text: SG.openSet, card: <DoneCard ctl={ctl} /> });
      return;
    }
    host.say({ text: gs.done ? SG.openBack(gs.done, gs.total) : SG.open, card: <PlanCard ctl={ctl} /> });
  }, [gs, host, ctl]);

  // ---- a step finished (in its card, in the approval window, anywhere): say what appeared, light
  // the module, point at it, then the next step or the ending
  useEffect(() => {
    if (!prev.current) return;
    const now = doneKeys(gs);
    const fresh = [...now].filter((k) => !prev.current!.has(k));
    prev.current = now;
    if (!fresh.length || guideState().phase !== 'step') return;
    for (const k of fresh) hostRef.current.say({ text: SG_LEARNED[k], card: MINE });
    const last = AFTER[fresh[fresh.length - 1]!];
    if (last.pick) hostRef.current.pick(last.pick, null);
    point(last.region, last.caption);
    next();
  }, [gs, next, point]);

  // ---- her own question mid-step (typed, or a card's chip): once the answer has landed and the
  // transcript is quiet, the step is said again under it, so the live step is the latest turn
  useEffect(() => {
    let mo: MutationObserver | null = null;
    let quiet = 0;
    const seen = new WeakSet<Element>();
    const check = () => {
      if (guideState().phase !== 'step') return;
      const root = hostRef.current.region('transcript');
      const lives = root?.querySelectorAll('[data-sg-card="step"][data-state="todo"]');
      const live = lives?.[lives.length - 1];
      if (!live) return;
      // A turn of hers (or an answer) below the live step that the guide has not answered yet. Only
      // transcript entries count (Stage's trailing Suggested card is not a turn), each one once.
      let turn: Element | null = live.closest('li') ?? live;
      let foreign = false;
      while ((turn = turn.nextElementSibling)) {
        if (!turn.hasAttribute('data-entry') || seen.has(turn) || turn.querySelector('[data-sg-card]') || !turn.textContent?.trim()) continue;
        seen.add(turn);
        foreign = true;
      }
      const k = guideNext(gsRef.current);
      if (!foreign || !k) return;
      // A secure step open in the live card keeps its place (saying it again would drop her work in it).
      if (live.querySelector('.sg-frame')) {
        const n = Number((live as HTMLElement).dataset.sgLive);
        hostRef.current.say({ text: SG.stillOpen, card: <JumpCard step={k} serial={n} /> });
        return;
      }
      sayStep(k, true);
    };
    const attach = (): boolean => {
      const root = hostRef.current.region('transcript');
      if (!root) return false;
      mo = new MutationObserver(() => { window.clearTimeout(quiet); quiet = window.setTimeout(check, QUIET_MS); });
      mo.observe(root, { childList: true, subtree: true, characterData: true });
      return true;
    };
    // The transcript may mount after the sim does: look again until it is there.
    const look = attach() ? 0 : window.setInterval(() => { if (attach()) window.clearInterval(look); }, DUR.slow);
    return () => { mo?.disconnect(); window.clearTimeout(quiet); window.clearInterval(look); };
  }, [sayStep]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {ring ? <RingView key={ring.id} ring={ring} calm={calm} find={findRegion} /> : null}
    </AnimatePresence>,
    document.body,
  );
}

/** The ring follows its region every frame while it shows (the conversation may still be scrolling). */
function RingView({ ring, calm, find }: { ring: Ring; calm: boolean; find: (r: SimRegion) => HTMLElement | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [low, setLow] = useState(false);
  useEffect(() => {
    let raf = 0;
    const follow = () => {
      const el = find(ring.region);
      const b = box.current;
      if (el && b) {
        const r = el.getBoundingClientRect();
        Object.assign(b.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        setLow(r.top < CAPTION_ROOM);
      }
      raf = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(raf);
  }, [ring.region, find]);
  return (
    <motion.div ref={box} className={`sg-ring${low ? ' is-low' : ''}`} aria-hidden="true" data-sg-ring={ring.caption}
      initial={{ opacity: 0, scale: calm ? 1 : 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={tr('slow', calm, 'out')}>
      <motion.span className="sg-ring-glow" animate={calm ? { opacity: 1 } : { opacity: [1, 0.35, 1, 0.35, 1] }} transition={calm ? { duration: 0 } : { duration: (DUR.sheet * 4) / 1000 }} />
      <span className="sg-ring-cap">{ring.caption}</span>
    </motion.div>
  );
}

// spark abstract-first-home round 4, simulated first project "TOUR": the AI-led setup.
// The conversation leads, one component per turn: ONE assistant turn = ONE step = ONE component, and
// the next step's turn appears only once the wallet calls the current one done (useStart).
//   1 Opening: the Stage status line stays; the first turn is one short sentence + the keys' secure step.
//   2 Each step's turn: a tiny "n of 4", one sentence of why, the component, a quiet "Skip for now".
//     Done -> the component's own success state, then one line ("Keys saved. Next, the rules your agents
//     follow.") and the next turn; the older turn folds to a done line. Never two open components.
//   3 Rules: the proposal in plain words first (rules.ts: per deal, per day, ask me above, the practice
//     shop as payee), "Looks right" -> the secure step with that draft; "Change something" -> she says
//     it in the ask box and the proposal is read again by the wallet's own reader (no model).
//   4 Next steps: the practice shop (pairing_join HOUSE here, then the secure step's four words) and the
//     agent app (one row of choices). Then "You're set" with three pointers that light their region.
//   5 After each step at most ONE mark, on where the result now lives (Spot.tsx): leaves by itself.
//   6 She can ask anything at any time: the answer stays in the conversation and the current step is
//     offered again under it ("Back to: Rules."), the older turn folding to "Moved below".
//   7 Skip for now: host.back(), a "Continue setup" turn; a reload resumes from useStart.
// Order: keys -> rules -> practice shop -> agent app (START_ORDER). The rules can come before the shop
// because the proposal names the shop's payee up front, and the wallet signs that (rules.test.ts).
// The tour never acts: every mutation is a control she presses (secure steps run in the approval context).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clockNow } from '../../../../../../lib/clock';
import { firstRunPreview } from '../../../../../../lib/preview';
import type { StartStepKey } from '../../../../../../lib/words';
import { useStart } from '../../../../setup/start';
import type { SimProps, StageHost } from '../host';
import {
  allKnown, firstTodo, flowKey, flowState, isDone, loadFlow, nextLive, ORDER, setFlow, spotOff, spotOn, stepN,
  type SpotTarget,
} from './flow';
import { changeFrom, rulesCtx, type RulesAsk } from './rules';
import { Spot } from './Spot';
import { PausedTurn, SetTurn, StepTurn, type TurnApi } from './Turns';
import { STEP, TOUR_W } from './words';
import './tour.css';

/** The secure step's success state stays this long before the next turn is said. */
export const SUCCESS_MS = 1200;

/** Where each finished step's result now lives: the one mark after it. */
const AFTER: Record<StartStepKey, SpotTarget> = {
  paypal: { segment: 'book' },
  rules: { segment: 'spend' },
  practice: { segment: 'tables' },
  engine: { region: 'ask' },
};

const usdWords = (minor: number): string => `$${minor % 100 ? (minor / 100).toFixed(2) : String(minor / 100)}`;

/** "up to $80 a deal, ask above $20": what her answer changed, in words. */
function changedWords(next: RulesAsk, changed: readonly (keyof RulesAsk)[]): string {
  return changed.map((k) => (k === 'ends' ? TOUR_W.part.ends(next.ends) : TOUR_W.part[k](usdWords(next[k])))).join(', ');
}

export function TourSim({ host }: SimProps) {
  const gs = useStart();
  const gsRef = useRef(gs);
  gsRef.current = gs;
  const hostRef = useRef<StageHost>(host);
  hostRef.current = host;
  useState(() => loadFlow(flowKey(firstRunPreview())));

  // ---- start once Stage has marked its regions and every step's state is read
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) return;
    const check = () => { if (hostRef.current.region('status') && hostRef.current.region('transcript')) setReady(true); };
    check();
    if (typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [ready]);
  const known = allKnown(gs);

  // ---- saying turns (the cards call back through apiRef: Stage keeps the element as it was said)
  const apiRef = useRef<TurnApi>({ skip: () => {}, resume: () => {}, change: () => {} });
  const api = useMemo<TurnApi>(() => ({ skip: () => apiRef.current.skip(), resume: () => apiRef.current.resume(), change: () => apiRef.current.change() }), []);
  const sayStep = useCallback((step: StartStepKey, text: string) => {
    setFlow({ status: 'active', ...(step === 'rules' ? {} : { rulesPhase: 'propose' as const }) });
    const serial = nextLive(step);
    hostRef.current.say({ text, card: <StepTurn step={step} serial={serial} api={api} /> });
  }, [api]);
  const sayPaused = useCallback(() => {
    const k = firstTodo(gsRef.current) ?? ORDER[0]!;
    const serial = nextLive(null);
    hostRef.current.say({ text: TOUR_W.paused(stepN(k), ORDER.length, STEP[k].short), card: <PausedTurn serial={serial} api={api} /> });
  }, [api]);
  const sayEnd = useCallback((lead: string | null) => {
    nextLive(null);
    setFlow({ status: 'finished' });
    const g = gsRef.current;
    const text = g.done === g.total ? TOUR_W.setUp : TOUR_W.setUpPartial(g.total - g.done);
    hostRef.current.say({ text: lead ? `${lead} ${text}` : text, card: <SetTurn /> });
  }, []);

  apiRef.current = {
    skip: () => {
      spotOff();
      setFlow({ status: 'skipped', changing: false });
      hostRef.current.back();
      sayPaused();
    },
    resume: () => {
      const k = firstTodo(gsRef.current);
      if (!k) { sayEnd(null); return; }
      sayStep(k, TOUR_W.backTo(STEP[k].short));
    },
    change: () => {
      setFlow({ changing: true });
      hostRef.current.region('ask')?.querySelector<HTMLInputElement>('input')?.focus();
    },
  };

  // ---- the opening (or the resume after a reload): once
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !ready || !known) return;
    opened.current = true;
    const st = flowState().status;
    if (st === 'finished') return;
    if (st === 'skipped') { sayPaused(); return; }
    const k = firstTodo(gsRef.current);
    if (!k) { sayEnd(null); return; }
    const fresh = st === 'new' && gsRef.current.done === 0;
    sayStep(k, `${fresh ? TOUR_W.open : TOUR_W.resume} ${STEP[k].lead}`);
  }, [ready, known, sayStep, sayPaused, sayEnd]);

  // ---- a step done: its success state for a moment, then the next turn and the one mark
  const advancing = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (advancing.current) clearTimeout(advancing.current); }, []);
  useEffect(() => {
    const f = flowState();
    if (f.status !== 'active' || !f.step || advancing.current || !isDone(gs, f.step)) return;
    const was = f.step;
    advancing.current = setTimeout(() => {
      advancing.current = null;
      const now = flowState();
      if (now.status !== 'active' || now.step !== was) return;
      const k = firstTodo(gsRef.current);
      if (k) sayStep(k, `${STEP[was].done} ${STEP[k].lead}`);
      else sayEnd(STEP[was].done);
      if (was === 'practice') hostRef.current.pick('tables', null);
      // the mark goes up once the conversation is back and the side has moved
      requestAnimationFrame(() => spotOn(AFTER[was], STEP[was].spot));
    }, SUCCESS_MS);
  }, [gs, sayStep, sayEnd]);

  // ---- she asked something: the answer stays in the conversation, then the step comes back under it
  // (on the rules proposal, what her words SAID changes the proposal first).
  const afterAnswer = useCallback((q: string) => {
    const f = flowState();
    if (f.status !== 'active' || !f.step || isDone(gsRef.current, f.step)) return;
    if (f.step === 'rules' && f.rulesPhase === 'propose') {
      const now = Math.floor(clockNow() / 60) * 60;
      const ch = changeFrom(f.rules, q, rulesCtx(now, -new Date(now * 1000).getTimezoneOffset()));
      if (ch.changed.length) { setFlow({ rules: ch.next }); sayStep('rules', TOUR_W.changed(changedWords(ch.next, ch.changed))); return; }
      if (f.changing) { sayStep('rules', `${TOUR_W.unchanged} ${TOUR_W.backTo(STEP.rules.short)}`); return; }
    }
    sayStep(f.step, TOUR_W.backTo(STEP[f.step].short));
  }, [sayStep]);
  const answerRef = useRef(afterAnswer);
  answerRef.current = afterAnswer;
  useEffect(() => {
    if (!ready) return;
    const t = hostRef.current.region('transcript');
    if (!t || typeof MutationObserver === 'undefined') return;
    // Her question is a `.fs-you` line; the answer is settled when no line is still thinking.
    let seen = t.querySelectorAll('.fs-you').length;
    let waiting: string | null = null;
    const check = () => {
      const you = t.querySelectorAll('.fs-you');
      if (you.length > seen) { seen = you.length; waiting = you[you.length - 1]!.textContent ?? ''; }
      if (waiting !== null && !t.querySelector('.fs-thinking')) {
        const q = waiting;
        waiting = null;
        answerRef.current(q);
      }
    };
    const mo = new MutationObserver(check);
    mo.observe(t, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [ready]);

  return <Spot host={host} />;
}

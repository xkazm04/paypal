// spark abstract-first-home round 3, simulated first project STORY: "learn by doing a first deal".
// Goal first, setup just in time. The owner picks what her agents should do first; the story then
// asks for each setup step only at the moment the deal needs it:
//   goal    -> "What should your agents do first?" (two goals the practice shop can serve)
//   engine  -> who bargains for her (only when the agent-app step is not done; engine_select inline)
//   shop    -> meet the practice shop (pairing_join HOUSE inline, the four words confirmed in the
//              secure step)
//   rules   -> the first moment money would be at stake: her goal read as rules, signed in the
//              secure step
//   deal    -> the practice negotiation as a clearly labelled SIMULATED preview in the stage slot
//              (Replay.tsx: the recorded house haggle), the decision moment, where it would land
//   keys    -> last: "make it real with PayPal sandbox" (secure step)
//   done    -> "You're set up", then the ordinary Stage.
// Onboarding is the narration: after each step, one turn says what happened and where it now lives.
// The story drives Stage only through StageHost (sim/host.ts). It never signs, pins or saves keys
// itself: those steps are the real approval page (Secure.tsx), and a step counts as done only when
// the wallet says so (useStart). Its own place (phase, goal, practice decision) is in store.ts.
import { useCallback, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { ApprovalOpenArgs } from '@bindings/ApprovalOpenArgs';
import type { Module } from '@bindings/Module';
import { DUR, useCalm } from '../../../../../../design/motion';
import type { StartStepKey } from '../../../../../../lib/words';
import { Btn } from '../../../../../../shared/ui';
import { useStart } from '../../../../setup/start';
import { useSettings } from '../../../../world';
import { TRAVEL, tr } from '../../fx';
import type { SimProps, SimRegion, SimTurn, StageHost } from '../host';
import { DealCard, DoneCard, EngineCard, GoalCard, KeysCard, ResumeCard, RulesCard, ShopCard } from './Cards';
import { Replay } from './Replay';
import { SecurePage, type SecureWhat } from './Secure';
import { PHASES, STEP_OF, setStory, story, useStory, type Phase } from './store';
import { GOALS, STORY, type GoalId } from './words';
import './story.css';

/** The setup steps in the order the story meets them (the progress line shows them so). */
const STORY_STEPS: readonly StartStepKey[] = ['engine', 'practice', 'rules', 'paypal'];
/** How long a region keeps its pointing ring (three sheet lengths). */
const PULSE_MS = DUR.sheet * 3;

/** What each finished step left behind, said right after it (the onboarding is this narration). */
const DONE_SAY: Partial<Record<Phase, (h: { engine: string | null }) => string>> = {
  engine: (h) => `${h.engine === null ? STORY.enginePracticeDone : STORY.engineDone(h.engine)} ${STORY.engineDoneWhere}`,
  shop: () => `${STORY.shopDone} ${STORY.shopDoneWhere}`,
  rules: () => `${STORY.rulesDone} ${STORY.rulesDoneWhere}`,
  keys: () => STORY.keysDone,
};

export function StorySim({ host, exit }: SimProps) {
  const gs = useStart();
  const st = useStory();
  const settings = useSettings().data;
  const calm = useCalm();
  const hostRef = useRef<StageHost>(host);
  hostRef.current = host;
  const gsRef = useRef(gs);
  gsRef.current = gs;
  /** The chosen agent app's name; null = the practice agent. */
  const engineName = settings && settings.selected_engine !== 'scripted' ? settings.selected_engine : null;
  const engineRef = useRef(engineName);
  engineRef.current = engineName;
  const ready = !!settings && gs.steps.length > 0 && gs.steps.every((s) => s.state !== 'unknown');

  const stepDone = useCallback((k: StartStepKey) => gsRef.current.steps.find((s) => s.key === k)?.state === 'done', []);
  /** The first phase after `from` the deal still needs (a phase whose step is done is passed by). */
  const nextAfter = useCallback((from: Phase): Phase => {
    for (const p of PHASES.slice(PHASES.indexOf(from) + 1)) {
      const k = STEP_OF[p];
      if (!k || !stepDone(k)) return p;
    }
    return 'done';
  }, [stepDone]);

  // ---- pointing: a brief ring on a Stage region (the region exists for coach marks; calm: no ring)
  const pulse = useCallback((r: SimRegion) => {
    const el = hostRef.current.region(r);
    if (!el || calm) return;
    el.classList.add('ss-pulse');
    setTimeout(() => el.classList.remove('ss-pulse'), PULSE_MS);
  }, [calm]);

  // ---- the stage slot: the secure step and the practice deal
  const secureOpen = useRef<SecureWhat | null>(null);
  const back = useCallback(() => { secureOpen.current = null; hostRef.current.back(); }, []);
  const openSecure = useCallback((what: SecureWhat, args: ApprovalOpenArgs) => {
    secureOpen.current = what;
    hostRef.current.setMain(<SecurePage what={what} args={args} />);
  }, []);

  const say = useCallback((t: SimTurn) => hostRef.current.say(t), []);
  const enterRef = useRef<(p: Phase) => void>(() => undefined);

  const openDeal = useCallback(() => {
    const goal = story().goal ?? 'haggle';
    const show = (m: Module) => { hostRef.current.pick(m, null); pulse('side-list'); };
    const onNext = () => {
      back();
      say({ text: `${story().decision === 'walk' ? STORY.resultWalked : STORY.dealDoneSay} ${STORY.dealDoneWhere}` });
      enterRef.current(nextAfter('deal'));
    };
    hostRef.current.setMain(<Replay goal={goal} onNext={onNext} show={show} />);
  }, [back, nextAfter, pulse, say]);

  const pick = useCallback((g: GoalId) => {
    if (story().goal) return;
    setStory({ goal: g, decision: null });
    say({ text: STORY.picked(GOALS[g].label) });
    enterRef.current(nextAfter('goal'));
  }, [say, nextAfter]);

  const turnFor = useCallback((p: Phase): SimTurn => {
    const goal: GoalId = story().goal ?? 'haggle';
    switch (p) {
      case 'goal': return { text: STORY.opening, card: <GoalCard onPick={(g) => pick(g)} /> };
      case 'engine': return { text: STORY.engineAsk, card: <EngineCard /> };
      case 'shop': return { text: STORY.shopAsk, card: <ShopCard onConfirm={(w) => openSecure('practice', { deal_id: null, pairing: w.pairing_id })} /> };
      case 'rules': return { text: STORY.rulesAsk, card: <RulesCard goal={goal} onSign={(d) => openSecure('rules', { deal_id: null, target: 'mandate', draft: d })} /> };
      case 'deal': return { text: STORY.dealAsk, card: <DealCard onOpen={openDeal} /> };
      case 'keys': return { text: STORY.keysAsk, card: <KeysCard onOpen={() => openSecure('paypal', { deal_id: null, target: 'credentials' })} onLater={() => enterRef.current('done')} /> };
      case 'done': return { text: STORY.setUp, card: <DoneCard onGo={exit} /> };
    }
  }, [pick, openSecure, openDeal, exit]);

  const enter = useCallback((p: Phase) => {
    setStory({ phase: p, paused: false });
    say(turnFor(p));
    if (p === 'deal') openDeal();
    if (p === 'done') { pulse('status'); }
  }, [say, turnFor, openDeal, pulse]);
  enterRef.current = enter;

  const resume = useCallback(() => {
    const p = story().phase;
    const k = STEP_OF[p];
    enterRef.current(k && stepDone(k) ? nextAfter(p) : p);
  }, [nextAfter, stepDone]);

  const skip = useCallback(() => {
    setStory({ paused: true });
    back();
    say({ text: STORY.skipped, card: <ResumeCard onResume={resume} /> });
  }, [back, say, resume]);

  // ---- the opening, once the wallet's setup facts are read (a reload resumes where she was)
  const started = useRef(false);
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    const s = story();
    if (s.paused) { say({ text: STORY.backAgain, card: <ResumeCard onResume={resume} /> }); return; }
    if (s.phase === 'goal' || s.phase === 'done') { if (s.phase === 'done') setStory({ phase: 'goal', goal: null, decision: null }); enter('goal'); return; }
    say({ text: STORY.backAgain });
    resume();
  }, [ready, say, enter, resume]);

  // ---- a step the wallet now reports done: close the secure step, narrate, go on
  const advancedFrom = useRef<Phase | null>(null);
  useEffect(() => {
    if (!started.current || st.paused) return;
    const k = STEP_OF[st.phase];
    if (!k || !gs.steps.some((s) => s.key === k && s.state === 'done') || advancedFrom.current === st.phase) return;
    advancedFrom.current = st.phase;
    if (secureOpen.current) back();
    const line = DONE_SAY[st.phase]?.({ engine: engineRef.current });
    if (line) say({ text: line });
    enter(nextAfter(st.phase));
  }, [gs.steps, st.phase, st.paused, back, say, enter, nextAfter]);
  // a phase entered again (resume after a skip) may complete again
  useEffect(() => { if (advancedFrom.current !== st.phase) advancedFrom.current = null; }, [st.phase]);

  const doneN = STORY_STEPS.filter((k) => gs.steps.find((s) => s.key === k)?.state === 'done').length;
  const showPill = ready && st.phase !== 'done';
  return (
    <AnimatePresence>
      {showPill ? (
        <motion.aside key="pill" className="ss-pill" aria-label={STORY.progressLabel(doneN, STORY_STEPS.length)} data-ss-pill={st.paused ? 'paused' : st.phase}
          initial={{ opacity: 0, y: -TRAVEL.side }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -TRAVEL.side }} transition={tr('slow', calm, 'out')}>
          <span className="ss-pill-t">{STORY.progress(doneN, STORY_STEPS.length)}</span>
          <ol className="ss-dots">
            {STORY_STEPS.map((k) => {
              const done = gs.steps.find((s) => s.key === k)?.state === 'done';
              const now = !st.paused && STEP_OF[st.phase] === k;
              return (
                <li key={k} className={`ss-dot${done ? ' is-done' : ''}${now ? ' is-now' : ''}`} title={STORY.stepName[k]}>
                  {now ? <motion.span layoutId="ss-dot-now" className="ss-dot-ring" transition={tr('med', calm)} /> : null}
                  <span className="ss-dot-n">{STORY.stepName[k]}</span>
                </li>
              );
            })}
          </ol>
          {st.paused
            ? <Btn sm kind="primary" onClick={resume} data-ss-continue>{STORY.resume}</Btn>
            : <Btn sm kind="plain" onClick={skip} title={STORY.skipTitle} data-ss-skip>{STORY.skip}</Btn>}
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

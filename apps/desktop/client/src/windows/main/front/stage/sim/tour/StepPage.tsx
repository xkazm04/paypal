// A setup step as a Stage item page (host.setMain): the same pattern as any deal - the path
// "Today › First project" (Stage's crumb) "› Setup › Step 2 of 4 · Rules" (ours), the title, the answer
// line, then sections. Classes fs-ihead / fs-ititle / fs-ianswer / fs-isec are the Stage item page's own
// (front/stage/stage.css), so a setup page reads exactly like a deal page; st- classes add the rest.
// What each step does in place (watch-only rule: engine_select and pairing_* only; nothing pays):
//   paypal    the approval page on its credentials step, framed inline (SecureFrame says why)
//   rules     the approval page on its rules step (ready-made sets, check, sign), framed inline
//   practice  the house seller's join (pairing_join "HOUSE", as PairingDesk does), then the
//             approval page's pairing confirm framed inline
//   engine    engine_status / engine_select (a main command), inline; or keep the practice agent
// The page never decides a step is done: useStart does, from the wallet, and the tour moves on.
import { motion, MotionConfig } from 'framer-motion';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { EngineId } from '@bindings/EngineId';
import { useCalm } from '../../../../../../design/motion';
import type { GettingStarted } from '../../../../../../lib/firstRun';
import { useMutation, useQuery } from '../../../../../../lib/hooks';
import { saveTour, tourEnd } from '../../../../../../lib/tour';
import { CONNECTIONS_ENGINE, KEEP_PRACTICE_AGENT, NOTICE_WHAT, reasonWords, START_STEP, type StartStepKey } from '../../../../../../lib/words';
import { PAIR } from '../../../../../../lib/words/connections';
import { WalletNotice } from '../../../../../../shared/honesty';
import { Btn, Field } from '../../../../../../shared/ui';
import { canSubmit, houseWords, payeeProblem } from '../../../../setup/pairing';
import { useStart } from '../../../../setup/start';
import { useLocked, useSettings } from '../../../../world';
import { tx } from './motion';
import { approvalUrl, SecureFrame } from './SecureFrame';
import { PAGE, TOUR_W } from './words';

export type StepPageProps = {
  step: StartStepKey;
  /** Prototype-only `?st_open=1`: press the page's secure-step opener once on arrival (screenshots). */
  autoOpen: boolean;
  /** Back to the stop before (null on the first one). */
  onBack: (() => void) | null;
  onLater: () => void;
  onSkip: () => void;
  /** The page left the stage (the tour moved on, or the owner opened something else over it). */
  onGone: () => void;
};

export function StepPage({ step, autoOpen, onBack, onLater, onSkip, onGone }: StepPageProps) {
  // Read here, not passed in: the host keeps this element as it was given, so the page reads the
  // wallet itself and stays live while it is on stage.
  const gs = useStart();
  const gone = useRef(onGone);
  gone.current = onGone;
  useEffect(() => () => gone.current(), []);
  const n = gs.steps.find((s) => s.key === step)?.n ?? 1;
  const w = PAGE[step];
  return (
    <MotionConfig reducedMotion="user">
      {/* Stage puts this inside its own item page (its crumb "Today › First project", its slide in and
          out); the page carries the rest of the path, "Setup › Step 2 of 4 · Rules", with the progress. */}
      <div className="st-page" data-sim="tour" data-step={step} aria-label={START_STEP[step].title}>
        <div className="st-path">
          <span className="st-kick st-where">{TOUR_W.setup}<span aria-hidden="true"> › </span><b>{TOUR_W.stepOf(n, gs.total, w.short)}</b></span>
          <Progress gs={gs} current={step} />
        </div>
        <header className="fs-ihead st-ihead">
          <span className="st-num num" aria-hidden="true">{n}</span>
          <h1 className="fs-ititle">{START_STEP[step].title}</h1>
        </header>
        <p className="fs-ianswer">{START_STEP[step].sub}</p>
        <section className="fs-isec" aria-label={TOUR_W.why}>
          <h2 className="fs-kick">{TOUR_W.why}</h2>
          <p className="st-body">{w.why}</p>
        </section>
        <section className="fs-isec st-do" aria-label={TOUR_W.doIt}>
          <h2 className="fs-kick">{TOUR_W.doIt}</h2>
          <p className="st-quiet">{w.how}</p>
          {step === 'paypal' ? <SecureBody target="credentials" autoOpen={autoOpen} /> : null}
          {step === 'rules' ? <SecureBody target="mandate" autoOpen={autoOpen} /> : null}
          {step === 'practice' ? <PracticeBody autoOpen={autoOpen} /> : null}
          {step === 'engine' ? <EngineBody /> : null}
        </section>
        <footer className="st-pfoot">
          {onBack ? <Btn sm onClick={onBack}>{TOUR_W.back}</Btn> : null}
          <span className="ui-spacer" />
          <Btn sm kind="plain" onClick={onLater} title={TOUR_W.laterTitle}>{TOUR_W.later}</Btn>
          <Btn sm kind="plain" onClick={onSkip} title={TOUR_W.skipTitle}>{TOUR_W.skip}</Btn>
        </footer>
      </div>
    </MotionConfig>
  );
}

/** Done / total as a bar of four, the current step marked; counts come from useStart. */
export function Progress({ gs, current }: { gs: GettingStarted; current: StartStepKey | null }) {
  const calm = useCalm();
  return (
    <div className="st-prog" role="img" aria-label={TOUR_W.setupCount(gs.done, gs.total)}>
      <ol className="st-prog-bar" aria-hidden="true">
        {gs.steps.map((s) => (
          <li key={s.key} className={`st-prog-seg${s.key === current ? ' is-here' : ''}`}>
            <motion.i initial={false} animate={{ scaleX: s.state === 'done' ? 1 : 0 }} transition={tx('slow', calm)} />
          </li>
        ))}
      </ol>
      <span className="st-prog-t num">{TOUR_W.setupCount(gs.done, gs.total)}</span>
    </div>
  );
}

/** Presses `go` once on arrival when asked (?st_open=1). */
function useAutoOpen(autoOpen: boolean, go: () => void) {
  const done = useRef(false);
  const ref = useRef(go);
  ref.current = go;
  useEffect(() => { if (autoOpen && !done.current) { done.current = true; ref.current(); } }, [autoOpen]);
}

/** Keys and rules: one button that brings the approval page's own step up under it. */
function SecureBody({ target, autoOpen }: { target: 'credentials' | 'mandate'; autoOpen: boolean }) {
  const locked = useLocked();
  const [src, setSrc] = useState<string | null>(null);
  const open = () => {
    // The approval page's own first-run tour would start inside the frame, a tour inside the tour:
    // this one already said what it says, so it is closed for this world (reopened by "Take the tour").
    if (target === 'credentials') saveTour('approval', tourEnd('skipped'));
    setSrc(approvalUrl({ target }));
  };
  useAutoOpen(autoOpen, open);
  return (
    <>
      {src ? <p className="st-quiet" role="status">{TOUR_W.secureWaiting}</p> : (
        <div className="fs-acts">
          <Btn kind="gold" locked={locked} onClick={open} title={TOUR_W.secureOpenTitle}>{TOUR_W.secureOpen}</Btn>
        </div>
      )}
      <SecureFrame src={src} />
    </>
  );
}

/** The house seller: the payee and one join (pairing_join "HOUSE", as PairingDesk's house mode does),
 *  then the four words are confirmed in the approval page's pairing step, framed inline. */
function PracticeBody({ autoOpen }: { autoOpen: boolean }) {
  const s = useSettings().data;
  const cps = useQuery('counterparty_list', null, { refreshOn: ['pairing:pinned', 'settings:changed'] });
  const join = useMutation('pairing_join');
  const [payee, setPayee] = useState('');
  const [src, setSrc] = useState<string | null>(null);
  const house = s?.house ?? 'unavailable';
  const connected = !!cps.data?.some((c) => c.house);
  const problem = payeeProblem(payee);
  const ok = canSubmit('house', { payee, code: '' }, house);
  const go = async (who: string) => {
    const r = await join.run({ code: 'HOUSE', side: 'buyer', payee: who.trim(), peer: null });
    if (r) setSrc(approvalUrl({ pairing: r.pairing_id }));
  };
  const submit = (e: FormEvent) => { e.preventDefault(); if (ok && !join.pending) void go(payee); };
  // ?st_open=1 (screenshots): a sample payee, so the confirm step shows.
  useAutoOpen(autoOpen, () => { setPayee(TOUR_W.samplePayee); void go(TOUR_W.samplePayee); });
  return (
    <>
      {src ? <p className="st-quiet" role="status">{TOUR_W.secureWaiting}</p> : (
        <form className="st-house" onSubmit={submit}>
          <label className="st-field">
            <span>{PAIR.paidTo}</span>
            <Field value={payee} onChange={(e) => setPayee(e.target.value)} placeholder={PAIR.paidToPlaceholder} autoComplete="off" spellCheck={false} />
          </label>
          {problem ? <span className="ui-hint" role="alert">{PAIR.payeeProblem[problem]}</span> : null}
          <div className="fs-acts">
            <Btn kind="gold" type="submit" disabled={!ok || join.pending}>{house === 'waking' ? PAIR.wakingDots : connected ? houseWords(true).act : TOUR_W.houseJoin}</Btn>
          </div>
        </form>
      )}
      {join.error ? <WalletNotice error={join.error} what={TOUR_W.houseWhat} /> : null}
      <SecureFrame src={src} />
    </>
  );
}

/** The agent app picker (as the Charter's line IV): engine_status, engine_select. */
function EngineBody() {
  const s = useSettings().data;
  const engines = useQuery('engine_status', null, { refreshOn: ['settings:changed'] });
  const select = useMutation('engine_select');
  const pick = (id: EngineId) => { void select.run({ engine: id }); };
  return (
    <>
      {engines.error ? <WalletNotice error={engines.error} what={NOTICE_WHAT.agentApp} /> : null}
      {select.error ? <WalletNotice error={select.error} what={NOTICE_WHAT.agentApp} /> : null}
      <div className="st-engines" role="radiogroup" aria-label={START_STEP.engine.title}>
        {(engines.data ?? []).filter((e) => e.id !== 'scripted').map((e) => (
          <label key={e.id} className={`st-engine${e.available ? '' : ' is-off'}`}>
            <input type="radio" name="st-engine" value={e.id} checked={s?.selected_engine === e.id} disabled={!e.available || select.pending || !s} onChange={() => pick(e.id)} />
            <b>{e.id}</b>
            <span>{e.available ? CONNECTIONS_ENGINE.chipReady : CONNECTIONS_ENGINE.chipOff}{e.available ? (e.version ? ` · ${e.version}` : '') : e.reason ? ` · ${reasonWords(e.reason)}` : ''}</span>
          </label>
        ))}
      </div>
      <div className="fs-acts">
        <Btn kind="gold" disabled={select.pending || !s} onClick={() => pick('scripted')} title={KEEP_PRACTICE_AGENT.where}>{KEEP_PRACTICE_AGENT.act}</Btn>
      </div>
    </>
  );
}

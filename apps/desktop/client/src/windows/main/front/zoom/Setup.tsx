// spark abstract-first-home, variant "zoom": getting started without leaving the window.
// Stance: KEEP THE WINDOW, OWN THE STORY. The current step IS the depth-0 card.
//   paypal, rules   the card says what happens; its button opens the approval window (approval_open,
//                   through setup/common Handoff, the only door that saves keys or signs rules).
//                   While that window is open the card waits calmly; when useStart re-reads and the
//                   step's fact flips, the card shows a short confirmation and moves on by itself.
//                   If the focus comes back and the step is still open, it says "not finished".
//   practice        the house seller's pairing wizard (PairingDesk) in place; only its final
//                   confirm opens the approval window (as it does everywhere).
//   engine          the agent app picker in place (engine_status / engine_select).
// Order: lib/firstRun START_ORDER (paypal, rules, practice, engine), kept as is: the money path
// (setup/circuit.ts: rules -> keys -> PayPal) must be closed before a practice deal can pay, and the
// practice deal runs on the practice agent, so the agent app (the only step needing an install
// outside the wallet) blocks nothing and goes last.
// Nothing here moves money: approval_open, pairing_* (inside PairingDesk) and engine_select only.
import { useEffect, useRef, useState } from 'react';
import type { EngineId } from '@bindings/EngineId';
import type { GettingStarted, StartStepState } from '../../../../lib/firstRun';
import { useMutation, useQuery } from '../../../../lib/hooks';
import { CONNECTIONS_ENGINE, KEEP_PRACTICE_AGENT, NOTICE_WHAT, reasonWords, START_STEP, type StartStepKey } from '../../../../lib/words';
import { WalletNotice } from '../../../../shared/honesty';
import { Btn, Icon, useToast } from '../../../../shared/ui';
import { PairingDesk } from '../../console/areas/connections/PairingDesk';
import { Handoff } from '../../setup/common';
import type { PairMode } from '../../setup/pairing';
import { useSettings } from '../../world';
import { ZOOM } from './words';
import '../../console/areas/connections.css';

/** As setup/Charter FOCUS_RECHECK_MS: the approval window's own change event arrives within this. */
const FOCUS_RECHECK_MS = 600;
/** How long the "done" confirmation stays before the next step takes the card. */
export const CONFIRM_MS = 2400;

const TARGET: Partial<Record<StartStepKey, 'credentials' | 'mandate'>> = { paypal: 'credentials', rules: 'mandate' };

/** The step the card shows, the step just finished (for its confirmation) and the picker. */
export type SetupFlow = { step: StartStepKey | null; justDone: StartStepKey | null; pick: (k: StartStepKey) => void };

/** Follows the steps: an explicit pick (from the step list at depth 1) wins until it is done; a step
 *  that turns done shows its confirmation for CONFIRM_MS, then the next step takes the card. */
export function useSetupFlow(gs: GettingStarted): SetupFlow {
  // `?zoom_step=practice|engine|...`: a review seam (screenshots) that opens on that step's card.
  const [picked, setPicked] = useState<StartStepKey | null>(() => {
    try { const v = new URLSearchParams(window.location.search).get('zoom_step'); return v === 'paypal' || v === 'rules' || v === 'practice' || v === 'engine' ? v : null; } catch { return null; }
  });
  const [justDone, setJustDone] = useState<StartStepKey | null>(null);
  const prev = useRef<Record<string, StartStepState>>({});
  useEffect(() => {
    const was = prev.current;
    const now: Record<string, StartStepState> = Object.fromEntries(gs.steps.map((s) => [s.key, s.state]));
    prev.current = now;
    const flipped = gs.steps.find((s) => s.state === 'done' && was[s.key] !== undefined && was[s.key] !== 'done' && was[s.key] !== 'unknown');
    if (!flipped) return;
    setJustDone(flipped.key);
    setPicked((p) => (p === flipped.key ? null : p));
  }, [gs.steps]);
  // Its own effect: a re-read of the steps must not cancel the confirmation's timer.
  useEffect(() => {
    if (!justDone) return;
    const t = setTimeout(() => setJustDone((j) => (j === justDone ? null : j)), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [justDone]);
  const pickedState = picked ? gs.steps.find((s) => s.key === picked)?.state : undefined;
  const step = picked && pickedState !== 'done' ? picked : gs.next;
  return { step, justDone, pick: setPicked };
}

export function SetupCard({ gs, flow, locked }: { gs: GettingStarted; flow: SetupFlow; locked: boolean }) {
  const { step, justDone } = flow;
  if (justDone) {
    return (
      <article className="fz-card fz-setup is-done" data-setup-done={justDone} role="status">
        <p className="fz-done"><Icon name="check" size={16} />{START_STEP[justDone].done}</p>
        <p className="fz-line">{START_STEP[justDone].doneLine}</p>
      </article>
    );
  }
  if (!step) {
    return (
      <article className="fz-card fz-setup" data-setup="none">
        {gs.done === gs.total
          ? <><h2 className="fz-card-t">{ZOOM.setupAllDone}</h2><p className="fz-line">{ZOOM.setupAllDoneLine}</p></>
          : <p className="fz-line">{ZOOM.setupChecking}</p>}
      </article>
    );
  }
  const n = gs.steps.find((s) => s.key === step)?.n ?? 1;
  return (
    <article className="fz-card fz-setup" data-setup={step}>
      <p className="fz-kicker">{ZOOM.setupStepOf(n, gs.total)}</p>
      <h2 className="fz-card-t">{START_STEP[step].title}</h2>
      <p className="fz-line">{START_STEP[step].sub}</p>
      {/* Keyed by step: the waiting state of one step never carries over to the next. */}
      {TARGET[step] ? <SecureStep key={step} step={step} target={TARGET[step]!} locked={locked} />
        : step === 'practice' ? <div className="fz-embed setup-sheet"><PracticeDesk /></div>
          : <AgentPick />}
    </article>
  );
}

/** Keys and rules: explain, open the secure window, wait calmly, notice an unfinished return. */
function SecureStep({ step, target, locked }: { step: StartStepKey; target: 'credentials' | 'mandate'; locked: boolean }) {
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'notdone'>('idle');
  useEffect(() => {
    if (phase !== 'waiting') return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const back = () => { t = setTimeout(() => setPhase('notdone'), FOCUS_RECHECK_MS); };
    window.addEventListener('focus', back);
    return () => { window.removeEventListener('focus', back); if (t) clearTimeout(t); };
  }, [phase]);
  const opened = () => setPhase('waiting');
  if (phase === 'waiting') {
    return (
      <>
        <div className="fz-wait" role="status" data-waiting={step}>
          <span className="fz-pulse" aria-hidden="true" />
          <span><b>{ZOOM.setupWaitTitle}</b><span>{ZOOM.setupWaitLine}</span></span>
        </div>
        <div className="fz-acts"><Handoff label={ZOOM.setupReopen} kind="default" sm={false} locked={locked} target={target} onOpened={opened} /></div>
      </>
    );
  }
  return (
    <>
      {phase === 'notdone' ? <div className="fz-wait is-notdone" role="status"><span><b>{ZOOM.setupNotDoneTitle}</b><span>{ZOOM.setupNotDoneLine}</span></span></div> : null}
      <p className="fz-quiet">{START_STEP[step].where}. {ZOOM.setupSecure}</p>
      <div className="fz-acts"><Handoff label={phase === 'notdone' ? ZOOM.setupReopen : START_STEP[step].act} kind="gold" sm={false} locked={locked} target={target} onOpened={opened} /></div>
    </>
  );
}

function PracticeDesk() {
  const [mode, setMode] = useState<PairMode>('house');
  return <PairingDesk mode={mode} setMode={setMode} />;
}

/** The agent app picker, as setup/Charter AgentStep (not exported there; counter-proposal in the
 *  report: export it and drop this copy). Keeping the practice agent is a choice and counts. */
function AgentPick() {
  const s = useSettings().data;
  const toast = useToast();
  const engines = useQuery('engine_status', null, { refreshOn: ['settings:changed'] });
  const select = useMutation('engine_select');
  const pick = async (id: EngineId) => { if ((await select.run({ engine: id })) === null) toast(CONNECTIONS_ENGINE.set(id === 'scripted' ? CONNECTIONS_ENGINE.practiceShort : id), 'ok'); };
  return (
    <div className="fz-engines">
      {engines.error ? <WalletNotice error={engines.error} what={NOTICE_WHAT.agentApp} /> : null}
      {select.error ? <WalletNotice error={select.error} what={NOTICE_WHAT.agentApp} /> : null}
      <div role="radiogroup" aria-label={START_STEP.engine.title} className="fz-engine-list">
        {(engines.data ?? []).filter((e) => e.id !== 'scripted').map((e) => (
          <label key={e.id} className={`fz-engine${e.available ? '' : ' off'}`}>
            <input type="radio" name="fz-engine" value={e.id} checked={s?.selected_engine === e.id} disabled={!e.available || select.pending || !s} onChange={() => void pick(e.id)} />
            <b>{e.id}</b><span>{e.available ? CONNECTIONS_ENGINE.chipReady : CONNECTIONS_ENGINE.chipOff}{e.available ? (e.version ? ` · ${e.version}` : '') : e.reason ? ` · ${reasonWords(e.reason)}` : ''}</span>
          </label>
        ))}
      </div>
      {!engines.data ? <p className="fz-quiet">{engines.loading ? ZOOM.agentLooking : CONNECTIONS_ENGINE.notChecked}</p> : null}
      <div className="fz-acts">
        <Btn kind="gold" disabled={select.pending || !s} onClick={() => void pick('scripted')} title={KEEP_PRACTICE_AGENT.where}>{KEEP_PRACTICE_AGENT.act}</Btn>
        <Btn disabled={engines.loading && !engines.data} onClick={() => void engines.refetch()}>{engines.data ? CONNECTIONS_ENGINE.checkAgain : CONNECTIONS_ENGINE.look}</Btn>
      </div>
    </div>
  );
}

/** The four steps as a list (depth 1 on first run): each a row with its state; a row that is not
 *  done makes that step the card. */
export function SetupSteps({ gs, flow, onPick }: { gs: GettingStarted; flow: SetupFlow; onPick: () => void }) {
  return (
    <ol className="fz-steps" aria-label={ZOOM.setupStepsKicker}>
      {gs.steps.map((s) => {
        const cur = s.key === flow.step;
        return (
          <li key={s.key} className={`fz-step is-${s.state}${cur ? ' is-cur' : ''}`}>
            <button type="button" disabled={s.state === 'done'} aria-current={cur ? 'step' : undefined} title={ZOOM.setupPick}
              onClick={() => { flow.pick(s.key); onPick(); }}>
              <span className="fz-step-n num" aria-hidden="true">{s.state === 'done' ? <Icon name="check" size={12} /> : s.n}</span>
              <span className="fz-step-t"><b>{s.state === 'done' ? START_STEP[s.key].done : START_STEP[s.key].title}</b><span>{s.state === 'done' ? START_STEP[s.key].doneLine : START_STEP[s.key].sub}</span></span>
              <span className={`fz-step-s is-${s.state}`}>{ZOOM.setupState[s.state]}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

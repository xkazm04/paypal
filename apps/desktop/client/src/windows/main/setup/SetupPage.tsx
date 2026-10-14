// The in-app Set up page (calm-nested-ui): the five steps of getting started, one at a time, so
// onboarding never feels like leaving The Table. Each step says what it is in two lines, shows its
// state and holds ONE primary button.
//   keys, rules, unlock   hand off to the approval window (approval_open with a target, via Handoff);
//                         Main never stores, signs or unlocks. While that window is open the page waits
//                         and moves on by itself once the step's own state turns done
//                         (settings:changed, mandate_list, the idle-lock state).
//   practice              the existing pairing wizard (PairingDesk) stays here in Main; only its final
//                         confirm hands off. Done on pairing:pinned (counterparty_list).
//   agent                 the engine picker here in Main (engine_status, engine_select).
// The approval window reports nothing back when it is closed, so a step the owner left unfinished is
// noticed when The Table gets the focus again: it reads "not finished" with a Reopen button.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { EngineId } from '@bindings/EngineId';
import { useMutation, useQuery } from '../../../lib/hooks';
import {
  KEEP_PRACTICE_AGENT, SETUP_ALL_DONE, SETUP_FINISH, SETUP_NEXT, SETUP_NOT_DONE, SETUP_PAGE_TITLE, SETUP_STEP_COPY, SETUP_STEP_LABEL, SETUP_WAITING, START_STEP,
} from '../../../lib/words';
import { WalletNotice } from '../../../shared/honesty';
import { Btn, Chip, Icon, PageHead, Stepper, useToast } from '../../../shared/ui';
import { useStart } from '../home/Start';
import { SETUP_STEPS, type SetupStep } from '../logic';
import { useWorld } from '../world';
import { Handoff } from './common';
import { PairingDesk } from './PairingDesk';
import type { PairMode } from './pairing';
import './setup-page.css';

type Done = Record<SetupStep, boolean | null>;
const HANDOFF: Partial<Record<SetupStep, 'credentials' | 'mandate' | 'unlock'>> = { keys: 'credentials', rules: 'mandate', unlock: 'unlock' };

/** Which steps are finished, from the same facts as Home's start card (null = not read yet). */
export function useSetupDone(): Done {
  const w = useWorld();
  const gs = useStart();
  const of = (k: 'paypal' | 'rules' | 'practice' | 'engine'): boolean | null => {
    const st = gs.steps.find((x) => x.key === k)?.state;
    return st === undefined || st === 'unknown' ? null : st === 'done';
  };
  return { keys: of('paypal'), rules: of('rules'), practice: of('practice'), agent: of('engine'), unlock: w.settings.data ? !w.locked : null };
}

export function SetupPage({ step, onStep, onDone }: { step: SetupStep; onStep: (s: SetupStep) => void; onDone: () => void }) {
  const w = useWorld();
  const done = useSetupDone();
  const at = SETUP_STEPS.indexOf(step);
  const last = at === SETUP_STEPS.length - 1;
  const nextStep = SETUP_STEPS[at + 1];
  const [opened, setOpened] = useState<SetupStep | null>(null);
  const [closed, setClosed] = useState<SetupStep | null>(null);
  const isDone = done[step] === true;

  // The page moves on by itself when the step it shows turns done (never for a step that was done on arrival).
  const seen = useRef<{ step: SetupStep; done: boolean | null }>({ step, done: done[step] });
  useEffect(() => {
    const was = seen.current;
    seen.current = { step, done: done[step] };
    if (was.step === step && was.done === false && done[step] === true) {
      setOpened(null);
      setClosed(null);
      if (nextStep) onStep(nextStep);
    }
  }, [step, done, nextStep, onStep]);
  useEffect(() => { setOpened(null); setClosed(null); }, [step]);

  // The approval window gave the focus back without finishing: say so, and offer to reopen it.
  useEffect(() => {
    if (opened === null) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const back = () => { t = setTimeout(() => { setClosed(opened); setOpened(null); }, 600); };
    window.addEventListener('focus', back);
    return () => { window.removeEventListener('focus', back); if (t) clearTimeout(t); };
  }, [opened]);

  const doneKeys = SETUP_STEPS.filter((k) => done[k] === true);
  const copy = SETUP_STEP_COPY[step];
  const target = HANDOFF[step];
  const waiting = opened === step && !isDone;
  const notDone = closed === step && !isDone;
  const opening = useCallback(() => { setOpened(step); setClosed(null); }, [step]);
  const open = (label: string, kind: 'gold' | 'default') => target
    ? <Handoff label={label} kind={kind} sm={false} locked={w.locked} target={target} onOpened={opening} />
    : null;

  let body: ReactNode;
  if (isDone) {
    body = (
      <>
        <p className="sp-done"><Icon name="check" size={14} />{copy.done}</p>
        <div className="sp-acts">
          {nextStep ? <Btn kind="gold" onClick={() => onStep(nextStep)}>{SETUP_NEXT}</Btn> : <Btn kind="gold" onClick={onDone}>{SETUP_FINISH}</Btn>}
        </div>
      </>
    );
  } else if (waiting) {
    body = (
      <>
        <div className="sp-wait" role="status"><b>{SETUP_WAITING.title}</b><span>{SETUP_WAITING.text}</span></div>
        <div className="sp-acts">{open(SETUP_WAITING.reopen, 'default')}</div>
      </>
    );
  } else if (step === 'practice') {
    body = <PracticeStep />;
  } else if (step === 'agent') {
    body = <AgentStep />;
  } else {
    body = (
      <>
        {notDone ? <div className="sp-wait notdone" role="status"><b>{SETUP_NOT_DONE.title}</b><span>{SETUP_NOT_DONE.text}</span></div> : null}
        <div className="sp-acts">{open(notDone ? SETUP_WAITING.reopen : copy.act, 'gold')}{last ? <Btn onClick={onDone}>{SETUP_FINISH}</Btn> : null}</div>
      </>
    );
  }

  const state = isDone ? 'done' : waiting ? 'waiting' : 'current';
  return (
    <div className="setup-page">
      <PageHead title={SETUP_PAGE_TITLE} focusKey="setup" sub={`${doneKeys.length} of ${SETUP_STEPS.length} done`} />
      <Stepper steps={SETUP_STEPS.map((k) => ({ key: k, label: SETUP_STEP_LABEL[k] }))} current={step} done={doneKeys} onSelect={onStep} />
      <section className={`sp-card ${state}`} aria-labelledby="sp-lead" data-tour={`setup-${step}`}>
        <div className="sp-head">
          <h2 id="sp-lead">{copy.lead}</h2>
          <Chip tone={isDone ? 'teal' : waiting ? 'gold' : 'dashed'}>{isDone ? 'done' : waiting ? 'waiting' : 'to do'}</Chip>
        </div>
        <p className="sp-text">{copy.text}</p>
        {body}
        {last && doneKeys.length === SETUP_STEPS.length ? <p className="sp-all">{SETUP_ALL_DONE}</p> : null}
      </section>
    </div>
  );
}

/** Step 3 stays in Main: the house seller's pairing wizard. Only its confirm opens the approval window. */
function PracticeStep() {
  const [mode, setMode] = useState<PairMode>('house');
  return <div className="setup-sheet sp-embed"><PairingDesk mode={mode} setMode={setMode} /></div>;
}

/** Step 4 stays in Main: the agent app picker. Keeping the practice agent is a choice and counts. */
function AgentStep() {
  const w = useWorld();
  const s = w.settings.data;
  const toast = useToast();
  const engines = useQuery('engine_status', null, { refreshOn: ['settings:changed'] });
  const select = useMutation('engine_select');
  const pick = async (id: EngineId) => { if ((await select.run({ engine: id })) === null) toast(<>Agent app set to <b>{id === 'scripted' ? 'practice agent' : id}</b>.</>, 'ok'); };
  return (
    <div className="sp-engines">
      {engines.error ? <WalletNotice error={engines.error} what="Agent app" /> : null}
      {select.error ? <WalletNotice error={select.error} what="Agent app" /> : null}
      <div role="radiogroup" aria-label={START_STEP.engine.title}>
        {(engines.data ?? []).filter((e) => e.id !== 'scripted').map((e) => (
          <label key={e.id} className={`sp-engine${e.available ? '' : ' off'}`}>
            <input type="radio" name="sp-engine" value={e.id} checked={s?.selected_engine === e.id} disabled={!e.available || select.pending || !s} onChange={() => void pick(e.id)} />
            <b>{e.id}</b><span>{e.available ? `ready${e.version ? ` · ${e.version}` : ''}` : `not connected${e.reason ? ` · ${e.reason}` : ''}`}</span>
          </label>
        ))}
      </div>
      {!engines.data ? <p className="dim">{engines.loading ? 'Looking for agent apps…' : 'not checked yet'}</p> : null}
      <div className="sp-acts">
        <Btn kind="gold" disabled={select.pending || !s} onClick={() => void pick('scripted')} title={KEEP_PRACTICE_AGENT.where}>{KEEP_PRACTICE_AGENT.act}</Btn>
        <Btn disabled={engines.loading && !engines.data} onClick={() => void engines.refetch()}>{engines.data ? 'Check again' : 'Look for agent apps'}</Btn>
      </div>
    </div>
  );
}

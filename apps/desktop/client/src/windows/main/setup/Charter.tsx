// The Charter: the Set up layer of the console (it replaces the Set up page). Five numbered lines
// the owner signs, one at a time: the current line's explanation and its ONE action on the left,
// the five lines with their state on the right. On a brand-new wallet it is the console's first
// layer (in place of the decision centre); later it is reachable from Settings and Find (#s=setup).
//   keys, rules, unlock   hand off to the approval window (approval_open with the same targets as
//                         before, via Handoff); Main never stores, signs or unlocks. While that
//                         window is open the line waits and moves on by itself once its own state
//                         turns done; when the window gives the focus back unfinished, the line
//                         says "not finished" with a Reopen button.
//   practice              the pairing wizard (PairingDesk) stays here in Main; only its final
//                         confirm hands off. Done on pairing:pinned (counterparty_list).
//   agent                 the agent app picker here in Main (engine_status, engine_select).
import { NOTICE_WHAT } from '../../../lib/words';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { EngineId } from '@bindings/EngineId';
import { useMutation, useQuery } from '../../../lib/hooks';
import { backend } from '../../../lib/runtime';
import { FIRST_RUN_PARAM } from '../../../lib/preview';
import {
  CHARTER_IN_APPROVAL, CHARTER_MEANS_APPROVAL, CHARTER_MEANS_TITLE, CHARTER_NUMERAL, CHARTER_SEALED, CHARTER_SKIP, CHARTER_SKIP_TITLE, CHARTER_STATE, CHARTER_TITLE,
  charterDone, charterLine, charterPreview, charterReads, KEEP_PRACTICE_AGENT, reasonWords, SAFETY_PROMISE, SETUP_ALL_DONE, SETUP_FINISH, SETUP_NEXT, SETUP_NOT_DONE, SETUP_STEP_COPY, SETUP_STEP_LABEL, SETUP_WAITING, START_STEP,
} from '../../../lib/words';
import { WalletNotice } from '../../../shared/honesty';
import { TakeTour, Tour } from '../../../shared/tour';
import { Btn, Chip, Icon, useToast } from '../../../shared/ui';
import { SETUP_STEPS, type SetupStep } from '../logic';
import { useLocked, useSettings } from '../world';
import { Handoff } from './common';
import { PairingDesk } from '../console/areas/connections/PairingDesk';
import type { PairMode } from './pairing';
import { useStart } from './start';
import './charter.css';

type Done = Record<SetupStep, boolean | null>;
/** The privileged lines and the approval window's page each opens (the Set up page's targets). */
export const HANDOFF: Partial<Record<SetupStep, 'credentials' | 'mandate' | 'unlock'>> = { keys: 'credentials', rules: 'mandate', unlock: 'unlock' };

/** How long after the window gets the focus back a line still waiting is called "not finished":
 *  the approval window's own change event, if it finished, arrives within this time. */
export const FOCUS_RECHECK_MS = 600;

/** Which lines are signed, from the same facts as the getting-started path (null = not read yet). */
export function useSetupDone(): Done {
  const locked = useLocked();
  const settings = useSettings().data;
  const gs = useStart();
  const of = (k: 'paypal' | 'rules' | 'practice' | 'engine'): boolean | null => {
    const st = gs.steps.find((x) => x.key === k)?.state;
    return st === undefined || st === 'unknown' ? null : st === 'done';
  };
  return { keys: of('paypal'), rules: of('rules'), practice: of('practice'), agent: of('engine'), unlock: settings ? !locked : null };
}

/** The first line not signed yet (the last when every line is signed). */
export const firstOpenLine = (done: Done): SetupStep => SETUP_STEPS.find((k) => done[k] !== true) ?? 'unlock';

/** The line's one-line explanation: the first sentence of its copy. */
const firstSentence = (t: string): string => { const i = t.indexOf('. '); return i < 0 ? t : t.slice(0, i + 1); };

export function Charter({ step: asked, onStep, onDone, root, seal }: {
  /** The line to show; null = the first one not signed yet. */
  step: SetupStep | null;
  onStep: (s: SetupStep) => void;
  onDone: () => void;
  /** The Charter is the console's first layer (a brand-new wallet): the tour and, in a preview, Skip. */
  root?: boolean;
  /** The wallet's seal, shown beside the current line when the Charter stands in for the centre. */
  seal?: ReactNode;
}) {
  const locked = useLocked();
  const done = useSetupDone();
  const gs = useStart();
  const step = asked ?? firstOpenLine(done);
  const at = SETUP_STEPS.indexOf(step);
  const nextStep = SETUP_STEPS[at + 1];
  const [opened, setOpened] = useState<SetupStep | null>(null);
  const [closed, setClosed] = useState<SetupStep | null>(null);
  const isDone = done[step] === true;
  const doneKeys = SETUP_STEPS.filter((k) => done[k] === true);
  const all = doneKeys.length === SETUP_STEPS.length;

  // The line moves on by itself when the one it shows turns done (never for a line done on arrival).
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
    const back = () => { t = setTimeout(() => { setClosed(opened); setOpened(null); }, FOCUS_RECHECK_MS); };
    window.addEventListener('focus', back);
    return () => { window.removeEventListener('focus', back); if (t) clearTimeout(t); };
  }, [opened]);

  const copy = SETUP_STEP_COPY[step];
  const target = HANDOFF[step];
  const waiting = opened === step && !isDone;
  const notDone = closed === step && !isDone;
  const opening = useCallback(() => { setOpened(step); setClosed(null); }, [step]);
  const open = (label: string, kind: 'gold' | 'default') => target
    ? <Handoff label={label} kind={kind} sm={false} locked={locked} target={target} onOpened={opening} />
    : null;

  let body: ReactNode;
  if (isDone) {
    body = (
      <>
        <p className="ch-done"><Icon name="check" size={14} />{copy.done}</p>
        <div className="cs-acts">{nextStep && !all ? <Btn kind="gold" onClick={() => onStep(nextStep)}>{SETUP_NEXT}</Btn> : <Btn kind="gold" onClick={onDone}>{SETUP_FINISH}</Btn>}</div>
      </>
    );
  } else if (waiting) {
    body = (
      <>
        <div className="ch-wait" role="status"><b>{SETUP_WAITING.title}</b><span>{SETUP_WAITING.text}</span></div>
        <div className="cs-acts">{open(SETUP_WAITING.reopen, 'default')}</div>
      </>
    );
  } else if (step === 'practice') {
    body = <PracticeStep />;
  } else if (step === 'agent') {
    body = <AgentStep />;
  } else {
    body = (
      <>
        {notDone ? <div className="ch-wait notdone" role="status"><b>{SETUP_NOT_DONE.title}</b><span>{SETUP_NOT_DONE.text}</span></div> : null}
        <div className="cs-acts">{open(notDone ? SETUP_WAITING.reopen : copy.act, 'gold')}</div>
      </>
    );
  }

  const numeral = CHARTER_NUMERAL[at] ?? 'I';
  const preview = backend().kind === 'mock';
  return (
    <div className="cs-charter">
      <div className="ch-l" data-tour="start-hub">
        {all ? (
          <>
            <p className="kicker">{CHARTER_SEALED.kicker}</p>
            <h1 className="display cs-title" tabIndex={-1} data-layer-title="">{CHARTER_SEALED.title}</h1>
            <p className="ch-sub">{SETUP_ALL_DONE}</p>
            <div className="cs-acts"><Btn kind="gold" onClick={onDone}>{SETUP_FINISH}</Btn></div>
          </>
        ) : (
          <>
            <div className={`ch-now${seal ? ' has-seal' : ''}`}>
              <div className="ch-text">
                <p className="kicker">{CHARTER_TITLE} · {charterLine(numeral)}</p>
                <h1 className="display cs-title" tabIndex={-1} data-layer-title="">{copy.lead}</h1>
                <div className="ch-say">
                  <p className="ch-sub">{copy.text}</p>
                  <section className={`ch-body ${isDone ? 'done' : waiting ? 'waiting' : ''}`} aria-label={copy.lead} data-tour={`setup-${step}`}>{body}</section>
                </div>
              </div>
              {seal ? <div className="ch-seal">{seal}</div> : null}
            </div>
            {step !== 'practice' ? (
              <section className={`ch-preview${isDone ? ' done' : ''}`} aria-label={isDone ? charterReads(numeral) : charterPreview(numeral)}>
                <h2 className="cs-h3">{isDone ? charterReads(numeral) : charterPreview(numeral)}</h2>
                <p><span className="num" aria-hidden="true">{numeral}</span><span className="lbl">{SETUP_STEP_LABEL[step]}</span><span className="val">{copy.done}</span></p>
              </section>
            ) : null}
          </>
        )}
        <section className="ch-note" aria-label={CHARTER_MEANS_TITLE}>
          <h2 className="cs-h3">{CHARTER_MEANS_TITLE}</h2>
          <ul>
            <li><i className="led gold" aria-hidden="true" />{charterDone(doneKeys.length, SETUP_STEPS.length)}</li>
            <li><i className="led teal" aria-hidden="true" />{CHARTER_MEANS_APPROVAL}</li>
            <li data-tour="safety-promise"><i className="led ok" aria-hidden="true" />{SAFETY_PROMISE}</li>
          </ul>
          {root ? <TakeTour win="main" gs={gs} className="ch-tour" /> : null}
          {root && preview ? <p className="ch-skip"><button type="button" className="linkbtn" title={CHARTER_SKIP_TITLE} onClick={skipToSample}>{CHARTER_SKIP}</button></p> : null}
        </section>
      </div>
      <div className="ch-r">
        <h2 className="cs-h3">{CHARTER_TITLE}</h2>
        <ol className="ch-fields" data-tour="start-steps" aria-label={CHARTER_TITLE}>
          {SETUP_STEPS.map((k, i) => {
            const state = done[k] === true ? 'done' : done[k] === null ? 'unknown' : opened === k ? 'waiting' : 'todo';
            return (
              <li key={k} className={`${state}${k === step ? ' cur' : ''}`} data-tour={k === 'agent' ? 'step-engine' : undefined}>
                <button type="button" onClick={() => onStep(k)} aria-current={k === step ? 'step' : undefined}>
                  <span className="num" aria-hidden="true">{CHARTER_NUMERAL[i]}</span>
                  <span className="txt">
                    <span className="lbl">{SETUP_STEP_LABEL[k]}{HANDOFF[k] ? <span className="priv"> · {CHARTER_IN_APPROVAL}</span> : null}</span>
                    <span className="ex">{firstSentence(SETUP_STEP_COPY[k].text)}</span>
                  </span>
                  <Chip tone={state === 'done' ? 'teal' : state === 'waiting' ? 'gold' : 'dashed'}>{CHARTER_STATE[state]}</Chip>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      {root ? <Tour win="main" gs={gs} firstRun={gs.show} /> : null}
    </div>
  );
}

/** Preview only: leave the brand-new wallet for the sample wallet, which is already set up. */
function skipToSample(): void {
  const q = new URLSearchParams(location.search);
  q.delete(FIRST_RUN_PARAM);
  const s = q.toString();
  location.assign(`${location.pathname}${s ? `?${s}` : ''}`);
}

/** Line III stays in Main: the house seller's pairing wizard. Only its confirm opens the approval window. */
function PracticeStep() {
  const [mode, setMode] = useState<PairMode>('house');
  return <div className="setup-sheet ch-embed"><PairingDesk mode={mode} setMode={setMode} /></div>;
}

/** Line IV stays in Main: the agent app picker. Keeping the practice agent is a choice and counts. */
function AgentStep() {
  const s = useSettings().data;
  const toast = useToast();
  const engines = useQuery('engine_status', null, { refreshOn: ['settings:changed'] });
  const select = useMutation('engine_select');
  const pick = async (id: EngineId) => { if ((await select.run({ engine: id })) === null) toast(<>Agent app set to <b>{id === 'scripted' ? 'practice agent' : id}</b>.</>, 'ok'); };
  return (
    <div className="ch-engines">
      {engines.error ? <WalletNotice error={engines.error} what={NOTICE_WHAT.agentApp} /> : null}
      {select.error ? <WalletNotice error={select.error} what={NOTICE_WHAT.agentApp} /> : null}
      <div role="radiogroup" aria-label={START_STEP.engine.title}>
        {(engines.data ?? []).filter((e) => e.id !== 'scripted').map((e) => (
          <label key={e.id} className={`ch-engine${e.available ? '' : ' off'}`}>
            <input type="radio" name="ch-engine" value={e.id} checked={s?.selected_engine === e.id} disabled={!e.available || select.pending || !s} onChange={() => void pick(e.id)} />
            <b>{e.id}</b><span>{e.available ? `ready${e.version ? ` · ${e.version}` : ''}` : `not connected${e.reason ? ` · ${reasonWords(e.reason)}` : ''}`}</span>
          </label>
        ))}
      </div>
      {!engines.data ? <p className="dim">{engines.loading ? 'Looking for agent apps…' : 'not checked yet'}</p> : null}
      <div className="cs-acts">
        <Btn kind="gold" disabled={select.pending || !s} onClick={() => void pick('scripted')} title={KEEP_PRACTICE_AGENT.where}>{KEEP_PRACTICE_AGENT.act}</Btn>
        <Btn disabled={engines.loading && !engines.data} onClick={() => void engines.refetch()}>{engines.data ? 'Check again' : 'Look for agent apps'}</Btn>
      </div>
    </div>
  );
}

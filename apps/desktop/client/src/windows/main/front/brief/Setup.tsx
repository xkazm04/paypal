// spark abstract-first-home, variant "brief": getting started as two brief items, TRY FIRST, SIGN LAST.
//   Try it first   engine, then practice - both inline, in this window. The engine picker is the
//                  Charter's AgentStep (engine_status + engine_select, copied: it is not exported);
//                  the practice shop is the shared PairingDesk in house mode (its own confirm hands
//                  off to the approval window, as it does in the Charter).
//   Make it real   rules, then keys. Says what the secure window is BEFORE opening it
//                  (approval_open), then waits until useStart reports the step done.
// The home is never swapped for the console. Nothing here moves money.
import { useEffect, useState } from 'react';
import type { EngineId } from '@bindings/EngineId';
import type { StartStepKey } from '../../../../lib/words';
import { useMutation, useQuery } from '../../../../lib/hooks';
import { CONNECTIONS_ENGINE, KEEP_PRACTICE_AGENT, NOTICE_WHAT, reasonWords, START_STEP } from '../../../../lib/words';
import { WalletNotice } from '../../../../shared/honesty';
import { Btn, Icon, useToast } from '../../../../shared/ui';
import { PairingDesk } from '../../console/areas/connections/PairingDesk';
import type { PairMode } from '../../setup/pairing';
import { useStart } from '../../setup/start';
import { useLocked, useSettings } from '../../world';
import { FB } from './words';
import '../../console/areas/connections.css';

type StepState = 'done' | 'now' | 'later';

/** The state of each getting-started step, in this variant's order (try first, sign last). */
export function useBriefSetup() {
  const gs = useStart();
  const of = (k: StartStepKey): boolean => gs.steps.find((s) => s.key === k)?.state === 'done';
  const engine = of('engine');
  const practice = of('practice');
  const rules = of('rules');
  const paypal = of('paypal');
  return { show: gs.show, engine, practice, rules, paypal, tryDone: engine && practice, realDone: rules && paypal };
}

function StepRow({ n, title, sub, state, children }: { n: number; title: string; sub: string; state: StepState; children?: React.ReactNode }) {
  return (
    <li className={`fb-step ${state}`} aria-current={state === 'now' ? 'step' : undefined}>
      <span className="fb-step-n" aria-hidden="true">{state === 'done' ? <Icon name="check" size={12} /> : n}</span>
      <div className="fb-step-b">
        <div className="fb-step-h"><b>{title}</b><span className="fb-step-st">{state === 'done' ? FB.try.stepDone : state === 'now' ? FB.try.stepNow : FB.try.stepLater}</span></div>
        {state !== 'done' ? <p className="fb-quiet">{sub}</p> : null}
        {state === 'now' ? children : null}
      </div>
    </li>
  );
}

export function TryDetail() {
  const s = useBriefSetup();
  const [mode, setMode] = useState<PairMode>('house');
  const engineState: StepState = s.engine ? 'done' : 'now';
  const practiceState: StepState = s.practice ? 'done' : s.engine ? 'now' : 'later';
  return (
    <ol className="fb-steps">
      <StepRow n={1} title={FB.try.engineTitle} sub={FB.try.engineSub} state={engineState}><EnginePick /></StepRow>
      <StepRow n={2} title={FB.try.practiceTitle} sub={FB.try.practiceSub} state={practiceState}>
        <p className="fb-quiet fb-honest">{FB.try.practiceHonest}</p>
        <div className="fb-embed"><PairingDesk mode={mode} setMode={setMode} /></div>
      </StepRow>
    </ol>
  );
}

/** The agent app picker (as setup/Charter.tsx AgentStep). Keeping the practice agent is a choice and counts. */
function EnginePick() {
  const s = useSettings().data;
  const toast = useToast();
  const engines = useQuery('engine_status', null, { refreshOn: ['settings:changed'] });
  const select = useMutation('engine_select');
  const pick = async (id: EngineId) => { if ((await select.run({ engine: id })) === null) toast(CONNECTIONS_ENGINE.set(id === 'scripted' ? CONNECTIONS_ENGINE.practiceShort : id), 'ok'); };
  return (
    <div className="fb-engines">
      {engines.error ? <WalletNotice error={engines.error} what={NOTICE_WHAT.agentApp} /> : null}
      {select.error ? <WalletNotice error={select.error} what={NOTICE_WHAT.agentApp} /> : null}
      <div role="radiogroup" aria-label={START_STEP.engine.title} className="fb-engine-list">
        {(engines.data ?? []).filter((e) => e.id !== 'scripted').map((e) => (
          <label key={e.id} className={`fb-engine${e.available ? '' : ' off'}`}>
            <input type="radio" name="fb-engine" value={e.id} checked={s?.selected_engine === e.id} disabled={!e.available || select.pending || !s} onChange={() => void pick(e.id)} />
            <b>{e.id}</b><span className="fb-quiet">{e.available ? CONNECTIONS_ENGINE.chipReady : CONNECTIONS_ENGINE.chipOff}{e.available ? (e.version ? ` · ${e.version}` : '') : e.reason ? ` · ${reasonWords(e.reason)}` : ''}</span>
          </label>
        ))}
      </div>
      {!engines.data ? <p className="fb-quiet">{engines.loading ? CONNECTIONS_ENGINE.looking : CONNECTIONS_ENGINE.notChecked}</p> : null}
      <div className="fb-acts">
        <Btn kind="gold" disabled={select.pending || !s} onClick={() => void pick('scripted')} title={KEEP_PRACTICE_AGENT.where}>{KEEP_PRACTICE_AGENT.act}</Btn>
      </div>
    </div>
  );
}

export function RealDetail() {
  const s = useBriefSetup();
  const locked = useLocked();
  const open = useMutation('approval_open');
  const [opened, setOpened] = useState<'rules' | 'paypal' | null>(null);
  // Rules first (they decide what may ever be paid), then the keys.
  const current: 'rules' | 'paypal' | null = !s.rules ? 'rules' : !s.paypal ? 'paypal' : null;
  // The wait resolves by itself when useStart reports the step done.
  useEffect(() => { if (opened && opened !== current) setOpened(null); }, [opened, current]);
  const go = async (step: 'rules' | 'paypal') => {
    setOpened(step);
    await open.run({ deal_id: null, target: step === 'rules' ? 'mandate' : 'credentials' });
  };
  const rows: { key: 'rules' | 'paypal'; n: number }[] = [{ key: 'rules', n: 1 }, { key: 'paypal', n: 2 }];
  return (
    <ol className="fb-steps">
      {rows.map(({ key, n }) => {
        const state: StepState = s[key] ? 'done' : current === key ? 'now' : 'later';
        return (
          <StepRow key={key} n={n} title={START_STEP[key].title} sub={START_STEP[key].sub} state={state}>
            {opened === key ? (
              <div className="fb-wait" role="status">
                <span className="fb-spin" aria-hidden="true" />
                <div><b>{FB.real.waiting}</b><p className="fb-quiet">{FB.real.waitingSub}</p></div>
                <Btn sm locked={locked} disabled={open.pending} onClick={() => void go(key)}>{FB.real.reopen}</Btn>
              </div>
            ) : (
              <>
                <p className="fb-explain">{FB.real.explain}</p>
                <div className="fb-acts"><Btn kind="gold" locked={locked} disabled={open.pending} title={START_STEP[key].where} onClick={() => void go(key)}>{FB.real.go(START_STEP[key].act)}</Btn></div>
              </>
            )}
            {open.error ? <WalletNotice error={open.error} what={START_STEP[key].act} /> : null}
          </StepRow>
        );
      })}
    </ol>
  );
}

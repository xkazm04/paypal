// Set up together: each getting-started step as a card inside the conversation, never a swap of the
// home for the console. What stays honest in this prototype:
//   paypal    the secret is typed into a Rust-owned native dialog; the mock's set_credentials is
//             privileged (approval label + session token), so the card's button is approval_open
//             ('credentials') and says so. The window closes by itself when the dialog is done.
//   rules     the sentence, its reading and the limits happen here (SayIt, no model); the signature
//             is mandate_sign, privileged the same way, so the button hands a typed draft to the
//             approval window (approval_open with the draft, as SayIt already does).
//   practice  the house seller's pairing wizard, inline (PairingDesk); only its confirm hands off.
//   engine    the agent app picker, inline (engine_status / engine_select, a main command).
import { useEffect, useState } from 'react';
import type { EngineId } from '@bindings/EngineId';
import { useMutation, useQuery } from '../../../../lib/hooks';
import { CONNECTIONS_ENGINE, KEEP_PRACTICE_AGENT, NOTICE_WHAT, reasonWords, START_STEP, type StartStepKey } from '../../../../lib/words';
import { SAY } from '../../../../lib/words/say';
import { sayState, saySet } from '../../../../lib/say/store';
import type { GettingStarted } from '../../../../lib/firstRun';
import { WalletNotice } from '../../../../shared/honesty';
import { StartSteps } from '../../../../shared/start';
import { Btn, Icon } from '../../../../shared/ui';
import { PairingDesk } from '../../console/areas/connections/PairingDesk';
import type { PairMode } from '../../setup/pairing';
import { SayIt } from '../../setup/SayIt';
import { useLocked, useSettings } from '../../world';
import { GREET } from './words';
import '../../console/areas/connections.css';

function ProtoTag() {
  return <span className="fs-proto" data-proto>{GREET.protoTag}</span>;
}

/** One step's card. `done` folds it to one line; `current` is the step the conversation is on. */
export function SetupCard({ step, done, onOpened, opened }: { step: StartStepKey; done: boolean; opened: boolean; onOpened: () => void }) {
  if (done) {
    return (
      <div className="fs-step is-done" data-step={step} data-state="done">
        <span className="fs-step-mark" aria-hidden="true"><Icon name="check" size={13} /></span>
        <span>{START_STEP[step].done}</span>
      </div>
    );
  }
  return (
    <div className="fs-step" data-step={step} data-state="todo">
      {step === 'paypal' ? <KeysStep opened={opened} onOpened={onOpened} /> : null}
      {step === 'rules' ? <RulesStep opened={opened} onOpened={onOpened} /> : null}
      {step === 'practice' ? <PracticeStep /> : null}
      {step === 'engine' ? <EngineStep /> : null}
    </div>
  );
}

/** A sheet inside the main window drawn like the secure step (sealed edge, prototype tag). */
function SecureSheet({ lead, note, children }: { lead: string; note: string; children: React.ReactNode }) {
  return (
    <div className="fs-secure">
      <div className="fs-secure-h"><b>{lead}</b><ProtoTag /></div>
      {children}
      <p className="fs-quiet">{note}</p>
    </div>
  );
}

function KeysStep({ opened, onOpened }: { opened: boolean; onOpened: () => void }) {
  const open = useMutation('approval_open');
  const locked = useLocked();
  const go = async () => { if ((await open.run({ deal_id: null, target: 'credentials' })) === null) onOpened(); };
  return (
    <SecureSheet lead={GREET.keysLead} note={GREET.keysNote}>
      <p className="fs-body">{GREET.keysBody}</p>
      <p className="fs-quiet">{GREET.keysSecret}</p>
      <div className="fs-acts">
        <Btn kind="gold" locked={locked} disabled={open.pending} onClick={() => void go()} title={START_STEP.paypal.where}>{GREET.keysAct}</Btn>
        {opened ? <span className="fs-quiet" role="status">{GREET.waiting}</span> : null}
      </div>
      {open.error ? <WalletNotice error={open.error} what={NOTICE_WHAT.approval} /> : null}
    </SecureSheet>
  );
}

function RulesStep({ opened, onOpened }: { opened: boolean; onOpened: () => void }) {
  // Start from a sentence the reader always reads, so the limits show at once (she changes it freely).
  useEffect(() => { if (!sayState().text) saySet(SAY.tryLines[1]); }, []);
  return (
    <SecureSheet lead={GREET.rulesLead} note={GREET.sealNote}>
      <p className="fs-body">{GREET.rulesBody}</p>
      <SayIt compact stepGold onOpened={onOpened} className="fs-say" />
      {opened ? <p className="fs-quiet" role="status">{GREET.waiting}</p> : null}
    </SecureSheet>
  );
}

function PracticeStep() {
  const [mode, setMode] = useState<PairMode>('house');
  return (
    <div className="fs-embed">
      <p className="fs-body">{GREET.practiceBody}</p>
      <PairingDesk mode={mode} setMode={setMode} />
    </div>
  );
}

/** The agent app picker (the Charter's line IV, drawn for the conversation). */
function EngineStep() {
  const s = useSettings().data;
  const engines = useQuery('engine_status', null, { refreshOn: ['settings:changed'] });
  const select = useMutation('engine_select');
  const pick = (id: EngineId) => { void select.run({ engine: id }); };
  return (
    <div className="fs-embed">
      <p className="fs-body">{GREET.engineBody}</p>
      {engines.error ? <WalletNotice error={engines.error} what={NOTICE_WHAT.agentApp} /> : null}
      {select.error ? <WalletNotice error={select.error} what={NOTICE_WHAT.agentApp} /> : null}
      <div className="fs-engines" role="radiogroup" aria-label={START_STEP.engine.title}>
        {(engines.data ?? []).filter((e) => e.id !== 'scripted').map((e) => (
          <label key={e.id} className={`fs-engine${e.available ? '' : ' off'}`}>
            <input type="radio" name="fs-engine" value={e.id} checked={s?.selected_engine === e.id} disabled={!e.available || select.pending || !s} onChange={() => pick(e.id)} />
            <b>{e.id}</b>
            <span>{e.available ? CONNECTIONS_ENGINE.chipReady : CONNECTIONS_ENGINE.chipOff}{e.available ? (e.version ? ` · ${e.version}` : '') : e.reason ? ` · ${reasonWords(e.reason)}` : ''}</span>
          </label>
        ))}
      </div>
      {!engines.data ? <p className="fs-quiet">{GREET.engineLooking}</p> : null}
      <div className="fs-acts">
        <Btn kind="gold" disabled={select.pending || !s} onClick={() => pick('scripted')} title={KEEP_PRACTICE_AGENT.where}>{KEEP_PRACTICE_AGENT.act}</Btn>
      </div>
    </div>
  );
}

/** The four steps as one list, for the composition region: a click jumps to that step's card. */
export function SetupOverview({ gs, onJump }: { gs: GettingStarted; onJump: (k: StartStepKey) => void }) {
  return (
    <div className="fs-steps">
      <p className="fs-body">{GREET.steps}</p>
      <StartSteps gs={gs} action={(key) => ({ label: START_STEP[key].act, title: START_STEP[key].title, run: () => onJump(key) })} />
    </div>
  );
}

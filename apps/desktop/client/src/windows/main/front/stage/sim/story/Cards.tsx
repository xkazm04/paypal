// sim STORY: the cards the story puts into Stage's transcript (host.say). Each card reads the live
// wallet (useStart, settings) and the story store itself, so a card said earlier still shows the
// truth now (a done step folds to one line). Real where Main may act: engine_select (a main
// command) and pairing_join with the house seller (main, unprivileged); the privileged halves go to
// the secure step (Secure.tsx).
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { ApprovalDraft } from '@bindings/ApprovalDraft';
import type { EngineId } from '@bindings/EngineId';
import type { PairingWords } from '@bindings/PairingWords';
import { useMutation, useQuery } from '../../../../../../lib/hooks';
import { plainWords } from '../../../../../../lib/say/draft';
import { saySet, sayState } from '../../../../../../lib/say/store';
import { CONNECTIONS_ENGINE, NOTICE_WHAT, reasonWords, START_STEP, type StartStepKey } from '../../../../../../lib/words';
import { WalletNotice } from '../../../../../../shared/honesty';
import { Btn, Icon } from '../../../../../../shared/ui';
import { payeeProblem } from '../../../../setup/pairing';
import { useStart } from '../../../../setup/start';
import { useSayReading } from '../../../../setup/useSay';
import { useLocked, useSettings } from '../../../../world';
import { useStory } from './store';
import { GOALS, STORY, type GoalId } from './words';

const useStepDone = (k: StartStepKey): boolean => useStart().steps.find((s) => s.key === k)?.state === 'done';

function Done({ children }: { children: ReactNode }) {
  return (
    <p className="ss-done" data-ss-done>
      <span className="ss-done-mark" aria-hidden="true"><Icon name="check" size={13} /></span>
      <span>{children}</span>
    </p>
  );
}

export function GoalCard({ onPick }: { onPick: (g: GoalId) => void }) {
  const { goal } = useStory();
  return (
    <div className="ss-card ss-goals" role="group" aria-label={STORY.opening}>
      <p className="ss-body">{STORY.openingSub}</p>
      {(Object.keys(GOALS) as GoalId[]).map((g) => (
        <button key={g} type="button" className={`ss-goal${goal === g ? ' is-on' : ''}`} disabled={goal !== null} aria-pressed={goal === g} onClick={() => onPick(g)} data-ss-goal={g}>
          <b>{GOALS[g].label}</b>
          <span>{GOALS[g].sub}</span>
        </button>
      ))}
    </div>
  );
}

/** The agent app, inline: engine_status / engine_select are main commands. */
export function EngineCard() {
  const done = useStepDone('engine');
  const s = useSettings().data;
  const engines = useQuery('engine_status', null, { refreshOn: ['settings:changed'] });
  const select = useMutation('engine_select');
  const pick = (id: EngineId) => { void select.run({ engine: id }); };
  if (done) return <div className="ss-card"><Done>{START_STEP.engine.done}</Done></div>;
  return (
    <div className="ss-card">
      <p className="ss-body">{STORY.engineBody}</p>
      {engines.error ? <WalletNotice error={engines.error} what={NOTICE_WHAT.agentApp} /> : null}
      {select.error ? <WalletNotice error={select.error} what={NOTICE_WHAT.agentApp} /> : null}
      <div className="ss-engines" role="group" aria-label={STORY.engineAsk}>
        {(engines.data ?? []).filter((e) => e.id !== 'scripted').map((e) => (
          <button key={e.id} type="button" className="ss-engine" disabled={!e.available || select.pending || !s} onClick={() => pick(e.id)} data-ss-engine={e.id}>
            <b>{e.id}</b>
            <span>{e.available ? CONNECTIONS_ENGINE.chipReady : CONNECTIONS_ENGINE.chipOff}{e.available ? (e.version ? ` · ${e.version}` : '') : e.reason ? ` · ${reasonWords(e.reason)}` : ''}</span>
          </button>
        ))}
      </div>
      {!engines.data ? <p className="ss-quiet">{STORY.engineLooking}</p> : null}
      <div className="ss-acts">
        <Btn kind={(engines.data ?? []).some((e) => e.id !== 'scripted' && e.available) ? 'plain' : 'primary'} disabled={select.pending || !s} onClick={() => pick('scripted')} data-ss-engine="scripted">{STORY.enginePractice}</Btn>
      </div>
    </div>
  );
}

/** The practice shop: the house seller's join is a main command (pairing_join with code HOUSE); the
 *  four words are confirmed in the secure step (pairing_confirm is privileged). */
export function ShopCard({ onConfirm }: { onConfirm: (w: PairingWords) => void }) {
  const done = useStepDone('practice');
  const s = useSettings().data;
  const locked = useLocked();
  const join = useMutation('pairing_join');
  const [payee, setPayee] = useState('');
  const [words, setWords] = useState<PairingWords | null>(null);
  const problem = payeeProblem(payee);
  const house = s?.house ?? 'unavailable';
  if (done) return <div className="ss-card"><Done>{START_STEP.practice.done}</Done></div>;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!payee.trim() || problem || house === 'unavailable' || house === 'waking') return;
    const r = await join.run({ code: 'HOUSE', side: 'buyer', payee: payee.trim(), peer: null });
    if (r) { setWords(r); onConfirm(r); }
  };
  return (
    <div className="ss-card">
      <p className="ss-body">{STORY.shopBody}</p>
      {words ? (
        <>
          <p className="ss-body">{STORY.shopWords}</p>
          <p className="ss-words mono" data-ss-words>{words.words.map((w) => <span key={w}>{w}</span>)}</p>
          <div className="ss-acts">
            <Btn kind="gold" locked={locked} onClick={() => onConfirm(words)}>{STORY.shopConfirmLead}</Btn>
          </div>
        </>
      ) : (
        <form className="ss-form" onSubmit={(e) => void submit(e)}>
          <label className="ss-field">
            <span>{STORY.shopPayee}</span>
            <input className="ui-field" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder={STORY.shopPayeePlaceholder}
              autoComplete="off" spellCheck={false} aria-invalid={problem ? true : undefined} data-ss-payee />
            <span className="ss-quiet">{STORY.shopPayeeHint}</span>
          </label>
          <div className="ss-acts">
            <Btn kind="primary" type="submit" disabled={!payee.trim() || !!problem || join.pending || house === 'unavailable' || house === 'waking'} data-ss-connect>
              {join.pending ? STORY.shopWaking : STORY.shopConnect}
            </Btn>
          </div>
        </form>
      )}
      {join.error ? <WalletNotice error={join.error} what={NOTICE_WHAT.approval} /> : null}
    </div>
  );
}

/** The rules: her goal read by the wallet's fixed-grammar reader (no model), signed in the secure step. */
export function RulesCard({ goal, onSign }: { goal: GoalId; onSign: (d: ApprovalDraft) => void }) {
  const done = useStepDone('rules');
  const sentence = GOALS[goal].sentence;
  useEffect(() => { if (sayState().text !== sentence) saySet(sentence); }, [sentence]);
  const said = useSayReading();
  const locked = useLocked();
  if (done) return <div className="ss-card"><Done>{START_STEP.rules.done}</Done></div>;
  const reading = said.text === sentence ? said : null;
  const words = reading?.chips.length ? plainWords(reading.chips) : '';
  return (
    <div className="ss-card ss-secure-card">
      <p className="ss-body">{STORY.rulesBody}</p>
      <div className="ss-reads">
        <span className="ss-kick">{STORY.rulesReads}</span>
        <q className="ss-sentence">{sentence}</q>
        {words ? <p className="ss-body" data-ss-reads>{words}</p> : <p className="ss-quiet">{STORY.rulesUnread}</p>}
      </div>
      <div className="ss-acts">
        <Btn kind="gold" locked={locked} onClick={() => { if (reading?.rules) onSign({ type: 'rules', ...reading.rules }); }}
          disabled={!reading?.rules} data-ss-sign>{STORY.rulesSign}</Btn>
        <span className="ss-tag is-secure">{STORY.secureTag}</span>
      </div>
    </div>
  );
}

export function DealCard({ onOpen }: { onOpen: () => void }) {
  const { decision } = useStory();
  return (
    <div className="ss-card">
      <div className="ss-acts">
        <Btn kind={decision ? 'plain' : 'primary'} onClick={onOpen} data-ss-open-deal>{STORY.dealOpen}</Btn>
        <span className="ss-tag is-sim" title={STORY.dealTagTitle}>{STORY.dealTag}</span>
      </div>
    </div>
  );
}

export function KeysCard({ onOpen, onLater }: { onOpen: () => void; onLater: () => void }) {
  const done = useStepDone('paypal');
  const locked = useLocked();
  const { phase } = useStory();
  if (done) return <div className="ss-card"><Done>{START_STEP.paypal.done}</Done></div>;
  return (
    <div className="ss-card ss-secure-card">
      <p className="ss-body">{STORY.keysBody}</p>
      <div className="ss-acts">
        <Btn kind="gold" locked={locked} onClick={onOpen} data-ss-keys>{STORY.keysAct}</Btn>
        {phase === 'keys' ? <Btn kind="plain" onClick={onLater}>{STORY.keysLater}</Btn> : null}
        <span className="ss-tag is-secure">{STORY.secureTag}</span>
      </div>
    </div>
  );
}

export function DoneCard({ onGo }: { onGo: () => void }) {
  const gs = useStart();
  const left = gs.total - gs.done;
  return (
    <div className="ss-card ss-end" data-ss-end>
      <p className="ss-body">{STORY.setUpSub}</p>
      <ul className="ss-where">{STORY.setUpTour.map((l) => <li key={l}>{l}</li>)}</ul>
      {left > 0 ? <p className="ss-quiet">{STORY.setUpPartial(left)}</p> : null}
      <div className="ss-acts"><Btn kind="primary" onClick={onGo} data-ss-go>{STORY.setUpGo}</Btn></div>
    </div>
  );
}

export function ResumeCard({ onResume }: { onResume: () => void }) {
  const st = useStory();
  if (!st.paused) return null;
  return (
    <div className="ss-card ss-resume">
      <p className="ss-body">{STORY.resumeLine(STORY.nextWhat[st.phase])}</p>
      <div className="ss-acts"><Btn kind="primary" onClick={onResume} data-ss-resume>{STORY.resume}</Btn></div>
    </div>
  );
}

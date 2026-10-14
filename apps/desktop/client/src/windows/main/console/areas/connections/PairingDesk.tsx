// The pairing desk (Connect a wallet), Main side of "Two desks", as a three-step wizard: Share a
// code, Match 4 words, Confirm. Moved from setup/PairingDesk.tsx by rebuild WP3c (behaviour kept,
// words in lib/words/connections.ts, the Calibre look in console/areas/connections.css scoped under
// `.pair-desk`, which the Charter's practice line also embeds). Confirming the words (pinning the
// peer) happens only in the approval window, via approval_open({pairing}); Main never pins. "All
// four match" here only moves this screen on: it pins nothing. Ticks are display only.
// Commands: pairing_create, pairing_poll (every 3 s while a code is out), pairing_join (also with
// code "HOUSE"), approval_open({deal_id: null, pairing}), pairing_abort (Stop waiting / They differ:
// it ends the pairing in Rust, no privilege needed), house_wake, and the pairing:pinned event.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { PairingOffer } from '@bindings/PairingOffer';
import type { PairingWords } from '@bindings/PairingWords';
import type { Side } from '@bindings/Side';
import type { WalletError } from '../../../../../lib/contract';
import { clockLabel, formatMoney, shortHash } from '../../../../../lib/format';
import { useEvent, useMutation, useQuery } from '../../../../../lib/hooks';
import { PAIR } from '../../../../../lib/words';
import { WalletNotice } from '../../../../../shared/honesty';
import { AnswerBar, Btn, Chip, Field, Icon, Kv, Seg, Silence, useToast } from '../../../../../shared/ui';
import { Handoff, Info } from '../../../setup/common';
import {
  allTicked, canSubmit, houseWords, joinCode, mirrorStage, mirrorText, modeLocked, newTicks, pairAnswer, pairPhase, tickLabel, tickProgress, toggleTick, wizardSteps,
  type MirrorStage, type PairMode, type Ticks, type WizardKey, type WizardState,
} from '../../../setup/pairing';
import { useLocked, useSettings } from '../../../world';

const DEFAULT_SIDE: Record<PairMode, Side> = { create: 'seller', join: 'buyer', house: 'buyer' };

// The payee the owner typed last in this session, so a second table does not ask again.
let lastPayee = '';

export function PairingDesk({ mode, setMode, asLayer = false }: {
  mode: PairMode; setMode: (m: PairMode) => void;
  /** The desk is the layer itself (#p=pairing): its answer is the layer's heading. */
  asLayer?: boolean;
}) {
  const s = useSettings().data;
  const locked = useLocked();
  const house = s?.house ?? 'unavailable';
  const toast = useToast();
  const create = useMutation('pairing_create');
  const join = useMutation('pairing_join');
  const poll = useMutation('pairing_poll');
  const abort = useMutation('pairing_abort');
  const wake = useMutation('house_wake');
  const cps = useQuery('counterparty_list', null, { refreshOn: ['pairing:pinned', 'settings:changed'] });
  // Frozen when the owner starts, so the words do not flip when this very pairing pins the house.
  const [startedAs, setStartedAs] = useState<boolean | null>(null);
  const houseConnected = startedAs ?? !!cps.data?.some((c) => c.house);
  const approval = useMutation('approval_open');

  const [side, setSide] = useState<Side>(DEFAULT_SIDE[mode]);
  const [payee, setPayee] = useState(lastPayee);
  const [code, setCode] = useState('');
  const [offer, setOffer] = useState<PairingOffer | null>(null);
  const [words, setWords] = useState<PairingWords | null>(null);
  const [pollErr, setPollErr] = useState<WalletError | null>(null);
  const [polls, setPolls] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [matched, setMatched] = useState(false);
  const [ticks, setTicks] = useState<Ticks>(() => newTicks());
  const phase = pairPhase(!!offer, !!words);

  const reset = () => { setStartedAs(null); setOffer(null); setWords(null); setPinned(false); setMatched(false); setTicks(newTicks()); setPollErr(null); setPolls(0); create.reset(); join.reset(); abort.reset(); };
  /** Ends the pairing in Rust (by our code while waiting, by its id once words are out), then here. */
  const end = async () => {
    const r = words ? await abort.run({ pairing_id: words.pairing_id, code: null }) : offer ? await abort.run({ pairing_id: null, code: offer.code }) : null;
    if (r === null) { reset(); toast(PAIR.stopped, 'ok'); }
  };
  // Rust says the owner confirmed these words in the approval window and pinned the peer.
  useEvent('pairing:pinned', (p) => {
    if (words && p.pairing_id.join(',') === words.pairing_id.join(',')) {
      setPinned(true);
      toast(p.house ? PAIR.connectedHouse : PAIR.connected, 'ok');
    }
  });
  const pickMode = (m: PairMode) => {
    if (modeLocked(phase, mode, m)) return;
    reset();
    setSide(DEFAULT_SIDE[m]);
    setMode(m);
  };
  // A mode chosen from outside (Connections > House seller) resets the side too.
  const lastMode = useRef(mode);
  useEffect(() => {
    if (lastMode.current === mode) return;
    lastMode.current = mode;
    setSide(DEFAULT_SIDE[mode]);
  }, [mode]);

  // Poll for the joiner while our code is out (as before: every 3 s until words or an error).
  const pollRef = useRef(poll.run);
  pollRef.current = poll.run;
  useEffect(() => {
    if (!offer || words || pollErr) return;
    let dead = false;
    const tick = async () => {
      const r = await pollRef.current({ code: offer.code });
      if (dead) return;
      if (r) setWords(r);
      setPolls((n) => n + 1);
    };
    void tick();
    const t = setInterval(() => void tick(), 3000);
    return () => { dead = true; clearInterval(t); };
  }, [offer, words, pollErr]);
  useEffect(() => { if (poll.error) setPollErr(poll.error); }, [poll.error]);

  // The four words arrived: hand confirmation to the approval window once, automatically (as before).
  const handed = useRef<string | null>(null);
  const wordsKey = words ? words.pairing_id.join(',') : null;
  const count = words?.words.length ?? 4;
  // new words, new ticks: a tick never carries over from another pairing
  useEffect(() => { setTicks(newTicks(count)); }, [wordsKey, count]);
  const approvalRun = useRef(approval.run);
  approvalRun.current = approval.run;
  useEffect(() => {
    if (!words || handed.current === wordsKey) return;
    handed.current = wordsKey;
    void approvalRun.current({ deal_id: null, pairing: words.pairing_id });
  }, [words, wordsKey]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit(mode, { payee, code }, house)) return;
    setWords(null); setPollErr(null); setPolls(0);
    lastPayee = payee.trim();
    setStartedAs(!!cps.data?.some((c) => c.house));
    if (mode === 'create') {
      const r = await create.run({ side, payee: payee.trim() });
      if (r) setOffer(r);
      return;
    }
    const c = mode === 'house' ? 'HOUSE' : joinCode(code);
    if (!c) return;
    const r = await join.run({ code: c, side: mode === 'house' ? 'buyer' : side, payee: payee.trim(), peer: null });
    if (r) setWords(r);
  };

  const copy = async (c: string) => {
    try {
      await navigator.clipboard.writeText(c);
      toast(PAIR.copied(c), 'ok');
    } catch {
      toast(PAIR.noCopy, 'bad');
    }
  };

  const steps = wizardSteps(phase, matched, pinned);
  const busy = create.pending || join.pending;
  const houseWaking = mode === 'house' && (join.pending || house === 'waking');
  const answer = pairAnswer(mode, phase, matched, pinned, houseConnected);
  const table = words?.house_table ?? null;

  // ---- panel 1: the code ---------------------------------------------------------------------
  let first: ReactNode;
  if (words) {
    first = mode === 'create' && offer ? <>{PAIR.theyTyped} <span className="mono">{offer.code}</span></> : mode === 'house' ? PAIR.houseAnswered : PAIR.youTyped;
  } else if (mode === 'create' && offer) {
    first = (
      <>
        <div className="wz-code">
          <span className="code" aria-label={PAIR.yourCode(offer.code)}>{offer.code}</span>
          <div className="wz-code-acts">
            <Btn kind="primary" onClick={() => void copy(offer.code)}>{PAIR.copy}</Btn>
            <Btn kind="danger" disabled={abort.pending} onClick={() => void end()} title={PAIR.stopWaitingTitle}>{PAIR.stopWaiting}</Btn>
          </div>
        </div>
        {pollErr ? (
          <div className="wz-note"><WalletNotice error={pollErr} what={PAIR.waitingFor} /><Btn sm onClick={() => setPollErr(null)}>{PAIR.keepWaiting}</Btn></div>
        ) : (
          <div className="wz-wait" role="status" title={PAIR.checked(polls)}>
            <span className="ui-spin" aria-hidden="true" />{PAIR.waiting}
            <Chip tone="teal">{PAIR.runsOut(clockLabel(offer.bundle.identity.expires))}</Chip>
            <Info label={PAIR.whenOut} title={PAIR.whenOut}><Kv items={[[PAIR.codeWorks, PAIR.until(clockLabel(offer.bundle.identity.expires))], [PAIR.stopWaiting, PAIR.stopWhat], [PAIR.ifNothingK, PAIR.ifNothingV]]} /></Info>
          </div>
        )}
        <Silence className="wz-sil" text={PAIR.codeRunsOut} deadline={offer.bundle.identity.expires}>{PAIR.noMoney}</Silence>
      </>
    );
  } else if (mode === 'house') {
    first = (
      <>
        <div className="wz-house">
          <HouseChip state={house} />
          <div className="wz-house-t">
            <b>{PAIR.houseLine}</b>
            <span>{houseWaking ? <><span className="ui-spin" aria-hidden="true" /> {PAIR.wakingUp}</> : house === 'unavailable' ? PAIR.notInVersion : house === 'ready' ? PAIR.awake : PAIR.asleep}</span>
          </div>
          <Info label={PAIR.houseInfo} title={PAIR.houseInfo}><p>{PAIR.houseInfoText}</p><p className="ui-hint">{PAIR.houseInfoHint}</p></Info>
        </div>
        {house === 'unavailable' ? null : <Fields side="buyer" setSide={() => {}} fixed payee={payee} setPayee={setPayee} />}
        <div className="wz-acts">
          {house === 'unavailable' ? <span className="ui-hint"><Chip tone="dashed">{PAIR.unavailable}</Chip> {PAIR.notInVersion}</span>
            : <Btn kind="primary" className="big" type="submit" disabled={busy || !canSubmit('house', { payee, code }, house)}>{houseWaking ? PAIR.wakingDots : houseWords(houseConnected).act}</Btn>}
          {house === 'idle' ? <Btn disabled={wake.pending || busy} title={PAIR.wakeTitle} onClick={() => void wake.run(null)}>{wake.pending ? PAIR.wakingNow : PAIR.wakeNow}</Btn> : null}
          <Silence className="wz-sil" text={PAIR.nothingHappens}>{PAIR.noMoney}</Silence>
        </div>
      </>
    );
  } else if (mode === 'join') {
    first = (
      <>
        <label className="wz-f wide" htmlFor="pp-code"><span>{PAIR.theirCode}</span>
          <Field id="pp-code" className="code-field" value={code} onChange={(e) => setCode(e.target.value)} placeholder={PAIR.theirCodePlaceholder} autoComplete="off" spellCheck={false} />
        </label>
        <Fields side={side} setSide={setSide} payee={payee} setPayee={setPayee} />
        <div className="wz-acts">
          <Btn kind="primary" className="big" type="submit" disabled={busy || !canSubmit('join', { payee, code }, house)}>{join.pending ? PAIR.joining : PAIR.join}</Btn>
          <Silence className="wz-sil" text={PAIR.nothingHappens}>{PAIR.noMoney}</Silence>
        </div>
      </>
    );
  } else {
    first = (
      <>
        <Fields side={side} setSide={setSide} payee={payee} setPayee={setPayee} />
        <div className="wz-acts">
          <Btn kind="primary" className="big" type="submit" disabled={busy || !canSubmit('create', { payee, code }, house)}>{create.pending ? PAIR.making : PAIR.makeCode}</Btn>
          <Silence className="wz-sil" text={PAIR.nothingHappens}>{PAIR.noMoneyConnecting}</Silence>
        </div>
      </>
    );
  }

  // ---- panel 2: the four words ----------------------------------------------------------------
  const stateOf = (k: WizardKey): WizardState => steps.find((x) => x.key === k)?.state ?? 'todo';
  const matchNow = () => { if (allTicked(ticks)) setMatched(true); };
  const second: ReactNode = words ? (
    <>
      <ol className="words big tiles" aria-label={PAIR.wordsLabel}>
        {words.words.map((x, i) => (
          <li key={`${i}-${x}`} className={ticks[i] ? 'seen' : undefined}>
            <button type="button" aria-pressed={!!ticks[i]} onClick={() => setTicks((t) => toggleTick(t, i))} aria-label={PAIR.word(i + 1, x, tickLabel(mode))}>
              <small>{i + 1}</small>
              <span className="w">{x}</span>
              <span className="tk"><i aria-hidden="true">{ticks[i] ? <Icon name="check" size={13} /> : null}</i>{ticks[i] ? PAIR.seen : tickLabel(mode)}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="wz-say cn-say">
        {mode === 'house' ? PAIR.sayHouse : PAIR.sayPeer}
        <Info label={PAIR.whyWords} text={PAIR.whyWords} title={PAIR.whyWordsTitle}>
          <p>{PAIR.whyWords1}</p>
          <p>{PAIR.whyWords2}</p>
        </Info>
      </p>
      <div className="wz-acts">
        <Btn kind="primary" className="big" disabled={!allTicked(ticks)} onClick={matchNow} title={allTicked(ticks) ? PAIR.allMatchTitle : PAIR.tickFirst}>{PAIR.allMatch}</Btn>
        <span className={`cn-count${allTicked(ticks) ? ' full' : ''}`} role="status" aria-live="polite">{tickProgress(ticks)}</span>
        <Btn kind="danger" onClick={() => void end()} title={PAIR.differTitle}>{PAIR.differ}</Btn>
        <Silence className="wz-sil" text={PAIR.nobody} deadline={words.reply.identity.expires}>{PAIR.noMoney}</Silence>
      </div>
    </>
  ) : null;

  // ---- panel 3: confirm in the approval window ------------------------------------------------
  const third: ReactNode = words ? (
    pinned ? (
      <div className="wz-done">
        <Chip tone="ok">{PAIR.connectedChip}</Chip><span>{PAIR.payeeSaved}</span>
        <Btn kind="primary" onClick={reset}>{PAIR.another}</Btn>
      </div>
    ) : (
      <>
        <p className="wz-say" role="status">
          {approval.pending ? PAIR.opening : approval.error ? PAIR.didNotOpen : PAIR.isOpen}
          <span className="ui-hint mono" title={PAIR.reference}>{shortHash(words.pairing_id)}</span>
        </p>
        {approval.error ? <WalletNotice error={approval.error} what={PAIR.approvalWindow} /> : null}
        {table ? (
          <div className="wz-table">
            <Kv items={[
              [PAIR.theirTable, table.category],
              [PAIR.offer, PAIR.offerLine(table.terms.qty, table.terms.item_ref, formatMoney(table.terms.unit_price))],
              [PAIR.haggleUntil, clockLabel(table.negotiation_deadline)],
            ]} />
            <p className="ui-hint">{PAIR.afterConfirm}</p>
          </div>
        ) : null}
        <div className="wz-acts">
          <Handoff label={PAIR.confirm} kind="gold" sm={false} locked={locked} pairing={words.pairing_id} title={locked ? PAIR.confirmLocked : PAIR.confirmTitle} />
          <Btn kind="danger" onClick={() => void end()} title={PAIR.differTitle}>{PAIR.differ}</Btn>
          <Silence className="wz-sil" text={PAIR.nobody} deadline={words.reply.identity.expires}>{PAIR.noMoney}</Silence>
        </div>
      </>
    )
  ) : null;

  const stepsList = (
    <ol className="wz-steps" aria-label={PAIR.stepsLabel}>
      <Panel n={1} state={stateOf('code')} title={mode === 'house' ? houseWords(houseConnected).first : PAIR.first[mode]}>{first}</Panel>
      <Panel n={2} state={stateOf('words')} title={PAIR.match4} hint={PAIR.hint2[mode]} fold={words ? <>{PAIR.matched} <b>{words.words.join(' · ')}</b></> : null}>{second}</Panel>
      <Panel n={3} state={stateOf('confirm')} title={pinned ? PAIR.connectedTitle : PAIR.confirmStep} hint={PAIR.confirmHint} open={stateOf('confirm') === 'on' || pinned}>{third}</Panel>
    </ol>
  );
  const how = (
    <Info label={PAIR.howItWorks} text={PAIR.howItWorksText} title={PAIR.howItWorks}>
      <p>{PAIR.how1}</p>
      <p>{PAIR.how2}</p>
      <p className="ui-hint">{PAIR.how3}</p>
    </Info>
  );

  return (
    <form className={`pair-desk wiz${asLayer ? ' as-layer' : ''}`} onSubmit={(e) => void submit(e)}>
      {asLayer ? (
        <header className="pf-head pd-head">
          <div className="pf-say">
            <p className="kicker">{PAIR.kicker}</p>
            <h1 className="display cs-title" tabIndex={-1} data-layer-title="">{answer.title}</h1>
            {answer.sub ? <p className="pf-sub">{answer.sub} {how}</p> : <p className="pf-sub">{how}</p>}
          </div>
        </header>
      ) : (
        <AnswerBar tone={answer.tone} title={answer.title} sub={answer.sub} icon={pinned ? 'check' : 'link'} actions={how} />
      )}
      {s && !s.relay_available ? (
        <div className="notice unavailable" role="status"><span className="n-code">{PAIR.offline}</span><span>{PAIR.offlineText}</span></div>
      ) : null}
      <div className="wz-modes">
        <span className="wz-modes-l">{PAIR.howTo}</span>
        <div className="ui-seg" role="group" aria-label={PAIR.howToLabel}>
          {PAIR.modes.map((m) => {
            const off = modeLocked(phase, mode, m.value);
            return <button key={m.value} type="button" aria-pressed={mode === m.value} disabled={off} title={off ? PAIR.finishFirst : m.title} onClick={() => pickMode(m.value)}>{m.label}</button>;
          })}
        </div>
      </div>

      <div className="cn-grid">
        {stepsList}
        <Mirror mode={mode} stage={mirrorStage(mode, phase, matched, pinned)} words={words?.words ?? null} ticks={ticks} />
      </div>

      {create.error ? <WalletNotice error={create.error} what={PAIR.failMake} /> : null}
      {abort.error ? <WalletNotice error={abort.error} what={PAIR.failStop} /> : null}
      {wake.error ? <WalletNotice error={wake.error} what={PAIR.failWake} /> : null}
      {join.error ? (
        <>
          <WalletNotice error={join.error} what={mode === 'house' ? PAIR.failHouse : PAIR.failJoin} />
          {mode === 'house' && join.error.code === 'UNAVAILABLE' ? <p className="ui-hint">{PAIR.mayWake}</p> : null}
        </>
      ) : null}
    </form>
  );
}

/** What the other person should see at this step: a calm mock of their screen. It is a picture of
 *  the plan, not a live view (Main cannot see their wallet), so it says "should". It shows only our
 *  own four words and fixed text: nothing the other side wrote. */
function Mirror({ mode, stage, words, ticks }: { mode: PairMode; stage: MirrorStage; words: readonly string[] | null; ticks: Ticks }) {
  const t = mirrorText(mode, stage);
  const house = mode === 'house';
  return (
    <aside className={`cn-mirror st-${stage}${house ? ' house' : ''}`} aria-label={PAIR.mirrorLabel}>
      <div className="cn-m-h"><Icon name={house ? 'shield' : 'you'} size={14} /><b>{house ? PAIR.mirrorOther : PAIR.mirrorTheirs}</b><span>{PAIR.mirrorShould}</span></div>
      {house ? null : (
        <div className="cn-win" aria-hidden="true">
          <div className="cn-bar"><i /><i /><i /></div>
          <div className="cn-body">
            {stage === 'words' || stage === 'confirm' || stage === 'done' ? (
              <>
                <div className="cn-mw">
                  {(words ?? ['', '', '', '']).map((x, i) => <span key={i} className={stage !== 'words' || ticks[i] ? 'on' : undefined}>{x || '····'}</span>)}
                </div>
                <div className={`cn-btn${stage === 'words' ? ' off' : ''}`}>{stage === 'words' ? PAIR.mirrorAllMatch : PAIR.mirrorConfirm}</div>
              </>
            ) : stage === 'code' ? (
              <><div className="cn-in"><span>{PAIR.mirrorYourCode}</span><em /></div><div className="cn-btn off">{PAIR.mirrorJoin}</div></>
            ) : (
              <><div className="cn-in off" /><div className="cn-btn off">{PAIR.mirrorWaiting}</div></>
            )}
          </div>
        </div>
      )}
      <p className="cn-m-t"><b>{t.title}</b>{t.line}</p>
    </aside>
  );
}

/** One big step. Only the active panel shows its body; a finished one folds into a one-line summary,
 *  a coming one into a dim hint. */
function Panel({ n, state, title, hint, open, fold, children }: { n: number; state: WizardState; title: string; hint?: string; open?: boolean; fold?: ReactNode; children?: ReactNode }) {
  const show = open ?? state === 'on';
  const folded = state === 'done' && !show;
  return (
    <li className={`wz-panel st-${state}${show ? ' open' : ''}`} aria-current={state === 'on' ? 'step' : undefined}>
      <div className="wz-h">
        <span className="wz-n" aria-hidden="true">{state === 'done' ? <Icon name="check" size={16} /> : n}</span>
        <h3>{title}</h3>
        <span className="wz-st">{state === 'done' ? PAIR.stateDone : state === 'on' ? PAIR.stateNow : PAIR.stateNext}</span>
      </div>
      {show ? <div className="wz-body">{children}</div> : folded ? <div className="wz-fold">{fold ?? children}</div> : hint ? <div className="wz-fold dim">{hint}</div> : null}
    </li>
  );
}

function HouseChip({ state }: { state: 'unavailable' | 'idle' | 'waking' | 'ready' }) {
  const tone = state === 'unavailable' ? 'dashed' : state === 'waking' ? 'gold' : state === 'ready' ? 'ok' : undefined;
  return <Chip tone={tone}>{PAIR.houseState[state]}</Chip>;
}

function Fields({ side, setSide, fixed, payee, setPayee }: { side: Side; setSide: (s: Side) => void; fixed?: boolean; payee: string; setPayee: (s: string) => void }) {
  return (
    <div className="wz-fields">
      <div className="wz-f">
        <span>{PAIR.youSide}</span>
        {fixed ? <span className="wz-fixed"><Chip tone="line">{PAIR.buy}</Chip><span className="ui-hint">{PAIR.buyOnly}</span></span> : (
          <Seg value={side} onChange={setSide} label={PAIR.yourSide} options={[{ value: 'buyer', label: PAIR.buyOpt }, { value: 'seller', label: PAIR.sellOpt }]} />
        )}
      </div>
      <label className="wz-f grow" htmlFor="pp-payee" title={PAIR.paidToTitle}>
        <span>{PAIR.paidTo}</span>
        <Field id="pp-payee" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder={PAIR.paidToPlaceholder} autoComplete="off" spellCheck={false} />
      </label>
    </div>
  );
}

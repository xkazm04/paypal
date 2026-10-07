// Pairing, Main side of "Two desks" (prototype/pages/pairing/variant-1) as a three-step wizard
// (docs/ux/ROUND-1.md): Share a code, Match 4 words, Confirm. Three large panels, one active at a
// time, with the code and the four words set big. Confirming the words (pinning the peer) happens
// only in the approval window, via approval_open({pairing}); Main never pins. "All four match" here
// only moves this screen on to the Confirm panel: it pins nothing.
// Round 2: a mirror of the other person's screen beside the wizard, and the four words as
// tiles the owner ticks one by one; "All four match" waits for all four ticks. Ticks are display only.
// Real commands: pairing_create, pairing_poll (every 3 s while a code is out), pairing_join (also
// with code "HOUSE"), approval_open({deal_id: null, pairing}), pairing_abort (Stop waiting / They
// differ: it ends the pairing in Rust, no privilege needed), house_wake, and the pairing:pinned event.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { PairingOffer } from '@bindings/PairingOffer';
import type { PairingWords } from '@bindings/PairingWords';
import type { Side } from '@bindings/Side';
import type { WalletError } from '../../../lib/contract';
import { clockLabel, formatMoney, shortHash, shortId } from '../../../lib/format';
import { useEvent, useMutation } from '../../../lib/hooks';
import { WalletNotice } from '../../../shared/honesty';
import { AnswerBar, Btn, Chip, Field, Icon, Kv, Seg, Silence, useToast } from '../../../shared/ui';
import { useWorld } from '../world';
import { Handoff, Info } from './common';
import {
  allTicked, canSubmit, joinCode, mirrorStage, mirrorText, modeLocked, newTicks, pairAnswer, pairPhase, tickLabel, tickProgress, toggleTick, wizardSteps,
  type MirrorStage, type PairMode, type Ticks, type WizardKey, type WizardState,
} from './pairing';
import './setup.css';

const MODES: ReadonlyArray<{ value: PairMode; label: string; title: string }> = [
  { value: 'create', label: 'Share a code', title: 'Make a code and give it to the person you want to deal with' },
  { value: 'join', label: 'I have a code', title: 'Someone gave you a code' },
  { value: 'house', label: 'House seller', title: 'A practice shop that is always there' },
];
/** The first step is the only one that changes with how you connect. */
const FIRST_TITLE: Record<PairMode, string> = { create: 'Share a code', join: 'Enter their code', house: 'Connect with the house' };
const DEFAULT_SIDE: Record<PairMode, Side> = { create: 'seller', join: 'buyer', house: 'buyer' };

export function PairingDesk({ mode, setMode }: { mode: PairMode; setMode: (m: PairMode) => void }) {
  const w = useWorld();
  const s = w.settings.data;
  const house = s?.house ?? 'unavailable';
  const toast = useToast();
  const create = useMutation('pairing_create');
  const join = useMutation('pairing_join');
  const poll = useMutation('pairing_poll');
  const abort = useMutation('pairing_abort');
  const wake = useMutation('house_wake');
  const approval = useMutation('approval_open');

  const [side, setSide] = useState<Side>(DEFAULT_SIDE[mode]);
  const [payee, setPayee] = useState('');
  const [code, setCode] = useState('');
  const [offer, setOffer] = useState<PairingOffer | null>(null);
  const [words, setWords] = useState<PairingWords | null>(null);
  const [pollErr, setPollErr] = useState<WalletError | null>(null);
  const [polls, setPolls] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [matched, setMatched] = useState(false);
  const [ticks, setTicks] = useState<Ticks>(() => newTicks());
  const phase = pairPhase(!!offer, !!words);

  const reset = () => { setOffer(null); setWords(null); setPinned(false); setMatched(false); setTicks(newTicks()); setPollErr(null); setPolls(0); create.reset(); join.reset(); abort.reset(); };
  /** Ends the pairing in Rust (by our code while waiting, by its id once words are out), then here. */
  const end = async () => {
    const r = words ? await abort.run({ pairing_id: words.pairing_id, code: null }) : offer ? await abort.run({ pairing_id: null, code: offer.code }) : null;
    if (r === null) { reset(); toast('Stopped. Nobody was connected and no money moved.', 'ok'); }
  };
  // Rust says the owner confirmed these words in the approval window and pinned the peer.
  useEvent('pairing:pinned', (p) => {
    if (words && p.pairing_id.join(',') === words.pairing_id.join(',')) {
      setPinned(true);
      toast(<>Connected{p.house ? ' with the house seller' : ''}. You can open a table now.</>, 'ok');
    }
  });
  const pickMode = (m: PairMode) => {
    if (modeLocked(phase, mode, m)) return;
    reset();
    setSide(DEFAULT_SIDE[m]);
    setMode(m);
  };
  // A mode chosen from outside (Settings > House seller) resets the side too.
  const lastMode = useRef(mode);
  useEffect(() => {
    if (lastMode.current === mode) return;
    lastMode.current = mode;
    setSide(DEFAULT_SIDE[mode]);
  }, [mode]);

  // Poll for the joiner while our code is out (as before: every 3 s until words or an error).
  useEffect(() => {
    if (!offer || words || pollErr) return;
    let dead = false;
    const tick = async () => {
      const r = await poll.run({ code: offer.code });
      if (dead) return;
      if (r) setWords(r);
      setPolls((n) => n + 1);
    };
    void tick();
    const t = setInterval(() => void tick(), 3000);
    return () => { dead = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer, words, pollErr]);
  useEffect(() => { if (poll.error) setPollErr(poll.error); }, [poll.error]);

  // The four words arrived: hand confirmation to the approval window once, automatically (as before).
  const handed = useRef<string | null>(null);
  const wordsKey = words ? words.pairing_id.join(',') : null;
  // new words, new ticks: a tick never carries over from another pairing
  useEffect(() => { setTicks(newTicks(words?.words.length ?? 4)); }, [wordsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!words || handed.current === wordsKey) return;
    handed.current = wordsKey;
    void approval.run({ deal_id: null, pairing: words.pairing_id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordsKey]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit(mode, { payee, code }, house)) return;
    setWords(null); setPollErr(null); setPolls(0);
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
      toast(<>Copied <span className="mono">{c}</span>. Share only the code; you match the words next.</>, 'ok');
    } catch {
      toast('Copy is not available here. Read the code out instead.', 'bad');
    }
  };

  const steps = wizardSteps(phase, matched, pinned);
  const busy = create.pending || join.pending;
  const houseWaking = mode === 'house' && (join.pending || house === 'waking');
  const answer = pairAnswer(mode, phase, matched, pinned);
  const table = words?.house_table ?? null;

  // ---- panel 1: the code ---------------------------------------------------------------------
  let first: ReactNode;
  if (words) {
    first = mode === 'create' && offer ? <>They typed your code <span className="mono">{offer.code}</span></> : mode === 'house' ? 'The house answered' : 'You typed their code';
  } else if (mode === 'create' && offer) {
    first = (
      <>
        <div className="wz-code">
          <span className="code" aria-label={`Your code ${offer.code}`}>{offer.code}</span>
          <div className="wz-code-acts">
            <Btn kind="primary" onClick={() => void copy(offer.code)}>Copy code</Btn>
            <Btn kind="danger" disabled={abort.pending} onClick={() => void end()} title="Cancels this code, so nobody can join with it later">Stop waiting</Btn>
          </div>
        </div>
        {pollErr ? (
          <div className="wz-note"><WalletNotice error={pollErr} what="Waiting for them" /><Btn sm onClick={() => setPollErr(null)}>Keep waiting</Btn></div>
        ) : (
          <div className="wz-wait" role="status" title={`checked ${polls}×`}>
            <span className="ui-spin" aria-hidden="true" />Waiting for them to type your code…
            <Chip tone="teal">runs out {clockLabel(offer.bundle.identity.expires)}</Chip>
            <Info label="When it runs out" title="When it runs out"><Kv items={[['Code works', `until ${clockLabel(offer.bundle.identity.expires)}`], ['Stop waiting', 'cancels the code; nobody can join with it'], ['If you do nothing', 'nobody is connected · no money moves']]} /></Info>
          </div>
        )}
        <Silence className="wz-sil" text="the code runs out" deadline={offer.bundle.identity.expires}>{' · no money moves'}</Silence>
      </>
    );
  } else if (mode === 'house') {
    first = (
      <>
        <div className="wz-house">
          <HouseChip state={house} />
          <div className="wz-house-t">
            <b>House seller · a practice shop, always there</b>
            <span>{houseWaking ? <><span className="ui-spin" aria-hidden="true" /> waking up</> : house === 'unavailable' ? 'not part of this version' : house === 'ready' ? 'awake · answers at once' : 'asleep · wakes when you start'}</span>
          </div>
          <Info label="The house seller" title="The house seller"><p>A practice shop built into the app, so you can try a haggle on your own. It uses sandbox money and only ever sells to you.</p><p className="ui-hint">It sleeps when nobody uses it and wakes when you start. If it is slow, just try again.</p></Info>
        </div>
        {house === 'unavailable' ? null : <Fields side="buyer" setSide={() => {}} fixed payee={payee} setPayee={setPayee} />}
        <div className="wz-acts">
          {house === 'unavailable' ? <span className="ui-hint"><Chip tone="dashed">unavailable</Chip> not part of this version</span>
            : <Btn kind="primary" className="big" type="submit" disabled={busy || !canSubmit('house', { payee, code }, house)}>{houseWaking ? 'Waking up…' : 'Connect with the house'}</Btn>}
          {house === 'idle' ? <Btn disabled={wake.pending || busy} title="Wakes it ahead of time. Nothing is connected, no money moves." onClick={() => void wake.run(null)}>{wake.pending ? 'Waking…' : 'Wake it now'}</Btn> : null}
          <Silence className="wz-sil" text="nothing happens">{' · no money moves'}</Silence>
        </div>
      </>
    );
  } else if (mode === 'join') {
    first = (
      <>
        <label className="wz-f wide" htmlFor="pp-code"><span>Their code</span>
          <Field id="pp-code" className="code-field" value={code} onChange={(e) => setCode(e.target.value)} placeholder="the code they gave you" autoComplete="off" spellCheck={false} />
        </label>
        <Fields side={side} setSide={setSide} payee={payee} setPayee={setPayee} />
        <div className="wz-acts">
          <Btn kind="primary" className="big" type="submit" disabled={busy || !canSubmit('join', { payee, code }, house)}>{join.pending ? 'Joining…' : 'Join'}</Btn>
          <Silence className="wz-sil" text="nothing happens">{' · no money moves'}</Silence>
        </div>
      </>
    );
  } else {
    first = (
      <>
        <Fields side={side} setSide={setSide} payee={payee} setPayee={setPayee} />
        <div className="wz-acts">
          <Btn kind="primary" className="big" type="submit" disabled={busy || !canSubmit('create', { payee, code }, house)}>{create.pending ? 'Making a code…' : 'Make a code'}</Btn>
          <Silence className="wz-sil" text="nothing happens">{' · no money moves while connecting'}</Silence>
        </div>
      </>
    );
  }

  // ---- panel 2: the four words ----------------------------------------------------------------
  const stateOf = (k: WizardKey): WizardState => steps.find((x) => x.key === k)?.state ?? 'todo';
  const matchNow = () => { if (allTicked(ticks)) setMatched(true); };
  const second: ReactNode = words ? (
    <>
      <ol className="words big tiles" aria-label="Pairing words">
        {words.words.map((x, i) => (
          <li key={`${i}-${x}`} className={ticks[i] ? 'seen' : undefined}>
            <button type="button" aria-pressed={!!ticks[i]} onClick={() => setTicks((t) => toggleTick(t, i))}
              aria-label={`Word ${i + 1}, ${x}: ${tickLabel(mode)}`}>
              <small>{i + 1}</small>
              <span className="w">{x}</span>
              <span className="tk"><i aria-hidden="true">{ticks[i] ? <Icon name="check" size={13} /> : null}</i>{ticks[i] ? 'Seen' : tickLabel(mode)}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="wz-say cn-say">
        {mode === 'house' ? 'The house answered. Tick each word as you see it in the approval window.' : 'Read these to them. Tick each word as you see the same one on their screen.'}
        <Info label="Why the words?" text="Why the words?" title="Why the words matter">
          <p>Both screens make the same four words only if you are really connected to each other.</p>
          <p>If anyone sat in the middle, the words would differ. If even one word differs, stop: nobody is connected.</p>
        </Info>
      </p>
      <div className="wz-acts">
        <Btn kind="primary" className="big" disabled={!allTicked(ticks)} onClick={matchNow}
          title={allTicked(ticks) ? 'Only moves this screen on. Nothing is confirmed until you do it in the approval window.' : 'Tick all four words first'}>All four match</Btn>
        <span className={`cn-count${allTicked(ticks) ? ' full' : ''}`} role="status" aria-live="polite">{tickProgress(ticks)}</span>
        <Btn kind="danger" onClick={() => void end()} title="Stops connecting. Nobody is connected; no money moves.">They don’t match: stop</Btn>
        <Silence className="wz-sil" text="nobody is connected" deadline={words.reply.identity.expires}>{' · no money moves'}</Silence>
      </div>
    </>
  ) : null;

  // ---- panel 3: confirm in the approval window ------------------------------------------------
  const third: ReactNode = words ? (
    pinned ? (
      <div className="wz-done">
        <Chip tone="ok">connected</Chip><span>Their payee is saved. You can open a table now.</span>
        <Btn kind="primary" onClick={reset}>Connect another</Btn>
      </div>
    ) : (
      <>
        <p className="wz-say" role="status">
          {approval.pending ? 'Opening the approval window…' : approval.error ? 'The approval window did not open; use the button.' : 'The approval window is open. Confirm the words there.'}
          <span className="ui-hint mono" title="Connection reference">{shortHash(words.pairing_id)}</span>
        </p>
        {approval.error ? <WalletNotice error={approval.error} what="Approval window" /> : null}
        {table ? (
          <div className="wz-table">
            <Kv items={[
              ['Their table', <>{table.category} <span className="dim mono">· {shortId(table.deal_id)}</span></>],
              ['Offer', `${table.terms.qty} × ${table.terms.item_ref} at ${formatMoney(table.terms.unit_price)}`],
              ['Haggle until', clockLabel(table.negotiation_deadline)],
            ]} />
            <p className="ui-hint">After confirming, you join this table in the approval window. Your own rules still apply.</p>
          </div>
        ) : null}
        <div className="wz-acts">
          <Handoff label="Confirm in the approval window" kind="gold" sm={false} locked={w.locked} pairing={words.pairing_id}
            title={w.locked ? 'Locked: the approval window asks for Windows Hello first' : 'Confirm the words there, or stop'} />
          <Btn kind="danger" onClick={() => void end()} title="Stops connecting. Nobody is connected; no money moves.">They don’t match: stop</Btn>
          <Silence className="wz-sil" text="nobody is connected" deadline={words.reply.identity.expires}>{' · no money moves'}</Silence>
        </div>
      </>
    )
  ) : null;

  const hint2 = mode === 'create' ? 'Four words appear here when they type your code.' : mode === 'join' ? 'Four words appear here after you join.' : 'Four words appear here after the house answers.';

  const stepsList = (
    <ol className="wz-steps" aria-label="Connecting, step by step">
      <Panel n={1} state={stateOf('code')} title={FIRST_TITLE[mode]}>{first}</Panel>
      <Panel n={2} state={stateOf('words')} title="Match 4 words" hint={hint2} fold={words ? <>You matched <b>{words.words.join(' · ')}</b></> : null}>{second}</Panel>
      <Panel n={3} state={stateOf('confirm')} title={pinned ? 'Connected' : 'Confirm'} hint="You confirm in the approval window, where only you can." open={stateOf('confirm') === 'on' || pinned}>{third}</Panel>
    </ol>
  );

  return (
    <form className="pair-desk wiz" onSubmit={(e) => void submit(e)}>
      <AnswerBar tone={answer.tone} title={answer.title} sub={answer.sub} icon={pinned ? 'check' : 'link'}
        actions={(
          <Info label="How connecting works" text="How it works" title="How connecting works">
            <p>One of you makes a code and gives it to the other. Both screens then show the same four words.</p>
            <p>Read them to each other. If all four match, each of you confirms in your own approval window. If anyone tried to sit in the middle, the words would not match.</p>
            <p className="ui-hint">Connecting never pays anyone.</p>
          </Info>
        )} />
      {s && !s.relay_available ? (
        <div className="notice unavailable" role="status"><span className="n-code">Offline</span><span>The online meeting point is not available, so a code alone can’t find the other wallet right now.</span></div>
      ) : null}
      <div className="wz-modes">
        <span className="wz-modes-l">How do you want to connect?</span>
        <div className="ui-seg" role="group" aria-label="How to connect">
          {MODES.map((m) => {
            const off = modeLocked(phase, mode, m.value);
            return <button key={m.value} type="button" aria-pressed={mode === m.value} disabled={off} title={off ? 'Finish or start over first' : m.title} onClick={() => pickMode(m.value)}>{m.label}</button>;
          })}
        </div>
      </div>

      <div className="cn-grid">
        {stepsList}
        <Mirror mode={mode} stage={mirrorStage(mode, phase, matched, pinned)} words={words?.words ?? null} ticks={ticks} />
      </div>

      {create.error ? <WalletNotice error={create.error} what="Make a code" /> : null}
      {abort.error ? <WalletNotice error={abort.error} what="Stop" /> : null}
      {wake.error ? <WalletNotice error={wake.error} what="Wake the house" /> : null}
      {join.error ? (
        <>
          <WalletNotice error={join.error} what={mode === 'house' ? 'House seller' : 'Join'} />
          {mode === 'house' && join.error.code === 'UNAVAILABLE' ? <p className="ui-hint">It may still be waking up. Try again; nothing is lost.</p> : null}
        </>
      ) : null}
    </form>
  );
}

/** What the other person should see at this step: a calm mock of their screen. It is a picture of
 *  the plan, not a live view (Main cannot see their wallet), so it says "should". It shows only our own
 *  four words and fixed text: nothing the other side wrote. */
function Mirror({ mode, stage, words, ticks }: { mode: PairMode; stage: MirrorStage; words: readonly string[] | null; ticks: Ticks }) {
  const t = mirrorText(mode, stage);
  const house = mode === 'house';
  return (
    <aside className={`cn-mirror st-${stage}${house ? ' house' : ''}`} aria-label="What the other person sees">
      <div className="cn-m-h"><Icon name={house ? 'shield' : 'you'} size={14} /><b>{house ? 'The other side' : 'On their screen'}</b><span>what they should see</span></div>
      {house ? null : (
      <div className="cn-win" aria-hidden="true">
        <div className="cn-bar"><i /><i /><i /></div>
        <div className="cn-body">
          {stage === 'words' || stage === 'confirm' || stage === 'done' ? (
            <>
              <div className="cn-mw">
                {(words ?? ['', '', '', '']).map((x, i) => <span key={i} className={stage !== 'words' || ticks[i] ? 'on' : undefined}>{x || '····'}</span>)}
              </div>
              <div className={`cn-btn${stage === 'words' ? ' off' : ''}`}>{stage === 'words' ? 'All four match' : 'Confirm'}</div>
            </>
          ) : stage === 'code' ? (
            <><div className="cn-in"><span>your code</span><em /></div><div className="cn-btn off">Join</div></>
          ) : (
            <><div className="cn-in off" /><div className="cn-btn off">{house ? '…' : 'Waiting'}</div></>
          )}
        </div>
      </div>
      )}
      <p className="cn-m-t"><b>{t.title}</b>{t.line}</p>
    </aside>
  );
}

/** One big step. Only the active panel shows its body; a finished one folds into a one-line summary
 *  (its `children`, which the caller makes the summary), a coming one into a dim hint. */
function Panel({ n, state, title, hint, open, fold, children }: { n: number; state: WizardState; title: string; hint?: string; open?: boolean; fold?: ReactNode; children?: ReactNode }) {
  const show = open ?? state === 'on';
  const folded = state === 'done' && !show;
  return (
    <li className={`wz-panel st-${state}${show ? ' open' : ''}`} aria-current={state === 'on' ? 'step' : undefined}>
      <div className="wz-h">
        <span className="wz-n" aria-hidden="true">{state === 'done' ? <Icon name="check" size={16} /> : n}</span>
        <h3>{title}</h3>
        <span className="wz-st">{state === 'done' ? 'done' : state === 'on' ? 'now' : 'next'}</span>
      </div>
      {show ? <div className="wz-body">{children}</div> : folded ? <div className="wz-fold">{fold ?? children}</div> : hint ? <div className="wz-fold dim">{hint}</div> : null}
    </li>
  );
}

function HouseChip({ state }: { state: 'unavailable' | 'idle' | 'waking' | 'ready' }) {
  switch (state) {
    case 'unavailable': return <Chip tone="dashed">unavailable</Chip>;
    case 'idle': return <Chip>asleep</Chip>;
    case 'waking': return <Chip tone="gold">waking</Chip>;
    case 'ready': return <Chip tone="ok">ready</Chip>;
  }
}

function Fields({ side, setSide, fixed, payee, setPayee }: { side: Side; setSide: (s: Side) => void; fixed?: boolean; payee: string; setPayee: (s: string) => void }) {
  return (
    <div className="wz-fields">
      <div className="wz-f">
        <span>In this deal you</span>
        {fixed ? <span className="wz-fixed"><Chip tone="line">buy</Chip><span className="ui-hint">the house only ever sells to you</span></span> : (
          <Seg value={side} onChange={setSide} label="Your side" options={[{ value: 'buyer', label: 'Buy' }, { value: 'seller', label: 'Sell' }]} />
        )}
      </div>
      <label className="wz-f grow" htmlFor="pp-payee" title="Where money to you is paid. The other side saves it when you connect.">
        <span>Paid to</span>
        <Field id="pp-payee" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="your PayPal email or shop name" autoComplete="off" spellCheck={false} />
      </label>
    </div>
  );
}

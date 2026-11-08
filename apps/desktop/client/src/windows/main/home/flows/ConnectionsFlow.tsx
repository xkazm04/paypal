// The Connections chat flow (spark chat-configure): choose, then one short flow per choice, ONE question per
// card. It reuses the commands the Connections page and the setup guide use (pairing_create / _join / _poll /
// _abort, house_wake, engine_select) and nothing else; it ports none of their screens. The chat never
// handles a secret: the four words and the confirm live in SecureStep (kind 'pairing'), and the agent app
// changes only after a consent press this card draws. State is said in one line, never a table.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { EngineId } from '@bindings/EngineId';
import { useEvent, useMutation, useQuery } from '../../../../lib/hooks';
import { NOTICE_WHAT } from '../../../../lib/words';
import { PAIR } from '../../../../lib/words/connections';
import { WalletNotice } from '../../../../shared/honesty';
import { Btn, Field } from '../../../../shared/ui';
import { canSubmit, joinCode, payeeProblem } from '../../setup/pairing';
import { useLocked, useSettings } from '../../world';
import { SecureStep } from '../secure/SecureStep';
import { FlowCard } from './FlowCard';
import { CONN_WORDS as W } from './connectionsWords';
import { advanceFlow, endFlow, type FlowTurn } from './store';
import './connectionsFlow.css';

type Mode = 'join' | 'create' | 'shop';
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function ConnectionsFlow({ turn }: { turn: FlowTurn }) {
  if (turn.summary !== null) return <FlowCard turn={turn}>{null}</FlowCard>;
  switch (turn.step) {
    case 'wallet': return <FlowCard turn={turn} n={1} of={4}><WalletAsk /></FlowCard>;
    case 'code': return <FlowCard turn={turn} n={2} of={4}><CodeAsk /></FlowCard>;
    case 'payee': return <FlowCard turn={turn} n={3} of={4}><PayeeAsk mode={turn.data.mode === 'create' ? 'create' : 'join'} code={str(turn.data.code)} /></FlowCard>;
    case 'share': return <FlowCard turn={turn} n={4} of={4}><ShareWait code={str(turn.data.code)} /></FlowCard>;
    case 'secure': return <FlowCard turn={turn}><SecureAsk pairing={str(turn.data.pairing)} mode={turn.data.mode === 'shop' ? 'shop' : 'wallet'} /></FlowCard>;
    case 'shop': return <FlowCard turn={turn} n={1} of={3}><ShopAsk /></FlowCard>;
    case 'shop-payee': return <FlowCard turn={turn} n={2} of={3}><PayeeAsk mode="shop" code="" /></FlowCard>;
    case 'app': return <FlowCard turn={turn} n={1} of={2}><AppAsk /></FlowCard>;
    case 'app-consent': return <FlowCard turn={turn} n={2} of={2}><AppConsent engine={str(turn.data.engine)} /></FlowCard>;
    default: return <FlowCard turn={turn}><ChooseAsk /></FlowCard>;
  }
}

// ---- choose --------------------------------------------------------------------------------------

function ChooseAsk() {
  return (
    <>
      <p className="cnf-q">{W.choose.q}</p>
      <div className="fc-choices">
        <Btn sm onClick={() => advanceFlow(W.folds.wallet, 'wallet')} data-choice="wallet">{W.choose.wallet}</Btn>
        <Btn sm onClick={() => advanceFlow(W.folds.shop, 'shop')} data-choice="shop">{W.choose.shop}</Btn>
        <Btn sm onClick={() => advanceFlow(W.folds.app, 'app')} data-choice="app">{W.choose.app}</Btn>
      </div>
    </>
  );
}

// ---- connect another wallet: have a code, or make one -----------------------------------------------

function WalletAsk() {
  return (
    <>
      <p className="cnf-q">{W.wallet.haveQ}</p>
      <div className="fc-choices">
        <Btn sm onClick={() => advanceFlow(W.wallet.have, 'code', { mode: 'join' })} data-choice="have">{W.wallet.have}</Btn>
        <Btn sm onClick={() => advanceFlow(W.wallet.make, 'payee', { mode: 'create' })} data-choice="make">{W.wallet.make}</Btn>
      </div>
    </>
  );
}

function CodeAsk() {
  const [code, setCode] = useState('');
  const c = joinCode(code);
  return (
    <form className="cnf-form" onSubmit={(e) => { e.preventDefault(); if (c) advanceFlow(W.wallet.codeFold, 'payee', { mode: 'join', code: c }); }}>
      <label className="cnf-q" htmlFor="cnf-code">{W.wallet.codeQ}</label>
      <Field id="cnf-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} />
      <div className="fc-choices"><Btn kind="gold" sm type="submit" disabled={!c}>{W.wallet.next}</Btn></div>
    </form>
  );
}

/** The payee question of a pairing (a wallet by code, a code to share, or the practice shop), then the command. */
function PayeeAsk({ mode, code }: { mode: Mode; code: string }) {
  const house = useSettings().data?.house ?? null;
  const [payee, setPayee] = useState('');
  const wake = useMutation('house_wake');
  const join = useMutation('pairing_join');
  const create = useMutation('pairing_create');
  const problem = payeeProblem(payee);
  const busy = wake.pending || join.pending || create.pending || (mode === 'shop' && house === 'waking');
  const ok = canSubmit(mode === 'create' ? 'create' : mode === 'shop' ? 'house' : 'join', { payee, code: mode === 'join' ? code : '' }, house ?? 'unavailable');
  const go = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    const who = payee.trim();
    if (mode === 'create') {
      const r = await create.run({ side: 'seller', payee: who });
      if (r) advanceFlow(W.wallet.codeMade, 'share', { code: r.code });
      return;
    }
    if (mode === 'shop' && house === 'idle' && (await wake.run(null)) === undefined) return;
    const r = await join.run({ code: mode === 'shop' ? 'HOUSE' : code, side: 'buyer', payee: who, peer: null });
    if (r) advanceFlow(mode === 'shop' ? W.shop.joined : W.wallet.joined, 'secure', { pairing: JSON.stringify(r.pairing_id), mode });
  };
  return (
    <form className="cnf-form" onSubmit={(e) => void go(e)}>
      <label className="cnf-q" htmlFor="cnf-payee">{mode === 'shop' ? W.shop.payeeQ : W.wallet.payeeQ}</label>
      <Field id="cnf-payee" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder={W.wallet.payeeHint} autoComplete="off" spellCheck={false}
        aria-invalid={problem ? true : undefined} />
      {problem ? <span className="cnf-hint" role="alert">{W.wallet.payeeProblem[problem]}</span> : null}
      <div className="fc-choices">
        <Btn kind="gold" sm type="submit" disabled={!ok || busy}>
          {busy ? (mode === 'shop' ? W.shop.working : W.wallet.working) : mode === 'shop' ? W.shop.connect : mode === 'create' ? W.wallet.makeAct : W.wallet.joinAct}
        </Btn>
      </div>
      {wake.error ? <WalletNotice error={wake.error} what={PAIR.waitingFor} /> : null}
      {join.error ? <WalletNotice error={join.error} what={PAIR.waitingFor} /> : null}
      {create.error ? <WalletNotice error={create.error} what={PAIR.waitingFor} /> : null}
    </form>
  );
}

/** Our code is out: show it (a code is for sharing, not a secret), poll for their words, then hand the words to the secure step. */
function ShareWait({ code }: { code: string }) {
  const poll = useMutation('pairing_poll');
  const abort = useMutation('pairing_abort');
  const pollRef = useRef(poll.run);
  pollRef.current = poll.run;
  const abortRef = useRef(abort.run);
  abortRef.current = abort.run;
  const handed = useRef(false);
  useEffect(() => {
    let dead = false;
    const tick = async () => {
      const r = await pollRef.current({ code });
      if (dead || !r || handed.current) return;
      handed.current = true;
      advanceFlow(W.wallet.joined, 'secure', { pairing: JSON.stringify(r.pairing_id), mode: 'create' });
    };
    void tick();
    const t = setInterval(() => void tick(), 3000);
    return () => { dead = true; clearInterval(t); };
  }, [code]);
  // Leaving this card without their words (Cancel) ends the offer, so no code stays out.
  useEffect(() => () => { if (!handed.current) void abortRef.current({ pairing_id: null, code }); }, [code]);
  return (
    <>
      <p className="cnf-q">{W.wallet.shareQ}</p>
      <p className="cnf-code" data-code="">{code}</p>
      <p className="cnf-hint" role="status">{W.wallet.waiting}</p>
      {poll.error ? <WalletNotice error={poll.error} what={PAIR.waitingFor} /> : null}
    </>
  );
}

/** The four words and the confirm: SecureStep only. Done when Rust says this pairing is pinned. */
function SecureAsk({ pairing, mode }: { pairing: string; mode: 'wallet' | 'shop' }) {
  const [done, setDone] = useState(false);
  const abort = useMutation('pairing_abort');
  const abortRef = useRef(abort.run);
  abortRef.current = abort.run;
  const id = useRef<number[] | null>(null);
  try { id.current = JSON.parse(pairing) as number[]; } catch { id.current = null; }
  const finished = useRef(false);
  useEvent('pairing:pinned', (p) => {
    if (!id.current || p.pairing_id.join(',') !== id.current.join(',')) return;
    finished.current = true;
    setDone(true);
    endFlow(mode === 'shop' ? W.shop.done : W.wallet.connected);
  });
  const stop = () => {
    finished.current = true;
    if (id.current) void abortRef.current({ pairing_id: id.current as never, code: null });
    endFlow(mode === 'shop' ? W.shop.stopped : W.wallet.stopped);
  };
  useEffect(() => () => { if (!finished.current && id.current) void abortRef.current({ pairing_id: id.current as never, code: null }); }, []);
  return (
    <>
      <p className="cnf-q">{mode === 'shop' ? W.shop.secureQ : W.wallet.secureQ}</p>
      <SecureStep kind="pairing" draft={null} pairing={pairing} done={done} onCancel={stop} />
    </>
  );
}

// ---- the practice shop ----------------------------------------------------------------------------

function ShopAsk() {
  const s = useSettings().data;
  const line = !s ? W.shop.off : s.house === 'unavailable' ? W.shop.unavailable : s.house_connected ? W.shop.on : s.house === 'waking' ? W.shop.waking : W.shop.off;
  const can = !!s && s.house !== 'unavailable' && !s.house_connected;
  return (
    <>
      <p className="cnf-state" role="status">{line}</p>
      {can ? <p className="cnf-q">{W.shop.connectQ}</p> : null}
      <div className="fc-choices">
        {can ? <Btn kind="gold" sm onClick={() => advanceFlow(W.shop.off, 'shop-payee', { mode: 'shop' })}>{W.shop.connect}</Btn> : null}
        {!can ? <Btn sm onClick={() => endFlow(line)}>{W.shop.keep}</Btn> : null}
      </div>
    </>
  );
}

// ---- the agent app --------------------------------------------------------------------------------

const engineName = (id: string): string => (id === 'scripted' ? W.app.practice : id);

function AppAsk() {
  const s = useSettings().data;
  const locked = useLocked();
  const engines = useQuery('engine_status', null, { refreshOn: ['settings:changed'] });
  const now = s ? (s.selected_engine === 'scripted' && !s.engine_chosen ? W.app.noneYet : W.app.now(engineName(s.selected_engine))) : W.app.lookingFor;
  return (
    <>
      <p className="cnf-state" role="status">{now}</p>
      {locked ? <p className="cnf-hint">{W.app.locked}</p> : <p className="cnf-q">{W.app.q}</p>}
      {engines.error ? <WalletNotice error={engines.error} what={NOTICE_WHAT.agentApp} /> : null}
      <div className="fc-choices" role="group" aria-label={W.app.q}>
        {(engines.data ?? []).map((e) => (
          <Btn key={e.id} sm disabled={!e.available || !s || locked} data-engine={e.id}
            onClick={() => advanceFlow(engineName(e.id), 'app-consent', { engine: e.id })}>
            {engineName(e.id)}{e.available ? '' : ` · ${W.app.off}`}
          </Btn>
        ))}
      </div>
    </>
  );
}

/** The consent press this card draws: only it calls engine_select. */
function AppConsent({ engine }: { engine: string }) {
  const select = useMutation('engine_select');
  const name = engineName(engine);
  const go = async () => {
    if (select.pending) return;
    if ((await select.run({ engine: engine as EngineId })) !== undefined) endFlow(W.app.switched(name));
  };
  return (
    <>
      <p className="cnf-q">{W.app.consentQ(name)}</p>
      <p className="cnf-hint">{W.app.consentNote}</p>
      <div className="fc-choices"><Btn kind="gold" sm disabled={select.pending} onClick={() => void go()}>{W.app.consent(name)}</Btn></div>
      {select.error ? <WalletNotice error={select.error} what={NOTICE_WHAT.agentApp} /> : null}
    </>
  );
}

// TOUR round 4, the turns the setup says in the conversation (host.say puts them under an assistant
// line). ONE turn = ONE step = ONE component, and only the live turn is open: an older one folds to a
// line (done, or "Moved below" when the same step was offered again under an answer).
//   paypal    the secure step, keys (SecureStep kind=keys)
//   rules     the proposal in plain words (rules.ts, read by the wallet's reader), "Looks right" ->
//             the secure step with that draft (kind=rules), "Change something" -> she says it below
//   practice  house_wake + pairing_join HOUSE here (main commands, as PairingDesk), then the secure
//             step on that pairing (kind=pairing): the four words and Confirm
//   engine    one row of choices: engine_select (a main command)
// A turn never decides a step is done: useStart does, from the world, and the flow moves on.
// Each card reads the flow and the wallet itself: Stage keeps the element as it was said.
import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { EngineId } from '@bindings/EngineId';
import { useCalm } from '../../../../design/motion';
import { clockNow } from '../../../../lib/clock';
import { useMutation, useQuery } from '../../../../lib/hooks';
import { currencyText } from '../../../../lib/say/read';
import { NOTICE_WHAT, START_STEP, type StartStepKey } from '../../../../lib/words';
import { PAIR } from '../../../../lib/words/connections';
import { WalletNotice } from '../../../../shared/honesty';
import { Btn, Field, Icon } from '../../../../shared/ui';
import { canSubmit, payeeProblem } from '../../setup/pairing';
import { useStart } from '../../setup/start';
import { useLocked, useSettings } from '../../world';
import { tr, TRAVEL } from '../fx';
import type { HomeRegion } from './host';
import { SecureStep } from '../secure/SecureStep';
import { factDone, isDone, ORDER, setFlow, spotOn, stepN, useFlow } from './flow';
import { HOUSE_PAYEE, proposalOf, rulesCtx, type RulesProposal } from './rules';
import { STEP, TOUR_W } from './words';

/** What the turns ask the flow to do (Guide implements it; stable for the session). */
export type TurnApi = { skip(): void; resume(): void; change(): void };

const usd = (minor: number): string => currencyText(minor, 'USD');

/** A turn's card arriving under its line. */
function Arrive({ children, className, ...data }: { children: ReactNode; className: string } & Record<`data-${string}`, string>) {
  const calm = useCalm();
  return (
    <motion.article className={className} {...data} initial={calm ? false : { opacity: 0, y: TRAVEL.tick }} animate={{ opacity: 1, y: 0 }} transition={tr('med', calm, 'out')}>
      {children}
    </motion.article>
  );
}

function DoneLine({ step }: { step: StartStepKey }) {
  return (
    <p className="st-doneline" data-st-turn={step} data-state="done">
      <span className="st-tick" aria-hidden="true"><Icon name="check" size={11} /></span>
      <span>{START_STEP[step].done}</span>
    </p>
  );
}

/** One step's turn. */
export function StepTurn({ step, serial, api }: { step: StartStepKey; serial: number; api: TurnApi }) {
  const flow = useFlow();
  const gs = useStart();
  const done = isDone(gs, step);
  const live = flow.live === serial && flow.status === 'active';
  if (!live) {
    const newest = flow.lastOf[step] === serial;
    if (done) return newest ? <DoneLine step={step} /> : null;
    // paused on this turn: the "Continue setup" turn below speaks for it
    return flow.status === 'skipped' || !newest && flow.step !== step ? null : <p className="st-quiet" data-st-turn={step} data-state="folded">{TOUR_W.folded}</p>;
  }
  const w = STEP[step];
  return (
    <Arrive className={`st-turn${done ? ' is-done' : ''}`} data-st-turn={step} data-state={done ? 'done' : 'live'}>
      <header className="st-turn-h">
        <b className="st-turn-t">{w.short}</b>
        <span className="st-of num" aria-label={`Step ${TOUR_W.stepOf(stepN(step), ORDER.length)}`}>{TOUR_W.stepOf(stepN(step), ORDER.length)}</span>
      </header>
      <p className="st-why">{w.why}</p>
      {step === 'paypal' ? <KeysBody done={done} /> : null}
      {step === 'rules' ? <RulesBody done={done} api={api} /> : null}
      {step === 'practice' ? <PracticeStep /> : null}
      {done ? null : (
        <footer className="st-turn-f">
          <button type="button" className="linkbtn st-skip" onClick={api.skip} title={TOUR_W.skipTitle}>{TOUR_W.skip}</button>
        </footer>
      )}
    </Arrive>
  );
}

/** The secure step, with a way back in when she closed it without finishing. */
function Secure({ kind, draft, pairing, done, onCancel }: { kind: 'keys' | 'rules' | 'pairing'; draft: string | null; pairing: string | null; done: boolean; onCancel?: () => void }) {
  const [closed, setClosed] = useState(0);
  const [shut, setShut] = useState(false);
  if (shut && !done) {
    return (
      <div className="st-closed">
        <span className="st-quiet">{TOUR_W.closed}</span>
        <Btn sm onClick={() => { setShut(false); setClosed((n) => n + 1); }}>{TOUR_W.reopen}</Btn>
      </div>
    );
  }
  return <SecureStep key={closed} kind={kind} draft={draft} pairing={pairing} done={done} onCancel={() => { if (onCancel) onCancel(); else setShut(true); }} />;
}

function KeysBody({ done }: { done: boolean }) {
  return <Secure kind="keys" draft={null} pairing={null} done={done} />;
}

// ---- rules ---------------------------------------------------------------------------------------

function RulesBody({ done, api }: { done: boolean; api: TurnApi }) {
  const flow = useFlow();
  const calm = useCalm();
  const here = useRef<HTMLSpanElement>(null);
  // "Looks right" swaps the proposal for the secure step in place: bring the turn's head into view.
  useEffect(() => {
    if (flow.rulesPhase !== 'sign') return;
    const id = requestAnimationFrame(() => here.current?.closest('.st-turn')?.scrollIntoView?.({ block: 'start', behavior: calm ? 'auto' : 'smooth' }));
    return () => cancelAnimationFrame(id);
  }, [flow.rulesPhase, calm]);
  const p = useMemo(() => {
    const now = Math.floor(clockNow() / 60) * 60;
    return proposalOf(flow.rules, rulesCtx(now, -new Date(now * 1000).getTimezoneOffset()));
  }, [flow.rules]);
  const draft = useMemo(() => (p ? JSON.stringify(p.draft) : null), [p]);
  if (!p) return <p className="st-quiet">{TOUR_W.rulesUnread}</p>;
  if (flow.rulesPhase === 'sign' || done) {
    return <><span ref={here} hidden /><Secure kind="rules" draft={draft} pairing={null} done={done} onCancel={() => setFlow({ rulesPhase: 'propose' })} /></>;
  }
  return (
    <>
      <RulesSummary p={p} />
      {flow.changing ? <p className="st-hint" role="status">{TOUR_W.changeHint}</p> : null}
      <div className="st-acts">
        <Btn kind="gold" onClick={() => setFlow({ rulesPhase: 'sign', changing: false })} data-st-looks-right="">{TOUR_W.looksRight}</Btn>
        <Btn kind="plain" onClick={api.change} aria-pressed={flow.changing}>{TOUR_W.change}</Btn>
      </div>
    </>
  );
}

const fmtUntil = (at: number): string =>
  new Date(at * 1000).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** The proposal in plain words, read back from the clauses the draft will carry. */
export function RulesSummary({ p }: { p: RulesProposal }) {
  const s = p.summary;
  const lines: { k: string; text: string }[] = [];
  if (s.perDeal !== null) lines.push({ k: 'per-deal', text: TOUR_W.perDeal(usd(s.perDeal)) });
  if (s.perDay !== null) lines.push({ k: 'per-day', text: TOUR_W.perDay(usd(s.perDay)) });
  if (s.askAbove !== null) lines.push({ k: 'ask', text: s.askAbove === 0 ? TOUR_W.askAlways : TOUR_W.askAbove(usd(s.askAbove)) });
  lines.push({ k: 'payees', text: s.payees.length === 1 && s.payees[0] === HOUSE_PAYEE ? TOUR_W.payees : TOUR_W.payeesOther(s.payees.join(', ')) });
  if (s.until !== null) lines.push({ k: 'until', text: TOUR_W.until(fmtUntil(s.until)) });
  return (
    <section className="st-rules" aria-label={TOUR_W.rulesKick} data-st-rules="">
      <h3 className="st-kick">{TOUR_W.rulesKick}</h3>
      <ul className="st-rules-l">
        {lines.map((l) => <li key={l.k} data-rule={l.k}>{l.text}</li>)}
      </ul>
    </section>
  );
}

// ---- practice: the agent app first (one row of choices), then the practice shop -------------------
// One turn, one thing at a time: the app choice folds to its done line before the shop's form shows.

function PracticeStep() {
  const gs = useStart();
  const app = factDone(gs, 'engine');
  const shop = factDone(gs, 'practice');
  return (
    <>
      {app ? <DoneLine step="engine" /> : <EngineBody done={false} />}
      {app || shop ? <PracticeBody done={shop} /> : null}
    </>
  );
}

// ---- practice shop -------------------------------------------------------------------------------

function PracticeBody({ done }: { done: boolean }) {
  const flow = useFlow();
  const house = useSettings().data?.house ?? null;
  const wake = useMutation('house_wake');
  const join = useMutation('pairing_join');
  const [payee, setPayee] = useState('');
  const problem = payeeProblem(payee);
  const busy = wake.pending || join.pending || house === 'waking';
  const ok = !!house && canSubmit('house', { payee, code: '' }, house);
  const go = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok || busy || !house) return;
    if (house === 'idle' && (await wake.run(null)) === undefined) return;
    const r = await join.run({ code: 'HOUSE', side: 'buyer', payee: payee.trim(), peer: null });
    if (r) setFlow({ pairing: JSON.stringify(r.pairing_id) });
  };
  if (flow.pairing || done) return <Secure kind="pairing" draft={null} pairing={flow.pairing} done={done} onCancel={() => setFlow({ pairing: null })} />;
  if (house === 'unavailable') return <p className="st-quiet">{TOUR_W.shopUnavailable}</p>;
  return (
    <form className="st-join" onSubmit={(e) => void go(e)}>
      <label className="st-field" htmlFor="st-payee" title={TOUR_W.paidToTitle}>{TOUR_W.paidTo}</label>
      <div className="st-joinrow">
        <Field id="st-payee" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder={TOUR_W.paidToHint} autoComplete="off" spellCheck={false}
          aria-invalid={problem ? true : undefined} aria-describedby={problem ? 'st-payee-p' : undefined} />
        <Btn kind="gold" type="submit" disabled={!ok || busy}>{busy ? TOUR_W.waking : TOUR_W.connect}</Btn>
      </div>
      {problem ? <span id="st-payee-p" className="ui-hint" role="alert">{PAIR.payeeProblem[problem]}</span> : null}
      {wake.error ? <WalletNotice error={wake.error} what={TOUR_W.shopWhat} /> : null}
      {join.error ? <WalletNotice error={join.error} what={TOUR_W.shopWhat} /> : null}
    </form>
  );
}

// ---- agent app -----------------------------------------------------------------------------------

function EngineBody({ done }: { done: boolean }) {
  const s = useSettings().data;
  const engines = useQuery('engine_status', null, { refreshOn: ['settings:changed'] });
  const select = useMutation('engine_select');
  const locked = useLocked();
  const pick = (id: EngineId) => { if (!select.pending) void select.run({ engine: id }); };
  const chosen = (id: EngineId): boolean => !!s && s.selected_engine === id && (id !== 'scripted' || !!s.engine_chosen);
  const apps = (engines.data ?? []).filter((e) => e.id !== 'scripted');
  return (
    <>
      <div className="st-engines" role="radiogroup" aria-label={TOUR_W.engineLabel}>
        {apps.map((e) => (
          <button key={e.id} type="button" role="radio" aria-checked={chosen(e.id)} className={`st-engine${chosen(e.id) ? ' is-on' : ''}`}
            disabled={!e.available || !s || done || locked} onClick={() => pick(e.id)} data-engine={e.id}>
            <b>{e.id}</b>{e.available ? null : <span>{TOUR_W.engineOff}</span>}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={chosen('scripted')} className={`st-engine${chosen('scripted') ? ' is-on' : ''}`}
          disabled={!s || done || locked} onClick={() => pick('scripted')} title={TOUR_W.enginePracticeTitle} data-engine="scripted">
          <b>{TOUR_W.enginePractice}</b>
        </button>
      </div>
      {done ? <DoneLine step="engine" /> : null}
      {engines.error ? <WalletNotice error={engines.error} what={NOTICE_WHAT.agentApp} /> : null}
      {select.error ? <WalletNotice error={select.error} what={NOTICE_WHAT.agentApp} /> : null}
    </>
  );
}

// ---- paused, and the end -------------------------------------------------------------------------

/** "Continue setup": live only while the flow is paused on this turn. */
export function PausedTurn({ serial, api }: { serial: number; api: TurnApi }) {
  const flow = useFlow();
  if (flow.status !== 'skipped' || flow.live !== serial) return null;
  return <div className="st-acts"><Btn kind="gold" sm onClick={api.resume} data-st-continue="">{TOUR_W.continue}</Btn></div>;
}

/** "You're set": three tiny pointers; each lights its region on hover, focus or click. */
export function SetTurn() {
  const point = (region: HomeRegion, text: string) => spotOn({ region }, text);
  return (
    <Arrive className="st-set" data-st-turn="set">
      <span className="st-kick">{TOUR_W.where}</span>
      <ul className="st-pointers">
        {TOUR_W.pointers.map((p) => (
          <li key={p.region}>
            <button type="button" className="st-pointer" data-pointer={p.region}
              onMouseEnter={() => point(p.region, p.spot)} onFocus={() => point(p.region, p.spot)} onClick={() => point(p.region, p.spot)}>
              {p.label}
            </button>
          </li>
        ))}
      </ul>
    </Arrive>
  );
}

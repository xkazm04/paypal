// The answer area: the ten kinds of panel the assistant (or a click) can put beside the board. Each is
// a thin read of something the console already reads. A panel only reads and hands off: the one gold
// button of the view is either the decision panel's "Review in approval window" or, on a brand-new
// wallet, the next setup step's hand-off; both go through `host.run`, which is approval_open or a
// plain navigation to the console. Nothing here approves, signs, captures, voids or releases.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { WalletError } from '../../../lib/contract';
import { formatMinor, formatMoney } from '../../../lib/format';
import { useQuery } from '../../../lib/hooks';
import { FATES, MODULE_KEYS, type Fate, type PanelSpec } from '../../../lib/assistant';
import { rulesInForce, SETUP_STEP_OF } from '../../../lib/firstRun';
import {
  APPROVAL_LOCKED_TITLE, BOARD_BOOK, BOARD_DEAL, BOARD_DECISION, BOARD_FATE, BOARD_IF_NOTHING, BOARD_MONEY, BOARD_NEEDS, BOARD_NO_DEADLINE, BOARD_PANEL_TITLE, BOARD_RESCUE, BOARD_RULES, BOARD_SAFETY,
  BOARD_SETUP, BOARD_WEEK, START_STEP, type StartStepKey,
} from '../../../lib/words';
import { clockNow } from '../../../lib/clock';
import { Countdown, WalletNotice } from '../../../shared/honesty';
import { Glyph, MODULE } from '../../../shared/modules';
import { StartSteps, type StepAction } from '../../../shared/start';
import { Btn, Hourglass, Kv, Loading, Meter, Silence } from '../../../shared/ui';
import { agentTitle, rulesAnswer } from '../setup/limits';
import { useStart } from '../setup/start';
import { formatHash } from '../logic';
import { Amount, NotYet, Shape } from './parts';
import type { Run } from './resolve';
import type { BoardKey, BoardModel } from './useBoardModel';

/** What the panels may do. Every `run` is approval_open or a navigation to the console. */
export type PanelHost = {
  model: BoardModel;
  run: (r: Run) => void;
  pending: boolean;
  error: WalletError | null;
  locked: boolean;
  /** Open the panel behind a key (the decision for a needs-you key, else the deal). */
  pick: (id: string) => void;
  /** Filter the board to a module and/or a column. */
  filterTo: (m: import('@bindings/Module').Module | null, f: Fate | null) => void;
};

export function panelTitle(p: PanelSpec): string {
  return BOARD_PANEL_TITLE[p.kind];
}

/** `primary`: this panel is the region's focus. Only the focus panel draws its hand-off gold, so the
 *  page keeps exactly one gold action however many answers the region holds. */
export function Answer({ panel, host, primary = true }: { panel: PanelSpec; host: PanelHost; primary?: boolean }) {
  switch (panel.kind) {
    case 'needs': return <NeedsPanel module={panel.module} host={host} />;
    case 'decision': return <DecisionPanel id={panel.deal_id} host={host} primary={primary} />;
    case 'deal': return <DealPanel id={panel.deal_id} host={host} />;
    case 'money': return <MoneyPanel host={host} />;
    case 'rules': return <RulesPanel host={host} />;
    case 'rescue': return <RescuePanel host={host} />;
    case 'safety': return <SafetyPanel host={host} />;
    case 'book': return <BookPanel module={panel.module} fate={panel.fate} host={host} />;
    case 'week': return <WeekPanel host={host} />;
    case 'setup': return <SetupPanel host={host} primary={primary} />;
  }
}

// ---- the one gold hand-off ---------------------------------------------------------------------------

function HandOff({ label, title, host, run, gold, onRun }: { label: string; title: string; host: PanelHost; run: Run; gold: boolean; onRun?: (r: Run) => void }) {
  return (
    <Btn kind={gold ? 'gold' : 'default'} locked={host.locked} disabled={host.pending} onClick={() => (onRun ?? host.run)(run)} title={host.locked ? APPROVAL_LOCKED_TITLE : title} data-handoff={run.kind === 'approval' ? 'approval' : 'console'}>
      {host.pending ? BOARD_DECISION.opening : label}
    </Btn>
  );
}

/** A failed hand-off to the approval window says so ONCE, beside the control that was pressed: the
 *  host holds one error for the whole page, so each surface that hands off (a panel here, the home's
 *  need card and item page) sends its runs through `run` and draws `notice`, which shows only the
 *  failure its own press started. It clears on the next open (the host clears its error) and when
 *  the surface goes away. */
export function useOwnOpen(host: PanelHost): { run: (r: Run) => void; notice: ReactNode } {
  const [armed, setArmed] = useState(false);
  const [owned, setOwned] = useState<WalletError | null>(null);
  const wasPending = useRef(host.pending);
  useEffect(() => {
    if (wasPending.current && !host.pending && armed) { setArmed(false); setOwned(host.error); }
    wasPending.current = host.pending;
  }, [host.pending, host.error, armed]);
  const run = (r: Run) => {
    if (r.kind === 'approval') { setArmed(true); setOwned(null); }
    host.run(r);
  };
  const notice = owned && host.error === owned ? <WalletNotice error={owned} what={BOARD_DECISION.review} /> : null;
  return { run, notice };
}

const consoleHash = (id: string): string => formatHash({ level: 'deal', deal: id });

// ---- needs / decision / deal ------------------------------------------------------------------------

function NeedsPanel({ module, host }: { module: import('@bindings/Module').Module | null; host: PanelHost }) {
  const keys = MODULE_KEYS.filter((m) => !module || m === module).flatMap((m) => host.model.cells[m].needs.keys)
    .sort((a, b) => (a.deadline_s ?? Infinity) - (b.deadline_s ?? Infinity));
  if (!keys.length) return <p className="sb-quiet">{BOARD_NEEDS.none}</p>;
  return (
    <>
      <p className="sb-lead">{BOARD_NEEDS.lead(keys.length)}</p>
      <ul className="sb-list">{keys.map((k) => <KeyRow key={k.id} k={k} host={host} silence />)}</ul>
    </>
  );
}

/** One deal as a card (the Proof Table's deal row): title and amount, its state, area and label, and
 *  for a needs-you deal what silence does. The rail on its edge is its fate's colour. */
function KeyRow({ k, host, silence }: { k: BoardKey; host: PanelHost; silence?: boolean }) {
  const meta = MODULE[k.module];
  return (
    <li>
      <button type="button" className={`sb-lrow f-${k.fate}`} style={{ '--mc': meta.cssVar } as React.CSSProperties} onClick={() => host.pick(k.id)} data-pick={k.id}>
        <span className="sb-t">{k.title}</span>
        <Amount k={k} />
        <span className="sb-m">
          <span className={`sb-st c-${k.fate}`}><Shape fate={k.fate} size={11} /> {k.fate === 'needs' ? (k.deadline_s !== null ? <Countdown deadline={k.deadline_s} /> : BOARD_NO_DEADLINE) : k.state_word}</span>
          <span className="sb-area"><Glyph module={k.module} className="sb-kglyph" />{meta.name}</span>
          <span className="sb-ref">{k.label}</span>
        </span>
        {silence && k.on_silence ? <span className="sb-q"><Hourglass className="sb-q-ic" /><span><b>{BOARD_IF_NOTHING}:</b> {k.on_silence}</span></span> : null}
      </button>
    </li>
  );
}

function DecisionPanel({ id, host, primary }: { id: string; host: PanelHost; primary: boolean }) {
  const own = useOwnOpen(host);
  const k = host.model.byId.get(id);
  if (!k) return <p className="sb-quiet">{BOARD_DECISION.gone}</p>;
  if (k.fate !== 'needs') return <DealPanel id={id} host={host} note={BOARD_DECISION.notWaiting} />;
  const meta = MODULE[k.module];
  return (
    <div className="sb-decision" data-decision={k.id}>
      <h4 className="sb-h"><Glyph module={k.module} className="sb-kglyph" />{k.title}</h4>
      <Kv items={[
        [BOARD_DECISION.why, k.why ?? BOARD_FATE.needs.means],
        [BOARD_DECISION.amount, <Amount key="a" k={k} />],
        [BOARD_DECISION.deadline, k.deadline_s !== null ? <Countdown key="d" deadline={k.deadline_s} /> : BOARD_NO_DEADLINE],
        [BOARD_DECISION.with, `${meta.name} · ${k.state_word}`],
      ]} />
      <p className="sb-silence">{k.on_silence ? <Silence text={k.on_silence} deadline={k.deadline_s} /> : <Silence text={BOARD_FATE.needs.means} />}</p>
      <p className="sb-quiet">{BOARD_DECISION.handoff}</p>
      <div className="sb-actions">
        {k.review
          ? <HandOff label={BOARD_DECISION.review} title={BOARD_DECISION.reviewTitle} host={host} run={{ kind: 'approval', deal_id: k.id, target: null }} gold={primary} onRun={own.run} />
          : <HandOff label={BOARD_DEAL.open} title={BOARD_DEAL.openTitle} host={host} run={{ kind: 'console', hash: consoleHash(k.id) }} gold={false} />}
      </div>
      {own.notice}
    </div>
  );
}

function DealPanel({ id, host, note }: { id: string; host: PanelHost; note?: string }) {
  const k = host.model.byId.get(id);
  if (!k) return <p className="sb-quiet">{BOARD_DECISION.gone}</p>;
  const meta = MODULE[k.module];
  return (
    <div className="sb-deal" data-deal-panel={k.id}>
      <h4 className="sb-h"><Glyph module={k.module} className="sb-kglyph" />{k.title}</h4>
      {note ? <p className="sb-quiet">{note}</p> : null}
      <Kv items={[
        [BOARD_DEAL.state, <span key="s" className={`sb-st c-${k.fate}`}><Shape fate={k.fate} size={11} /> {BOARD_FATE[k.fate].word} · {k.state_word}</span>],
        [BOARD_DEAL.amount, <Amount key="a" k={k} />],
        [BOARD_DEAL.module, meta.name],
        k.deadline_s !== null ? [BOARD_DEAL.deadline, <Countdown key="d" deadline={k.deadline_s} />] : null,
        k.on_silence ? [BOARD_DEAL.onSilence, k.on_silence] : null,
      ]} />
      <div className="sb-actions">
        <HandOff label={BOARD_DEAL.open} title={BOARD_DEAL.openTitle} host={host} run={{ kind: 'console', hash: consoleHash(k.id) }} gold={false} />
        {k.fate === 'needs' ? <Btn onClick={() => host.pick(k.id)}>{BOARD_PANEL_TITLE.decision}</Btn> : null}
      </div>
    </div>
  );
}

// ---- money ---------------------------------------------------------------------------------------------

function MoneyPanel({ host }: { host: PanelHost }) {
  const inst = host.model.instruments;
  const lim = inst.limits;
  if (!lim) return <p className="sb-quiet">{BOARD_MONEY.none}</p>;
  const cur = inst.currency;
  const fmt = (n: number | null) => (n === null || cur === null ? null : formatMinor(n, cur as import('@bindings/Currency').Currency));
  return (
    <>
      <p className="sb-lead">{BOARD_MONEY.lead}</p>
      <p className="sb-quiet">{lim.line}</p>
      <ul className="sb-meters">
        {lim.meters.map((m) => (
          <li key={m.key} title={m.why}>
            <span className="sb-l"><b>{m.label}</b><span className="num">{m.value}{m.of ? <small> {m.of}</small> : null}</span></span>
            <Meter value={m.fill} tone={m.near ? 'gold' : undefined} label={m.label} />
          </li>
        ))}
      </ul>
      <Kv items={[
        [BOARD_MONEY.roomLeft, fmt(inst.room_left_minor) ?? <NotYet key="r" />],
        [BOARD_MONEY.paidOut, fmt(inst.paid_out_minor) ?? <NotYet key="o" />],
        [BOARD_MONEY.paidIn, fmt(inst.paid_in_minor) ?? <NotYet key="i" />],
      ]} />
    </>
  );
}

// ---- rules ------------------------------------------------------------------------------------------------

function RulesPanel({ host: _host }: { host: PanelHost }) {
  const q = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  const now = clockNow();
  const list = q.data;
  const n = list ? rulesInForce(list, now) : null;
  const answer = list ? rulesAnswer(list, now) : null;
  if (q.error && !list) return <p className="sb-quiet">{BOARD_RULES.unknown}</p>;
  if (!list) return <Loading what="your rules" />;
  return (
    <>
      <p className="sb-lead">{n ? BOARD_RULES.count(n) : BOARD_RULES.none}</p>
      {answer ? <p className="sb-quiet">{answer.title}. {answer.sub}</p> : null}
      <ul className="sb-plain">
        {list.map((m, i) => <li key={`${m.agent}:${m.payload.id}:${i}`}>{agentTitle(m.agent)}</li>)}
      </ul>
      <p className="sb-quiet">{BOARD_RULES.line} {BOARD_RULES.changeIn}</p>
    </>
  );
}

// ---- rescue -----------------------------------------------------------------------------------------------

function RescuePanel({ host }: { host: PanelHost }) {
  const q = useQuery('rescue_book', null, { refreshOn: ['deal:changed', 'receipt:created', 'attention:changed'] });
  const mine = FATES.flatMap((f) => host.model.cells.rescue[f].keys);
  if (q.error && !q.data) return <p className="sb-quiet">{BOARD_RESCUE.unknown}</p>;
  if (!q.data) return <Loading what="failed renewals" />;
  const b = q.data;
  return (
    <>
      <p className="sb-lead">{mine.length ? BOARD_RESCUE.cases(mine.length) : BOARD_RESCUE.none}</p>
      <ul className="sb-list">{mine.slice(0, 12).map((k) => <KeyRow key={k.id} k={k} host={host} />)}</ul>
      <Kv items={[
        [BOARD_RESCUE.recovered, b.recovered.length ? b.recovered.map((m) => formatMoney(m)).join(' · ') : <NotYet key="n" />],
        [BOARD_RESCUE.watching, String(b.watching.length)],
      ]} />
    </>
  );
}

// ---- safety -----------------------------------------------------------------------------------------------

function SafetyPanel({ host: _host }: { host: PanelHost }) {
  const q = useQuery('safety_record', null);
  if (q.error && !q.data) return <p className="sb-quiet">{BOARD_SAFETY.unknown}</p>;
  if (!q.data) return <Loading what="your safety record" />;
  const r = q.data;
  return (
    <>
      <p className={`sb-lead ${r.intact ? 'okc' : 'badc'}`}>{r.intact ? BOARD_SAFETY.intact : BOARD_SAFETY.broken}</p>
      <Kv items={[
        [BOARD_SAFETY.entries, String(r.records)],
        r.intact ? [BOARD_SAFETY.deals, `${r.deals_checked} of ${r.deals_total}`] : null,
        r.intact ? [BOARD_SAFETY.refused, String(r.refusals)] : null,
      ]} />
      <p className="sb-quiet">{r.intact && r.violations_total === 0 ? BOARD_SAFETY.clean : r.violations_total ? BOARD_SAFETY.found(r.violations_total) : ''}</p>
    </>
  );
}

// ---- book (a slice of the board as a list) -----------------------------------------------------------------

const PAGE = 40;

function BookPanel({ module, fate, host }: { module: import('@bindings/Module').Module | null; fate: Fate | null; host: PanelHost }) {
  const [shown, setShown] = useState(PAGE);
  const keys = useMemo(
    () => host.model.keys.filter((k) => (!module || k.module === module) && (!fate || k.fate === fate)).sort((a, b) => (b.stamp_s ?? 0) - (a.stamp_s ?? 0)),
    [host.model.keys, module, fate],
  );
  const scope = [module ? MODULE[module].name : null, fate ? BOARD_FATE[fate].word : null].filter(Boolean).join(' · ') || BOARD_BOOK.scopeAll;
  if (!keys.length) return <><p className="sb-lead">{scope}</p><p className="sb-quiet">{BOARD_BOOK.none}</p></>;
  return (
    <>
      <p className="sb-lead">{scope}</p>
      <p className="sb-quiet">{BOARD_BOOK.showing(Math.min(shown, keys.length), keys.length)}</p>
      <ul className="sb-list">{keys.slice(0, shown).map((k) => <KeyRow key={k.id} k={k} host={host} />)}</ul>
      {keys.length > shown ? <Btn sm onClick={() => setShown((s) => s + PAGE)}>{BOARD_BOOK.more}</Btn> : null}
    </>
  );
}

// ---- week ---------------------------------------------------------------------------------------------------

function WeekPanel({ host }: { host: PanelHost }) {
  const m = host.model;
  const total = MODULE_KEYS.reduce((s, k) => s + m.week[k].total, 0);
  if (!total) return <p className="sb-quiet">{BOARD_WEEK.none}</p>;
  return (
    <>
      <p className="sb-lead">{BOARD_WEEK.lead(total)}</p>
      <ul className="sb-plain">
        {MODULE_KEYS.map((k) => (m.week[k].total ? <li key={k}><b>{MODULE[k].name}</b> <span className="num">{m.week[k].total}</span></li> : null))}
      </ul>
      <Kv items={FATES.map((f) => [BOARD_FATE[f].word, <span key={f} className="num">{m.colCount[f]}</span>] as const)} />
    </>
  );
}

// ---- setup --------------------------------------------------------------------------------------------------

function SetupPanel({ host, primary }: { host: PanelHost; primary: boolean }) {
  const gs = useStart();
  const own = useOwnOpen(host);
  const runFor = (key: StartStepKey): Run => {
    if (key === 'paypal') return { kind: 'approval', deal_id: null, target: 'credentials' };
    if (key === 'rules') return { kind: 'approval', deal_id: null, target: 'mandate' };
    return { kind: 'console', hash: formatHash({ level: 'setup', step: SETUP_STEP_OF[key] }) };
  };
  const action = (key: StartStepKey): StepAction => ({ label: START_STEP[key].act, title: START_STEP[key].where, run: () => own.run(runFor(key)) });
  const next = gs.next;
  return (
    <div className="sb-setup" data-setup>
      <p className="sb-lead">{BOARD_SETUP.lead}</p>
      <StartSteps gs={gs} action={action} busy={host.pending ? next : null} />
      <p className="sb-quiet">{host.model.keys.length ? BOARD_SETUP.promise : `${BOARD_SETUP.empty} ${BOARD_SETUP.promise}`}</p>
      <div className="sb-actions">
        {next
          ? <HandOff label={BOARD_SETUP.next(START_STEP[next].title)} title={START_STEP[next].where} host={host} run={runFor(next)} gold={primary} onRun={own.run} />
          : gs.done === gs.total ? <span className="sb-quiet">{BOARD_SETUP.allDone}</span> : null}
      </div>
      {own.notice}
    </div>
  );
}

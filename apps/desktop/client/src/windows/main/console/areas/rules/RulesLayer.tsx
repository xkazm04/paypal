// Agent rules (#p=rules) and the wallet limits (#p=limits), layers of the one main window (rebuild
// WP3c). Rules: one answer ("3 agents work inside limits you signed"), a "Your call" line when a
// set is missing or not in force (the one gold hand-off: sign in the approval window), four cards
// (in force, not in force, the lowest "asks you above", the wallet limits one layer down), then the
// rule sets as a windowed list beside the picked set's full text. Scale finding #15: each set has a
// plain name (its agent and what it is for), its limits, its version and its state, so several sets
// of one agent can be told apart. Signing, new versions and withdrawing happen only in the approval
// window: Change only hands off (approval_open target mandate). Read-only otherwise.
import { useMemo, useState, type CSSProperties } from 'react';
import type { Clause } from '@bindings/Clause';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import type { Money } from '@bindings/Money';
import { shortHash, shortId } from '../../../../../lib/format';
import { useNow, useQuery } from '../../../../../lib/hooks';
import { readLimits } from '../../../../../lib/limits';
import {
  kindWord, LIMIT_WORDS, LOADING_WHAT, NOTICE_WHAT, LIMITS_LAYER, LIMITS_PLACE, RULE_NAME, RULES_ACT, RULES_CARD, RULES_CATEGORY, RULES_DOC, RULES_EXPLAIN, RULES_IF, RULES_KICKER, RULES_LIST, RULES_STATE,
  NO_WALLET_LIMIT, ruleSentence, WALLET_LIMITS_ABOUT,
} from '../../../../../lib/words';
import { WalletNotice } from '../../../../../shared/honesty';
import { Chip, Disclosure, Kv, Loading, Meter, Silence, UNKNOWN, type ChipTone } from '../../../../../shared/ui';
import { agentTitle, limitLines, rulesAnswer, ruleState } from '../../../setup/limits';
import { useAttention, useDeals, useNeeds, useSettings } from '../../../world';
import type { LayerProps } from '../../layers';
import type { LatestProps } from '../../Latest';
import { ListEngine, type ListFilter, type ListSort } from '../../ListEngine';
import { Amount } from '../../rows';
import { fitHeight, PlaceFrame, type CallLine, type LensCard } from '../settings/frame';
import { ToApproval } from '../settings/handoff';
import { paidTodayText, usePaidToday } from '../book/today';

const shortDate = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const dateLabel = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const keyOf = (m: MandateListEntry) => `${m.payload.id}:${m.payload.version}`;
const AGENT_ORDER: readonly string[] = ['shopper', 'negotiator', 'assistant'];
const AGENT_TONE: Record<string, string> = { shopper: 'var(--teal)', negotiator: 'var(--coral)', assistant: 'var(--gold)' };
const rank = (a: string) => { const i = AGENT_ORDER.indexOf(a); return i < 0 ? AGENT_ORDER.length : i; };

/** In force: signed, inside its dates, and still fitting what the wallet accepts. */
const inForce = (m: MandateListEntry, now: number) => ruleState(m.payload, now) === 'active' && m.owner_sig.length > 0 && !m.refusal;

/** What a rule set is for, in plain words: the kinds of deal and what they buy ("purchases of
 *  office supplies, parts"); the roles when it names no kind. */
export function purposeOf(clauses: readonly Clause[]): string {
  const per = clauses.filter((c): c is Extract<Clause, { type: 'per_deal' }> => c.type === 'per_deal');
  if (per.length) {
    const kinds = [...new Set(per.map((c) => kindWord(c.kind)))];
    const cats = [...new Set(per.flatMap((c) => c.categories.map((k) => RULES_CATEGORY[k])))];
    return cats.length ? `${kinds.join(', ')} · ${cats.join(', ')}` : kinds.join(', ');
  }
  const roles = clauses.find((c) => c.type === 'roles');
  return roles ? ruleSentence(roles) : RULES_DOC.purpose.any;
}

/** The lowest "asks you above" amount across the rule sets in force (one currency only). */
function lowestAsk(list: readonly MandateListEntry[], now: number): Money | null {
  let best: Money | null = null;
  for (const m of list) {
    if (!inForce(m, now)) continue;
    for (const c of m.payload.clauses) {
      if (c.type !== 'human_present_over') continue;
      if (!best || (c.amount.currency === best.currency && c.amount.minor < best.minor)) best = c.amount;
    }
  }
  return best;
}

export function RulesLayer({ route, nav }: LayerProps) {
  if (route.level === 'place' && route.place === 'limits') return <LimitsPlace />;
  return <Rules nav={nav} />;
}

const FILTERS: readonly ListFilter<MandateListEntry & { live: boolean }>[] = [
  { value: 'in', label: RULES_LIST.inForce, test: (m) => m.live },
  { value: 'off', label: RULES_CARD.off, test: (m) => !m.live },
];
type Row = MandateListEntry & { live: boolean };
const SORTS: readonly ListSort<Row>[] = [
  { value: 'agent', label: RULES_LIST.sort.agent, compare: (a, b) => rank(a.agent) - rank(b.agent) || Number(b.live) - Number(a.live) || b.payload.version - a.payload.version },
  { value: 'new', label: RULES_LIST.sort.newest, compare: (a, b) => b.payload.not_before - a.payload.not_before },
  { value: 'end', label: RULES_LIST.sort.ending, compare: (a, b) => a.payload.expires - b.payload.expires },
];

function Rules({ nav }: { nav: LayerProps['nav'] }) {
  const q = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  const s = useSettings().data;
  const att = useAttention();
  const now = useNow();
  const list = useMemo(() => q.data ?? [], [q.data]);
  // `live` changes only when a set starts or ends; the rows stay one array between ticks otherwise.
  const liveKey = list.map((m) => (inForce(m, now) ? '1' : '0')).join('');
  const rows = useMemo<Row[]>(() => list.map((m, i) => ({ ...m, live: liveKey[i] === '1' })), [list, liveKey]);
  const [picked, setPicked] = useState<string | null>(null);
  const sorted = useMemo(() => [...rows].sort(SORTS[0]!.compare), [rows]);
  const current = rows.find((m) => keyOf(m) === picked) ?? sorted.find((m) => m.live) ?? sorted[0];

  const answer = q.data ? rulesAnswer(list, now) : null;
  const first = !!s?.first_run || (!!q.data && !list.length);
  const nIn = rows.filter((m) => m.live).length;
  const agents = new Set(rows.filter((m) => m.live).map((m) => m.agent)).size;
  const ask = lowestAsk(list, now);
  const reading = readLimits(att.data?.exposure);
  const out = reading?.meters.find((m) => m.key === 'out');

  const call: CallLine | null = answer?.tone === 'need'
    ? { ifNothing: first ? RULES_IF.none : RULES_IF.off, action: <ToApproval label={first ? RULES_ACT.first : RULES_ACT.change} target="mandate" title={RULES_ACT.title} /> }
    : null;
  const cards: LensCard[] = [
    { id: 'in', label: RULES_CARD.inForce, value: q.data ? RULES_CARD.inForceValue(nIn) : null, note: q.data ? RULES_CARD.inForceNote(agents) : undefined },
    { id: 'off', label: RULES_CARD.off, value: q.data ? RULES_CARD.offValue(rows.length - nIn) : null, note: rows.length - nIn ? RULES_CARD.offNote : RULES_CARD.offNoteNone, chip: rows.length - nIn ? RULES_STATE.again : undefined, chipTone: 'gold' },
    { id: 'ask', label: RULES_CARD.ask, value: q.data ? (ask ? <Amount money={ask} /> : RULES_CARD.askNone) : null, note: RULES_CARD.askNote },
    {
      id: 'limits', label: RULES_CARD.limits, value: out ? <>{out.value}{out.of ? <small className="rl-of"> {out.of}</small> : null}</> : reading ? RULES_CARD.limitsNone : null,
      note: out ? RULES_CARD.limitsBudgetNote : RULES_CARD.limitsNote, go: () => nav.place('limits'), fk: 'to-limits',
    },
  ];

  return (
    <PlaceFrame root="ar-rules" place="rules" tone="var(--gold)" kicker={RULES_KICKER} answer={answer?.title ?? RULES_LIST.label} sub={answer?.sub} call={call} cards={cards}
      action={!call && q.data && list.length ? <ToApproval label={RULES_ACT.change} kind="default" target="mandate" title={RULES_ACT.title} /> : null}
      explain={{ summary: RULES_EXPLAIN.summary, body: <>{RULES_EXPLAIN.body.map((p) => <p key={p}>{p}</p>)}</> }}>
      {q.error ? <WalletNotice error={q.error} what={NOTICE_WHAT.agentRules} /> : null}
      {!q.data && !q.error ? <Loading what={LOADING_WHAT.rules} /> : null}
      {q.data ? (
        <div className="rl-grid">
          <div className="rl-list" style={{ height: fitHeight(rows.length, 76, '36rem') }}>
            <ListEngine<Row> label={RULES_LIST.label} rows={rows} getKey={keyOf} filters={FILTERS} sorts={SORTS}
              searchText={(m) => `${agentTitle(m.agent)} ${purposeOf(m.payload.clauses)}`}
              estimateSize={72} renderRow={(m) => <RuleRow m={m} now={now} on={current ? keyOf(current) === keyOf(m) : false} />}
              rowLabel={(m) => `${agentTitle(m.agent)}: ${purposeOf(m.payload.clauses)}`} onPick={(m) => setPicked(keyOf(m))}
              empty={RULES_LIST.empty} noMatch={RULES_LIST.noMatch} />
          </div>
          {current ? <RuleDoc m={current} now={now} /> : <p className="dim rl-pick">{RULES_LIST.pick}</p>}
        </div>
      ) : null}
      {q.data && list.length ? <p className="st-foot"><Silence text={nIn ? RULES_IF.ok : RULES_IF.none} /></p> : null}
    </PlaceFrame>
  );
}

function stateChip(m: MandateListEntry, now: number): { tone: ChipTone; text: string; title?: string } {
  if (!m.owner_sig.length) return { tone: 'red', text: RULES_STATE.unsigned, title: RULES_STATE.unsignedTitle };
  if (m.refusal) return { tone: 'gold', text: RULES_STATE.again, title: RULES_DOC.refused };
  const st = ruleState(m.payload, now);
  if (st === 'active') return { tone: 'ok', text: RULES_STATE.active(shortDate(m.payload.expires)) };
  if (st === 'ended') return { tone: 'line', text: RULES_STATE.ended(shortDate(m.payload.expires)) };
  return { tone: 'gold', text: RULES_STATE.soon(shortDate(m.payload.not_before)) };
}

/** One rule set as a list row: its agent and what it is for, its limits, its version and state. */
function RuleRow({ m, now, on }: { m: Row; now: number; on: boolean }) {
  const purpose = purposeOf(m.payload.clauses);
  const lim = limitLines(m.payload.clauses, 2).map((l) => `${l.value} ${l.label}`).join(' · ');
  const chip = stateChip(m, now);
  return (
    <span className={`rl-row${on ? ' on' : ''}${m.live ? '' : ' off'}`} style={{ '--c': AGENT_TONE[m.agent] ?? 'var(--steel)' } as CSSProperties}>
      <span className="dot" aria-hidden="true" />
      <span className="t">
        <b title={`${agentTitle(m.agent)} · ${purpose}`}>{agentTitle(m.agent)} <span className="rl-for">· {purpose}</span></b>
        <small>{lim || RULES_DOC.every} · {RULES_DOC.version.toLowerCase()} {m.payload.version}</small>
      </span>
      <Chip tone={chip.tone} title={chip.title}>{chip.text}</Chip>
    </span>
  );
}

/** The picked rule set in full: what it is for, the limits it can never pass, every rule in words
 *  (no rule numbers), Change (a hand-off), and its proof one disclosure down. */
function RuleDoc({ m, now }: { m: MandateListEntry; now: number }) {
  const p = m.payload;
  const live = inForce(m, now);
  const limits = limitLines(p.clauses);
  return (
    <article className="rl-doc" aria-label={`${agentTitle(m.agent)}: ${purposeOf(p.clauses)}`} style={{ '--c': AGENT_TONE[m.agent] ?? 'var(--steel)' } as CSSProperties}>
      <p className="kicker">{RULES_DOC.kicker(RULES_LIST.agentOf(agentTitle(m.agent)), p.version, dateLabel(p.not_before))}</p>
      <h2 className="rl-dt">{RULES_DOC.purpose.covers(purposeOf(p.clauses))}</h2>
      <p className="rl-sub">{m.refusal ? RULES_DOC.refused : live ? RULES_DOC.inForce(dateLabel(p.expires), p.clauses.length) : RULES_DOC.retired}</p>
      {limits.length ? (
        <>
          <h3 className="cs-h3">{RULES_DOC.limits}</h3>
          <ul className="rl-lim">{limits.map((l) => <li key={l.key}><b className="num">{l.value}</b><span>{l.label}</span></li>)}</ul>
        </>
      ) : null}
      <h3 className="cs-h3">{RULES_DOC.every}</h3>
      <ul className="rl-lines">
        {p.clauses.map((c, i) => <li key={`${c.type}-${i}`}><span>{RULE_NAME[c.type]}</span><span title={ruleSentence(c)}>{ruleSentence(c)}</span></li>)}
      </ul>
      <div className="cs-acts">
        <ToApproval label={RULES_ACT.changeOne} kind="default" sm target="mandate" title={RULES_ACT.oneTitle} />
        <span className="ui-hint">{RULES_DOC.changeHint}</span>
      </div>
      <Disclosure summary={RULES_DOC.proof} className="rl-proof">
        <Kv items={[
          [RULES_DOC.version, String(p.version)],
          [RULES_DOC.validK, RULES_DOC.valid(dateLabel(p.not_before), dateLabel(p.expires))],
          [RULES_DOC.rulesId, <span className="mono">{shortId(p.id)}</span>],
          [RULES_DOC.agentKey, <span className="mono">{shortHash(p.agent_key)}</span>],
          [RULES_DOC.signature, m.owner_sig.length ? RULES_DOC.signed : RULES_DOC.missing],
        ]} />
      </Disclosure>
    </article>
  );
}

// ---- the wallet limits ---------------------------------------------------------------------------

/** Today against the signed limits (lib/limits.ts readLimits), and the hand-off to the approval
 *  window's owner page, where the owner signs them (there is no approval target for the limits;
 *  the bindings are frozen). */
function LimitsPlace() {
  const att = useAttention();
  const deals = useDeals().data;
  const needs = useNeeds();
  const reading = readLimits(att.data?.exposure);
  // The footer's "Paid out today" (money PayPal collected, the Book's set) beside the day's budget
  // the meters count (every payment agreed today): two figures, named so they are never confused.
  const pt = usePaidToday(att.data?.exposure, deals, needs);
  const answer = !att.data ? (att.error ? LIMITS_PLACE.unread : LIMITS_PLACE.reading) : !reading ? LIMITS_PLACE.unread : reading.line;
  const budget = reading?.meters.find((m) => m.key === 'out');
  // "of $1,000 a day" -> "$1,000 a day": the signed caps on their own.
  const signed = pt?.limit ? reading?.meters.map((m) => m.of?.replace(/^of /, '')).filter((x): x is string => !!x).join(' · ') : null;
  const latest: LatestProps | undefined = att.data ? {
    title: LIMITS_PLACE.meters,
    facts: [
      [LIMITS_PLACE.factPaid, pt ? paidTodayText(pt, LIMITS_PLACE.nothingYet) : UNKNOWN],
      [LIMITS_PLACE.factBudget, budget ? budget.value : UNKNOWN],
      [LIMITS_PLACE.factLimits, signed || NO_WALLET_LIMIT],
      [LIMITS_PLACE.factIn, LIMITS_PLACE.factInValue],
    ],
  } : undefined;
  return (
    <PlaceFrame root="ar-rules" place="limits" tone="var(--gold)" kicker={LIMITS_PLACE.kicker} answer={answer} sub={WALLET_LIMITS_ABOUT} latest={latest}
      action={<ToApproval label={LIMITS_LAYER.change} kind="default" title={LIMITS_LAYER.changeTitle} />}>
      {att.error ? <WalletNotice error={att.error} what={NOTICE_WHAT.walletLimits} /> : null}
      {reading ? (
        <section className="rl-meters" aria-label={LIMITS_PLACE.meters}>
          <h2 className="cs-h3">{LIMITS_PLACE.meters}</h2>
          {reading.mixed ? <p className="dim">{LIMITS_PLACE.mixed}</p> : null}
          <ul>
            {reading.meters.map((m) => (
              <li key={m.key} title={m.why} className={m.near ? 'near' : undefined}>
                <span className="k">{LIMIT_WORDS[m.key].name}</span>
                <span className="v"><b className="num">{m.value}</b>{m.of ? <span> {m.of}</span> : null}</span>
                <Meter value={m.fill} tone={m.near ? 'gold' : undefined} label={`${m.key === 'out' ? LIMITS_PLACE.budget : m.label}${m.of ? ` ${m.of}` : ''}`} />
                {m.key === 'out' ? <span className="rl-budget"><b>{LIMITS_PLACE.budget}.</b> {LIMITS_PLACE.budgetNote}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="st-foot"><Silence text={LIMITS_PLACE.ifNothing} /></p>
    </PlaceFrame>
  );
}

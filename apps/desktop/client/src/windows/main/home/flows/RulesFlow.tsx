// Rules flow (spark chat-configure): change the spending limits as single-question cards. It starts
// from the wallet's CURRENT rules (mandate_list, the read the Rules layer uses), asks per deal, per
// day, ask above and how long, reads the answers into one plain sentence (guide/rules.ts), then hands
// the draft to the existing SecureStep (kind 'rules'). The chat NEVER signs or writes limits: it only
// watches mandate_list for the new set the approval window signed.
import { useEffect, useMemo, useState } from 'react';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import { Btn } from '../../../../shared/ui';
import { clockNow } from '../../../../lib/clock';
import { ruleInForce } from '../../../../lib/firstRun';
import { formatMinor } from '../../../../lib/format';
import { useNow, useQuery } from '../../../../lib/hooks';
import { RULES_START, proposalOf, rulesCtx, type RulesAsk } from '../guide/rules';
import { SecureStep } from '../secure/SecureStep';
import { useLocked } from '../../world';
import { FlowCard } from './FlowCard';
import { advanceFlow, endFlow, type FlowTurn } from './store';
import { RULES_FLOW as W } from './rulesWords';
import './rulesFlow.css';

const usd = (minor: number): string => formatMinor(minor, 'USD');
const PRESETS = { perDeal: [25, 50, 100, 200], perDay: [50, 100, 150, 300], askAbove: [10, 25, 50, 100] } as const;
type Money3 = 'perDeal' | 'perDay' | 'askAbove';
const STEPS = ['perDeal', 'perDay', 'askAbove', 'ends', 'review', 'sign'] as const;
const keyOf = (m: MandateListEntry): string => `${m.payload.id}:${m.payload.version}`;
/** Closing delay so the secure step can show its own success state first. */
const SETTLE_MS = 1600;

/** The limits now in force, read from the first in-force set that has a per-deal clause. */
export function currentRules(list: readonly MandateListEntry[], now: number): { ask: RulesAsk; expires: number | null } {
  for (const m of list) {
    if (!ruleInForce(m, now)) continue;
    const cs = m.payload.clauses;
    const per = cs.find((c) => c.type === 'per_deal');
    if (!per || per.type !== 'per_deal') continue;
    const day = cs.find((c) => c.type === 'velocity');
    const ask = cs.find((c) => c.type === 'human_present_over');
    return {
      ask: {
        perDeal: per.max_amount.minor,
        perDay: day && day.type === 'velocity' ? day.max_total_day.minor : RULES_START.perDay,
        askAbove: ask && ask.type === 'human_present_over' ? ask.amount.minor : RULES_START.askAbove,
        ends: RULES_START.ends,
      },
      expires: m.payload.expires,
    };
  }
  return { ask: RULES_START, expires: null };
}

/** A day never holds less than one deal; asking above more than a deal means never asking. */
export function settled(a: RulesAsk): RulesAsk {
  return { ...a, perDay: Math.max(a.perDay, a.perDeal), askAbove: Math.min(a.askAbove, a.perDeal) };
}

export function RulesFlow({ turn }: { turn: FlowTurn }) {
  if (turn.summary !== null) return <FlowCard turn={turn}>{null}</FlowCard>;
  return <Live turn={turn} />;
}

function Live({ turn }: { turn: FlowTurn }) {
  const locked = useLocked();
  const now = useNow();
  const q = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  const list = q.data;
  const cur = useMemo(() => (list ? currentRules(list, now) : null), [list, now]);
  const ask: RulesAsk | null = (turn.data.ask as RulesAsk | undefined) ?? cur?.ask ?? (q.error ? RULES_START : null);

  useEffect(() => { if (locked) endFlow(W.locked); }, [locked]);
  const n = Math.max(1, STEPS.indexOf(turn.step as (typeof STEPS)[number]) + 1);

  if (locked) return <FlowCard turn={turn}><p>{W.locked}</p></FlowCard>;
  if (!ask) return <FlowCard turn={turn} n={n} of={STEPS.length}><p className="fc-quiet">{W.loading}</p></FlowCard>;

  const moneyStep = (field: Money3) => {
    const set = PRESETS[field].map((d) => d * 100);
    const lo = field === 'perDay' ? ask.perDeal : 0;
    const hi = field === 'askAbove' ? ask.perDeal : Infinity;
    const shown = set.filter((v) => v >= lo && v <= hi && v !== ask[field]).slice(0, 4);
    const next = STEPS[STEPS.indexOf(field) + 1] as string;
    const pick = (v: number) => advanceFlow(W[field].sum(usd(v)), next, { ask: settled({ ...ask, [field]: v }) });
    return (
      <>
        <p>{W[field].ask}</p>
        <div className="fc-choices">
          <Btn kind="primary" onClick={() => pick(ask[field])}>{W.keep(usd(ask[field]))}</Btn>
          {shown.map((v) => <Btn key={v} onClick={() => pick(v)}>{usd(v)}</Btn>)}
        </div>
      </>
    );
  };

  let body;
  switch (turn.step) {
    case 'perDeal': case 'perDay': case 'askAbove':
      body = moneyStep(turn.step);
      break;
    case 'ends':
      body = (
        <>
          <p>{cur?.expires ? W.ends.asked(new Date(cur.expires * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })) : W.ends.ask}</p>
          <div className="fc-choices">
            {W.durations.map((d) => <Btn key={d} onClick={() => advanceFlow(W.ends.sum(d), 'review', { ask: { ...ask, ends: d } })}>{d}</Btn>)}
          </div>
        </>
      );
      break;
    case 'review': body = <Review ask={ask} known={list ?? []} />; break;
    case 'sign': body = <Sign ask={ask} known={(turn.data.known as string[] | undefined) ?? []} list={list ?? []} now={now} />; break;
    default: body = null;
  }
  return <FlowCard turn={turn} n={n} of={STEPS.length}>{body}</FlowCard>;
}

const ctxFor = () => {
  const t = Math.floor(clockNow() / 60) * 60;
  return rulesCtx(t, -new Date(t * 1000).getTimezoneOffset());
};

function Review({ ask, known }: { ask: RulesAsk; known: readonly MandateListEntry[] }) {
  const p = useMemo(() => proposalOf(ask, ctxFor()), [ask]);
  if (!p) return <p>{W.unread}</p>;
  return (
    <>
      <p>{W.review.ask}</p>
      <blockquote className="fc-quote">{p.sentence}</blockquote>
      <div className="fc-choices">
        <Btn kind="gold" onClick={() => advanceFlow(W.review.sum, 'sign', { ask, known: known.map(keyOf) })}>{W.review.sign}</Btn>
        <Btn onClick={() => advanceFlow('', 'perDeal', {})}>{W.review.again}</Btn>
      </div>
    </>
  );
}

function Sign({ ask, known, list, now }: { ask: RulesAsk; known: readonly string[]; list: readonly MandateListEntry[]; now: number }) {
  const p = useMemo(() => proposalOf(ask, ctxFor()), [ask]);
  const draft = useMemo(() => (p ? JSON.stringify(p.draft) : null), [p]);
  // The wallet reports the new rules: a set in force that was not there before and says the same limits.
  const done = !!p && list.some((m) => {
    if (!ruleInForce(m, now) || known.includes(keyOf(m))) return false;
    const per = m.payload.clauses.find((c) => c.type === 'per_deal');
    const day = m.payload.clauses.find((c) => c.type === 'velocity');
    return per?.type === 'per_deal' && per.max_amount.minor === p.summary.perDeal
      && (day?.type !== 'velocity' || day.max_total_day.minor === p.summary.perDay);
  });
  useEffect(() => {
    if (!done || !p) return;
    const t = setTimeout(() => endFlow(W.changed(p.sentence)), SETTLE_MS);
    return () => clearTimeout(t);
  }, [done, p]);
  const [shut, setShut] = useState(false);
  if (!p) return <p>{W.unread}</p>;
  if (shut) return null;
  return (
    <>
      <p className="fc-quiet">{W.sign.note}</p>
      <SecureStep kind="rules" draft={draft} pairing={null} done={done} onCancel={() => { setShut(true); endFlow(W.notSigned); }} />
    </>
  );
}

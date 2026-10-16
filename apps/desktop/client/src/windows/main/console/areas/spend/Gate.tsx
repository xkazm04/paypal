// The rule check (rebuild WP3a): every purchase run through the rules the owner signed, in the order
// it meets them, toward PayPal. The rules are a strip of columns on top (each with its counts; the
// daily cap with today's meter); the purchases are a windowed list whose rows carry one mark per rule;
// the pane shows the picked purchase, or the picked rule with every purchase at it. Display only.
// Pure logic: modules/spend/gate.ts.
import { useMemo, useState, type CSSProperties } from 'react';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import { formatMinor } from '../../../../../lib/format';
import { RULE_NAME, ruleSentence, SPEND } from '../../../../../lib/words';
import { Btn, Chip, Disclosure, Hint, Kv, Meter, Section } from '../../../../../shared/ui';
import { clauseGroups, COLUMN_NAME, columnValue, outcomeOf, velocityFill, type Cell, type GateColumn } from '../../../modules/spend/gate';
import { short } from '../../../modules/tables/ladder';
import { useModuleRoute } from '../../../viewNav';
import { useAttention, useSettings, type World } from '../../../world';
import { useLayerNav } from '../../layers';
import { ListEngine, type ListFilter, type ListSort } from '../../ListEngine';
import { Amount } from '../../rows';
import { SplitView } from '../tables/parts';
import { PurchasePane, type Lane } from './Purchase';

const MARK: Record<Cell['kind'], string> = { pass: '✓', fail: '✕', you: '◆', skip: '–', na: '–', unknown: '?' };
const cap = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

const FILTERS: readonly ListFilter<Lane>[] = [
  { value: 'refused', label: SPEND.fRefused, test: (l) => l.cells.some((c) => c.kind === 'fail') || l.deal.state === 'REFUSED' },
  { value: 'asked', label: SPEND.fAsked, test: (l) => l.cells.some((c) => c.kind === 'you') },
  { value: 'unknown', label: SPEND.fUnknown, test: (l) => !l.own || l.cells.some((c) => c.kind === 'unknown') },
];
const SORTS: readonly ListSort<Lane>[] = [
  { value: 'newest', label: SPEND.sNewest, compare: (a, b) => (b.deal.created_at ?? 0) - (a.deal.created_at ?? 0) },
  { value: 'agent', label: SPEND.sAgent, compare: (a, b) => (a.slot ?? '~').localeCompare(b.slot ?? '~') || (b.deal.created_at ?? 0) - (a.deal.created_at ?? 0) },
];

type Pick = { kind: 'lane'; id: string } | { kind: 'rule'; n: number; from: string | null };

export function GateView({ lanes, cols, m, sets, display, who, needOf }: {
  lanes: readonly Lane[]; cols: readonly GateColumn[]; m: MandateListEntry | null; sets: number; display: World['display'];
  who: (l: Lane) => string; needOf: World['needOf'];
}) {
  const att = useAttention().data;
  const settings = useSettings().data;
  const gateNav = useLayerNav();
  const [pick, setPick] = useState<Pick | null>(null);
  const grid = { '--sp-n': cols.length } as CSSProperties;
  const counts = useMemo(() => new Map(cols.map((c) => {
    const g = clauseGroups(lanes.filter((l) => l.own).map((l) => ({ id: l.deal.id, cells: l.cells })), c.n);
    return [c.n, { fail: g.fail.length, you: g.you.length }] as const;
  })), [lanes, cols]);
  const vel = cols.find((c) => c.clause.type === 'velocity')?.clause;
  const velocity = vel?.type === 'velocity' ? vel : undefined;
  const fill = velocityFill(att?.wallet_spend_today_minor ?? 0, att?.wallet_spend_today_currency, velocity, !!settings?.meters_available);
  if (!cols.length) return <p className="le-empty">{SPEND.rulesNone}</p>;
  const lane = pick?.kind === 'lane' ? lanes.find((l) => l.deal.id === pick.id) : pick === null ? lanes[0] : undefined;
  const pickedId = pick?.kind === 'lane' ? pick.id : pick?.kind === 'rule' ? pick.from : lanes[0]?.deal.id ?? null;

  return (
    <div className="sp-gate" style={grid}>
      <div className="sp-cols" role="group" aria-label={SPEND.gateCols}>
        {cols.map((c) => {
          const k = counts.get(c.n) ?? { fail: 0, you: 0 };
          const on = pick?.kind === 'rule' && pick.n === c.n;
          return (
            <button key={c.n} type="button" className={`sp-col${on ? ' on' : ''}`} aria-pressed={on} title={`${RULE_NAME[c.clause.type]}: ${ruleSentence(c.clause)}`}
              onClick={() => setPick(on ? null : { kind: 'rule', n: c.n, from: null })}>
              <b>{COLUMN_NAME[c.clause.type]}</b>
              {c.clause.type === 'velocity' ? (
                <>
                  <Meter value={fill} label={SPEND.spentTodayMeter} />
                  <small>{fill === null ? SPEND.todayNotCounted : SPEND.todayOf(short(att?.wallet_spend_today_minor ?? 0, c.clause.max_total_day.currency), short(c.clause.max_total_day.minor, c.clause.max_total_day.currency))}</small>
                </>
              ) : <small>{columnValue(c.clause)}</small>}
              <small className={k.fail ? 'tx-red' : k.you ? 'tx-gold' : 'tx-dim'}>{SPEND.ruleCount(k)}</small>
            </button>
          );
        })}
      </div>
      <div className="sp-gatefoot">
        <Disclosure summary={SPEND.legendTitle}>
          <ul className="sp-legend">{SPEND.legend.map(([g, t]) => <li key={t}><span className="g" aria-hidden="true">{g}</span>{t}</li>)}</ul>
        </Disclosure>
        {sets > 1 ? <Hint>{SPEND.moreSets(sets)}</Hint> : null}
      </div>
      <SplitView label={SPEND.gateList} count={lanes.length}
        list={(
          <ListEngine<Lane> label={SPEND.gateList} rows={lanes} getKey={(l) => l.deal.id} filters={FILTERS} sorts={SORTS} estimateSize={60} measure
            searchText={(l) => `${display(l.deal).title} ${who(l)} ${l.slot ?? ''}`}
            renderRow={(l) => {
              const out = outcomeOf(l.deal);
              return (
                <span className={`tr-row sp-lane${pickedId === l.deal.id ? ' picked' : ''}`}>
                  <span className="t"><b>{display(l.deal).title}</b><span className="sub">{who(l)}{l.slot ? ` · ${SPEND.agent(l.slot)}` : ''}</span></span>
                  <span className="sp-marks" aria-hidden="true">
                    {l.cells.map((c) => <i key={c.n} className={c.kind}>{l.own ? MARK[c.kind] : '?'}</i>)}
                  </span>
                  <span className="sp-out"><Chip tone={out.tone}>{needOf(l.deal.id)?.money_check ? SPEND.checking : out.label}</Chip><Amount money={{ minor: l.deal.terms.unit_price.minor * l.deal.terms.qty, currency: l.deal.terms.currency }} /></span>
                </span>
              );
            }}
            rowLabel={(l) => `${display(l.deal).title}, ${outcomeOf(l.deal).label}`} onPick={(l) => setPick({ kind: 'lane', id: l.deal.id })} onOpen={(l) => gateNav.deal(l.deal.id)}
            empty={SPEND.allEmpty} />
        )}
        pane={pick?.kind === 'rule'
          ? <RuleStory n={pick.n} lanes={lanes} cols={cols} m={m} display={display} cellOf={pick.from ? lanes.find((l) => l.deal.id === pick.from) ?? null : null} spent={att?.wallet_spend_today_minor ?? null} spentCurrency={att?.wallet_spend_today_currency ?? null} meters={!!settings?.meters_available} />
          : lane ? <PurchasePane lane={lane} disp={display(lane.deal)} need={needOf(lane.deal.id)} who={who(lane)} onRule={(n) => setPick({ kind: 'rule', n, from: lane.deal.id })} /> : null} />
    </div>
  );
}

const SHOW_NAMES = 6;

function RuleStory({ n, lanes, cols, m, display, cellOf, spent, spentCurrency, meters }: {
  n: number; lanes: readonly Lane[]; cols: readonly GateColumn[]; m: MandateListEntry | null; display: World['display']; cellOf: Lane | null;
  spent: number | null; spentCurrency: string | null; meters: boolean;
}) {
  const nav = useLayerNav();
  const route = useModuleRoute();
  const col = cols.find((c) => c.n === n);
  if (!col) return <Hint>{SPEND.notGate}</Hint>;
  const g = clauseGroups(lanes.filter((l) => l.own).map((l) => ({ id: display(l.deal).title, cells: l.cells })), n);
  const cell = cellOf?.cells.find((c) => c.n === n) ?? null;
  const tone: Record<keyof typeof g, string> = { fail: 'tx-red', you: 'tx-gold', pass: 'tx-ok', unknown: 'tx-dim' };
  const vel = col.clause.type === 'velocity' ? col.clause : null;
  return (
    <div className="sp-pane">
      <header className="tr-phead">
        <h2>{RULE_NAME[col.clause.type]}</h2>
        {cell?.kind === 'fail' ? <Chip tone="red">{SPEND.whyRefused}</Chip> : null}
      </header>
      <p className="sp-rule">{cap(ruleSentence(col.clause))}</p>
      {cellOf && cell ? (
        <Section title={display(cellOf.deal).title}>
          <p className={cell.kind === 'fail' ? 'tx-red' : cell.kind === 'you' ? 'tx-gold' : cell.kind === 'pass' ? 'tx-ok' : 'tx-dim'}>{cap(cell.text)}</p>
          {cellOf.deal.state === 'REFUSED' ? <Hint>{SPEND.noUndo}</Hint> : null}
        </Section>
      ) : null}
      <Section title={SPEND.thisRule}>
        {(Object.keys(g) as Array<keyof typeof g>).some((k) => g[k].length) ? (
          <ul className="sp-hits">
            {(Object.keys(g) as Array<keyof typeof g>).filter((k) => g[k].length).map((k) => (
              <li key={k}><b className={tone[k]}>{g[k].length} {SPEND.hit[k]}</b>
                <span className="tx-dim">{g[k].slice(0, SHOW_NAMES).join(', ')}{g[k].length > SHOW_NAMES ? ` +${g[k].length - SHOW_NAMES}` : ''}</span></li>
            ))}
          </ul>
        ) : <Hint>{SPEND.noneReached}</Hint>}
      </Section>
      {vel ? (
        <Kv items={[
          [SPEND.spentToday, meters && spent !== null && spentCurrency === vel.max_total_day.currency
            ? SPEND.todayOf(formatMinor(spent, vel.max_total_day.currency), formatMinor(vel.max_total_day.minor, vel.max_total_day.currency)) : <Chip tone="dashed">{SPEND.notCounted}</Chip>],
          [SPEND.purchasesK, SPEND.perDay(vel.max_deals_day)],
        ]} />
      ) : null}
      <div className="sp-acts">
        <Btn sm onClick={() => route.open('rules')} disabled={!m}>{SPEND.allRules}</Btn>
        <Btn sm kind="plain" onClick={() => nav.place('rules')}>{SPEND.changeRules}</Btn>
      </div>
    </div>
  );
}

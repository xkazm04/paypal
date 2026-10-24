// The Spend layer (rebuild WP3a): what the owner's agents bought. One answer ("did my agents buy
// anything I need to look at?"), the "Your call" chip, and up to four cards: Needs you, Recent
// purchases, Rule check, Rules in force. Each opens a nested view: a searchable list and the picked
// purchase beside it. Main never moves money: paying and releasing a hold hand off to the approval
// window (`approval_open`); letting a purchase lapse and withdrawing it move no money. Per-deal proof
// is read only for the picked purchase. Pure logic: modules/spend/gate.ts.
import { useMemo } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import { clockLabel, formatMinor } from '../../../../../lib/format';
import { useQuery } from '../../../../../lib/hooks';
import { joinWords, LATEST_OF, OPEN_THE_DEAL, SPEND, SPEND_VIEWS, TABLES_TRADE, tablesClip } from '../../../../../lib/words';
import { WalletNotice } from '../../../../../shared/honesty';
import { Btn, Chip, Hint, Loading, useToast } from '../../../../../shared/ui';
import { silenceParts } from '../../../home/model';
import { amountTone, dealTotal, mandatesGoverning } from '../../../logic';
import { gateColumns, laneCells, outcomeOf, ruleLine, type GateColumn, type Outcome } from '../../../modules/spend/gate';
import { useCpLookup } from '../../../ui';
import { useModuleRoute } from '../../../viewNav';
import { useDeals, useNeeds, useWorldSelector, type World } from '../../../world';
import type { LayerProps } from '../../layers';
import { ListEngine, type ListFilter, type ListSort } from '../../ListEngine';
import { MAX_ROWS, type LatestProps } from '../../Latest';
import { ModuleLayer, type YourCall } from '../../ModuleLayer';
import type { ModuleCard } from '../../ModuleSummary';
import { Amount, Countdown } from '../../rows';
import { SplitView, usePick } from '../tables/parts';
import { GateView } from './Gate';
import { ClauseList, PurchaseDecision, PurchasePane, type Lane } from './Purchase';

const selModuleOf = (w: World) => w.moduleOfDeal;
const selDisplay = (w: World) => w.display;
const selNeedOf = (w: World) => w.needOf;

const kindIs = (k: Outcome['kind']) => (l: Lane) => outcomeOf(l.deal).kind === k;
const ALL_FILTERS: readonly ListFilter<Lane>[] = [
  { value: 'held', label: SPEND.fHeld, test: kindIs('held') },
  { value: 'waiting', label: SPEND.fWaiting, test: kindIs('waiting') },
  { value: 'paid', label: SPEND.fPaid, test: kindIs('paid') },
  { value: 'refused', label: SPEND.fRefused, test: kindIs('refused') },
  { value: 'voided', label: SPEND.fReleased, test: kindIs('voided') },
];
const ALL_SORTS: readonly ListSort<Lane>[] = [
  { value: 'newest', label: SPEND.sNewest, compare: (a, b) => (b.deal.created_at ?? 0) - (a.deal.created_at ?? 0) },
  { value: 'largest', label: SPEND.sLargest, compare: (a, b) => dealTotal(b.deal).minor - dealTotal(a.deal).minor },
  { value: 'agent', label: SPEND.sAgent, compare: (a, b) => (a.slot ?? '~').localeCompare(b.slot ?? '~') || (b.deal.created_at ?? 0) - (a.deal.created_at ?? 0) },
];

/** The answer line and the sentence under it, from the purchases and the attention queue. */
function answerOf(deals: readonly Deal[], needs: ReadonlyArray<{ d: Deal; need: AttentionItem }>, hasRules: boolean, title: (d: Deal) => string): { answer: string; sub?: string } {
  const needIds = new Set(needs.map((x) => x.d.id));
  const tally = { paid: 0, refused: 0, voided: 0, other: 0 };
  for (const d of deals) {
    if (needIds.has(d.id)) continue;
    const k = outcomeOf(d).kind;
    if (k === 'paid') tally.paid += 1; else if (k === 'refused') tally.refused += 1; else if (k === 'voided') tally.voided += 1; else tally.other += 1;
  }
  const parts = [
    tally.paid ? SPEND.tally.paid(tally.paid) : null, tally.refused ? SPEND.tally.refused(tally.refused) : null,
    tally.voided ? SPEND.tally.released(tally.voided) : null, tally.other ? SPEND.tally.other(tally.other) : null,
  ].filter((x): x is string => !!x);
  const rest = parts.length ? `${needs.length ? SPEND.othersLead : SPEND.allLead}: ${joinWords(parts)}.` : '';
  const lead = needs[0];
  if (lead) {
    const t = dealTotal(lead.d);
    const held = needs.every((x) => x.d.state === 'AUTHORIZED' && !x.need.money_check);
    return {
      answer: needs.length === 1 ? SPEND.oneNeeds(title(lead.d), formatMinor(t.minor, t.currency)) : SPEND.manyNeed(needs.length),
      sub: `${held ? SPEND.heldSub : ''}${rest}` || undefined,
    };
  }
  if (!hasRules) return { answer: SPEND.noRules, sub: SPEND.noRulesSub };
  if (!deals.length) return { answer: SPEND.noneYet, sub: SPEND.noneYetSub };
  return {
    answer: tally.paid ? SPEND.wentThrough(tally.paid) : SPEND.calm,
    sub: tally.refused ? `${SPEND.refusedSub(tally.refused)}${tally.voided ? ` ${SPEND.released(tally.voided)}` : ''}` : tally.voided ? SPEND.releasedNothing(tally.voided) : undefined,
  };
}

export function SpendLayer({ nav }: LayerProps) {
  const route = useModuleRoute();
  const toast = useToast();
  const say = (text: string, tone?: 'gold' | 'ok') => toast(text, tone);
  const dq = useDeals();
  const all = dq.data;
  const moduleOf = useWorldSelector(selModuleOf);
  const display = useWorldSelector(selDisplay);
  const needOf = useWorldSelector(selNeedOf);
  const worldNeeds = useNeeds();
  const cp = useCpLookup();
  const mq = useQuery('mandate_list', null, { refreshOn: ['settings:changed', 'deal:changed'] });
  const purchase = useMemo(() => mandatesGoverning(mq.data ?? [], 'purchase'), [mq.data]);
  const m = purchase[0] ?? null;
  const cols = useMemo(() => (m ? gateColumns(m.payload.clauses) : []), [m]);
  const deals = useMemo(() => (all ?? []).filter((d) => moduleOf(d) === 'spend'), [all, moduleOf]);

  // A lane per purchase, newest first inside each agent slot (the slot is the governing rule set's agent).
  // Each purchase is read against the rule set that governs it (the version it was made under when
  // the list has it); the rule check's columns are the first rule set's.
  const lanes = useMemo<Lane[]>(() => {
    const list = mq.data ?? [];
    const byId = new Map(list.map((e) => [e.payload.id, e]));
    const byVersion = new Map(list.map((e) => [`${e.payload.id}|${e.payload.version}`, e]));
    const colsOf = new Map<string, GateColumn[]>();
    return deals.map((d): Lane => {
      const own = !!m && d.mandate_id === m.payload.id;
      const entry = byVersion.get(`${d.mandate_id}|${d.mandate_version}`) ?? byId.get(d.mandate_id);
      let laneCols = own ? cols : entry ? colsOf.get(entry.payload.id) : undefined;
      if (!laneCols && entry) { laneCols = gateColumns(entry.payload.clauses); colsOf.set(entry.payload.id, laneCols); }
      // The rule set the columns are drawn from: a cleared purchase made under another version of it is not claimed to pass.
      const drawn = own ? m : entry;
      const cells = laneCols ? laneCells(d, laneCols, needOf(d.id), drawn ? { version: drawn.payload.version } : null) : [];
      return { deal: d, cells, cols: laneCols ?? [], own, slot: entry?.agent ?? null, rules: entry ?? null };
    }).sort((a, b) => (b.deal.created_at ?? 0) - (a.deal.created_at ?? 0));
  }, [deals, cols, m, mq.data, needOf]);
  // The world's order of decisions (soonest first), restricted to this module.
  const needs = useMemo(() => {
    const byId = new Map(deals.map((d) => [d.id, d]));
    return worldNeeds.flatMap((n) => { const d = byId.get(n.deal_id); return d ? [{ d, need: n }] : []; });
  }, [worldNeeds, deals]);
  const needLanes = useMemo(() => {
    const byId = new Map(lanes.map((l) => [l.deal.id, l]));
    return needs.flatMap((x) => { const l = byId.get(x.d.id); return l ? [l] : []; });
  }, [needs, lanes]);
  const [pickedNeed, pickNeed] = usePick(needLanes, (l) => l.deal.id);
  const [pickedAll, pickAll] = usePick(lanes, (l) => l.deal.id);
  const whoOf = (l: Lane) => cp(l.deal.counterparty).name;

  const firstNeed = needs[0]?.need;
  const ifNothing = firstNeed ? silenceParts(firstNeed.on_silence).head : null;
  const yourCall: YourCall | null = needs.length ? { count: needs.length, ifNothing, onOpen: () => route.open('need', 'need') } : null;

  if (!all) {
    return (
      <ModuleLayer module="spend" kicker={SPEND.kicker} answer={dq.error ? TABLES_TRADE.dealsWhat : SPEND.reading} yourCall={null}
        empty={dq.error ? <WalletNotice error={dq.error} what={TABLES_TRADE.dealsWhat} message={TABLES_TRADE.unread} /> : SPEND.reading} />
    );
  }

  const refused = deals.filter((d) => outcomeOf(d).kind === 'refused').length;
  const paid = deals.filter((d) => outcomeOf(d).kind === 'paid').length;
  const { answer, sub } = answerOf(deals, needs, !!m || !mq.data, (d) => tablesClip(display(d).title));
  const ruleCount = m?.payload.clauses.length ?? null;
  const cards: ModuleCard[] = [];
  if (needs.length) cards.push({ id: 'need', view: 'need', label: SPEND_VIEWS.need, value: SPEND.needValue(needs.length), note: SPEND.needNote, ifNothing });
  cards.push({ id: 'week', view: 'week', label: SPEND_VIEWS.week, value: SPEND.recentValue(deals.length), note: SPEND.recentNote(paid, deals.length > 0) });
  cards.push({ id: 'gate', view: 'gate', label: SPEND_VIEWS.gate, value: SPEND.gateValue(refused), note: SPEND.gateNote(refused) });
  cards.push({ id: 'rules', view: 'rules', label: SPEND_VIEWS.rules, value: mq.data ? SPEND.rulesValue(ruleCount) : '—', note: SPEND.rulesNote,
    chip: mq.data && !m ? SPEND.rulesChip : undefined, chipTone: 'red' });

  const rulesState = mq.error ? <WalletNotice error={mq.error} what={SPEND.rulesWhat} message={TABLES_TRADE.unread} /> : !mq.data ? <Loading what={SPEND.rulesReading} /> : null;
  const row = (l: Lane, picked: boolean) => {
    const disp = display(l.deal);
    const out = outcomeOf(l.deal);
    const need = needOf(l.deal.id);
    const line = l.cols.length ? ruleLine(l.cells, l.cols) : { kind: 'unknown' as const, text: SPEND.otherRules };
    return (
      <span className={`tr-row${need ? ' needs' : ''}${picked ? ' picked' : ''}`}>
        <span className="dot" aria-hidden="true" />
        <span className="t">
          <b title={disp.title}>{disp.title}</b>
          <span className="sub">{whoOf(l)}{l.deal.created_at ? ` · ${clockLabel(l.deal.created_at)}` : ''}</span>
          <span className={`sil sp-rl ${line.kind}`}>{line.text}{out.kind === 'refused' ? SPEND.neverAsked : ''}</span>
        </span>
        <span className="sp-end">
          {need ? <Countdown deadline={need.deadline} /> : <Chip tone={out.tone}>{out.label}</Chip>}
          <Amount money={dealTotal(l.deal)} tone={amountTone(l.deal)} />
        </span>
      </span>
    );
  };
  const list = (rows: readonly Lane[], label: string, picked: Lane | undefined, pick: (k: string) => void, empty: string, filters?: readonly ListFilter<Lane>[]) => (
    <ListEngine<Lane> label={label} rows={rows} getKey={(l) => l.deal.id} filters={filters} sorts={filters ? ALL_SORTS : undefined} estimateSize={68} measure
      searchText={(l) => `${display(l.deal).title} ${whoOf(l)} ${l.slot ?? ''}`}
      renderRow={(l) => row(l, picked?.deal.id === l.deal.id)}
      rowLabel={(l) => `${display(l.deal).title}, ${outcomeOf(l.deal).label}`} onPick={(l) => pick(l.deal.id)} onOpen={(l) => nav.deal(l.deal.id)} empty={empty} />
  );
  const pane = (l: Lane | undefined) => {
    if (!l) return null;
    const disp = display(l.deal);
    const need = needOf(l.deal.id);
    const c = cp(l.deal.counterparty);
    return (
      <PurchasePane key={l.deal.id} lane={l} disp={disp} need={need} who={c.name}
        onRule={() => route.open('gate')}
        decision={need ? <PurchaseDecision lane={l} disp={disp} need={need} m={l.rules} who={c} onToast={say} /> : null} />
    );
  };

  // Latest: the purchases waiting for the owner first, then the newest; each opens its deal.
  const waitingIds = new Set(needLanes.map((l) => l.deal.id));
  const latestLanes = [...needLanes, ...lanes.filter((l) => !waitingIds.has(l.deal.id))];
  const latest: LatestProps = {
    title: LATEST_OF.spend, total: latestLanes.length, rowGuess: 80,
    rows: latestLanes.slice(0, MAX_ROWS).map((l) => ({
      key: l.deal.id, label: `${display(l.deal).title}, ${OPEN_THE_DEAL}`, onOpen: () => nav.deal(l.deal.id), node: row(l, false),
    })),
    seeAll: { onOpen: () => route.open(needLanes.length ? 'need' : 'week') },
  };

  return (
    <ModuleLayer module="spend" kicker={SPEND.kicker} answer={answer} sub={sub} yourCall={yourCall} latest={latest}
      cards={cards}
      explain={{ summary: SPEND.whyTitle, body: <ol className="tr-steps">{SPEND.why.map((s) => <li key={s}>{s}</li>)}</ol> }}
      views={{
        need: {
          title: SPEND_VIEWS.need, sub: needs.length ? SPEND.needSub(needs.length) : undefined,
          render: () => <SplitView label={SPEND.needList} count={needLanes.length} list={list(needLanes, SPEND.needList, pickedNeed, pickNeed, SPEND.needEmpty)} pane={pane(pickedNeed)} />,
        },
        week: {
          title: SPEND_VIEWS.week, sub: SPEND.allSub(deals.length),
          render: () => rulesState ?? <SplitView label={SPEND.allList} count={lanes.length} list={list(lanes, SPEND.allList, pickedAll, pickAll, SPEND.allEmpty, ALL_FILTERS)} pane={pane(pickedAll)} />,
        },
        gate: {
          title: SPEND_VIEWS.gate, sub: SPEND.gateSub,
          render: () => rulesState ?? <GateView lanes={lanes} cols={cols} m={m} sets={purchase.length} display={display} who={whoOf} needOf={needOf} />,
        },
        rules: {
          title: SPEND_VIEWS.rules, sub: m ? SPEND.rulesSub : undefined,
          actions: <Btn kind="primary" onClick={() => nav.place('rules')}>{SPEND.changeRulesBtn}</Btn>,
          render: () => rulesState ?? (m ? (
            <div className="sp-rules">
              <ClauseList m={m} lane={null} />
              <Hint>{SPEND.changeHint}</Hint>
            </div>
          ) : <p className="le-empty">{SPEND.rulesNone}</p>),
        },
      }} />
  );
}

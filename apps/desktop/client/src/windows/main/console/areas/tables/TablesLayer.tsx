// The Tables layer (rebuild WP3a): haggling for deals. The summary is one answer ("is a deal waiting
// for me, and is it inside my limit?"), the "Your call" chip, the one quiet action (open a table) and
// up to four cards: Needs you, Open tables (each table's price ladder), Shop around, Ended. Each card
// opens a nested view: a searchable list on the left and the picked table on the right. Main never
// signs: a decision and a new price range hand off to the approval window (`approval_open`); withdraw
// and shop around move no money. The unsent price-range drafts live here, so they survive a view
// change; Escape discards an unsent draft before it leaves the page.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import { useQuery } from '../../../../../lib/hooks';
import { headlineWords, LATEST_OF, OPEN_THE_DEAL, READING_WHAT, TABLES, TABLES_TRADE, TABLES_VIEWS, TABLES_WATCH, tablesClip, tablesItem, tablesShortWho } from '../../../../../lib/words';
import { Reveal, RevealGroup } from '../../../../../design/Reveal';
import type { GridColumn } from '../../../../../shared/DataGrid';
import { Btn, Chip, ExplainHint, Placeholder, ReadFailed, useLayer, useToast } from '../../../../../shared/ui';
import { silenceParts, shortTitle } from '../../../home/model';
import { amountTone, dealTotal, isLive, isOwnerAccept, isSettled } from '../../../logic';
import { bandOf, fenceKey, LIMIT_WORD, sameBand, short, type BandDraft } from '../../../modules/tables/ladder';
import { useCpLookup } from '../../../ui';
import { useModuleRoute } from '../../../viewNav';
import { useDeals, useNeeds, useWorldSelector, type World } from '../../../world';
import type { LayerProps } from '../../layers';
import { ListEngine, type ListFilter } from '../../ListEngine';
import { MAX_ROWS, type LatestProps } from '../../Latest';
import { ModuleLayer, type YourCall } from '../../ModuleLayer';
import type { ModuleCard } from '../../ModuleSummary';
import { Amount, Countdown, DealRow1, Row1, StateChip, WhoChip } from '../../rows';
import { EMPTY_TABLE, roomLine, TableDetail, type StepHandlers, type TableState } from './Ladder';
import { NeedCard } from './Need';
import { SplitView, TheirWords, usePick } from './parts';
import { canShopAround, liveGroups, ShopAroundButton, ShopView } from './Shop';
import { watchTable, worthWatching } from '../../../modules/tables/watchPick';
import { amountMajor, amountValue, dealColumns, stateText, WatchView } from './Watch';

const selModuleOf = (w: World) => w.moduleOfDeal;
const selDisplay = (w: World) => w.display;

type Ctx = { display: World['display']; needOf: ReadonlyMap<string, AttentionItem>; who: (d: Deal) => { short: string; full: string } };

const deadlineOf = (c: Ctx, d: Deal): number => c.needOf.get(d.id)?.deadline ?? c.display(d).deadline ?? Infinity;

function liveFilters(c: Ctx): readonly ListFilter<Deal>[] {
  return [
    { value: 'needs', label: TABLES.fNeeds, test: (d) => c.needOf.has(d.id) },
    { value: 'live', label: TABLES.fLive, test: (d) => isLive(d) && !c.needOf.has(d.id) },
  ];
}
/** Decisions first, then the soonest deadline (none last). */
const soonestFirst = (c: Ctx) => (a: Deal, b: Deal): number => (c.needOf.has(b.id) ? 1 : 0) - (c.needOf.has(a.id) ? 1 : 0) || deadlineOf(c, a) - deadlineOf(c, b);
/** The same order as one number for the grid's time column: anything not waiting for the owner sits past every deadline. */
const NOT_WAITING = 1e15;
const soonestKey = (c: Ctx, d: Deal): number => (c.needOf.has(d.id) ? 0 : NOT_WAITING) + deadlineOf(c, d);
const ENDED_FILTERS: readonly ListFilter<Deal>[] = [
  { value: 'paid', label: TABLES.fPaid, test: isSettled },
  { value: 'stopped', label: TABLES.fStopped, test: (d) => !isSettled(d) },
];

/** The answer line and the sentence under it. */
function answerOf(c: Ctx, needDeals: readonly Deal[], live: number): { answer: string; sub: string } {
  const asks = needDeals.filter((d) => c.needOf.get(d.id)?.actions.includes('review'));
  const lead = asks[0] ?? needDeals[0];
  const need = lead ? c.needOf.get(lead.id) : undefined;
  if (!lead || !need) return live ? { answer: TABLES.answerCalm, sub: TABLES.subCalm(live) } : { answer: TABLES.answerNone, sub: TABLES.subNone };
  const who = c.who(lead).short;
  const item = tablesItem(tablesClip(c.display(lead).title));
  const amt = need.amount_minor ? short(need.amount_minor, need.currency) : null;
  if (need.actions.includes('review')) {
    const answer = amt ? (isOwnerAccept(need, lead) ? TABLES.offers(who, amt, item) : TABLES.agreed(who, amt, item)) : TABLES.headline(headlineWords(need.headline));
    const room = roomLine(lead, need.amount_minor ?? null, bandOf(c.display(lead).band));
    return { answer, sub: room ?? TABLES.nothingAccepted };
  }
  return { answer: TABLES.mismatch(who, item), sub: TABLES.mismatchSub };
}

/** The one line a table's list row keeps of its old second line: the limit as signed, or that there is none. */
function tableNote(deal: Deal, c: Ctx): string {
  const key = fenceKey(deal.side);
  const fence = bandOf(c.display(deal).band)?.[key] ?? null;
  return fence !== null ? `${LIMIT_WORD[key]} ${short(fence, deal.terms.currency)}` : TABLES.noRange;
}

/** A table as a one-line list row: what and with whom, state, amount, time; the limit trails as the note. */
function TableRow1({ deal, c, picked }: { deal: Deal; c: Ctx; picked: boolean }) {
  const disp = c.display(deal);
  const need = c.needOf.get(deal.id);
  const note = tableNote(deal, c);
  return (
    <Row1 className={`${need ? 'needs ' : ''}${picked ? 'picked' : ''}`.trim() || undefined} note={note} title={note}>
      <span className="c-who">
        <span className="dot" aria-hidden="true" />
        <b title={disp.title}>{shortTitle(disp.title)}</b>
        <WhoChip name={c.who(deal).short} />
      </span>
      <span className="c-state">{need ? <Chip tone="gold">{TABLES.needChip}</Chip> : <StateChip deal={deal} />}</span>
      <Amount money={dealTotal(deal)} tone={amountTone(deal)} />
      <span className="c-time"><Countdown deadline={need?.deadline ?? disp.deadline} /></span>
    </Row1>
  );
}

/** TableRow1's cells as grid columns. The limit, the row's title, stays the amount's hover. */
function tableColumns(c: Ctx): GridColumn<Deal>[] {
  return [
    { id: 'what', header: TABLES.col.what, flex: 2, minWidth: 180, value: (d) => `${c.display(d).title} ${c.who(d).full}`,
      cell: (d) => (
        <span className={`c-who${c.needOf.has(d.id) ? ' needs' : ''}`}>
          <span className="dot" aria-hidden="true" />
          <b title={c.display(d).title}>{shortTitle(c.display(d).title)}</b>
          <WhoChip name={c.who(d).short} />
        </span>
      ) },
    { id: 'status', header: TABLES.col.status, width: 160, value: (d) => (c.needOf.has(d.id) ? TABLES.needChip : stateText(d)),
      cell: (d) => <span className="c-state">{c.needOf.has(d.id) ? <Chip tone="gold">{TABLES.needChip}</Chip> : <StateChip deal={d} />}</span> },
    { id: 'amount', header: TABLES.col.amount, width: 130, end: true, filter: 'number', value: (d) => amountValue(dealTotal(d)), filterValue: (d) => amountMajor(dealTotal(d)),
      cell: (d) => <span title={tableNote(d, c)}><Amount money={dealTotal(d)} tone={amountTone(d)} /></span> },
    { id: 'time', header: TABLES.col.left, width: 130, filter: false, sort: 'asc', value: (d) => soonestKey(c, d),
      cell: (d) => <span className="c-time"><Countdown deadline={c.needOf.get(d.id)?.deadline ?? c.display(d).deadline} /></span> },
  ];
}

export function TablesLayer({ nav }: LayerProps) {
  const route = useModuleRoute();
  const toast = useToast();
  const dq = useDeals();
  const all = dq.data;
  const moduleOf = useWorldSelector(selModuleOf);
  const display = useWorldSelector(selDisplay);
  const needs = useNeeds();
  const cp = useCpLookup();
  const needOf = useMemo(() => new Map(needs.map((n) => [n.deal_id, n] as const)), [needs]);
  const c = useMemo<Ctx>(() => ({ display, needOf, who: (d) => { const x = cp(d.counterparty); return { short: tablesShortWho(x), full: x.name }; } }), [display, needOf, cp]);
  const deals = useMemo(() => (all ?? []).filter((d) => moduleOf(d) === 'tables'), [all, moduleOf]);
  const filters = useMemo(() => liveFilters(c), [c]);
  const tableCols = useMemo(() => tableColumns(c), [c]);
  const endedCols = useMemo(() => dealColumns({ display, who: c.who, shown: 'full', newest: true }), [display, c.who]);
  // Rows come in the list's first order, so the table picked by default is the one on top.
  const soonest = useMemo(() => soonestFirst(c), [c]);
  const strip = useMemo(() => deals.filter((d) => isLive(d) || needOf.has(d.id)), [deals, needOf]);
  const needDeals = useMemo(() => strip.filter((d) => needOf.has(d.id)).sort(soonest), [strip, needOf, soonest]);
  const openDeals = useMemo(() => strip.filter(isLive).sort(soonest), [strip, soonest]);
  const closed = useMemo(() => deals.filter((d) => !isLive(d) && !needOf.has(d.id)), [deals, needOf]);
  const live = openDeals.length;

  // Shop around: the groups of sellers for one item.
  const groups = useQuery('deal_groups', null, { refreshOn: ['deal:changed'] });
  const groupList = groups.data ?? [];
  const nGroups = liveGroups(groupList, deals).length;
  const canShop = canShopAround(deals, groupList);

  // The unsent price-range drafts, per table.
  const [ts, setTs] = useState<Record<string, TableState>>({});
  const stateOf = (id: string): TableState => ts[id] ?? EMPTY_TABLE;
  const patch = (id: string, p: Partial<TableState>) => setTs((x) => ({ ...x, [id]: { ...(x[id] ?? EMPTY_TABLE), ...p } }));
  const say = (text: string, tone?: 'gold' | 'ok') => toast(text, tone);
  // A hand-off ends when Rust rebinds the deal to a newer signed version.
  const sayRef = useRef(say);
  sayRef.current = say;
  useEffect(() => {
    for (const [id, s] of Object.entries(ts)) {
      if (!s.handoff) continue;
      const d = deals.find((x) => x.id === id);
      if (d && d.mandate_version > s.handoff.version) {
        setTs((x) => ({ ...x, [id]: EMPTY_TABLE }));
        sayRef.current(TABLES.signedToast(display(d).title), 'ok');
      }
    }
  }, [deals, ts, display]);
  const unsent = Object.entries(ts).filter(([, s]) => s.draft && !s.handoff).map(([id]) => id);
  const discardAll = () => { setTs((x) => { const n = { ...x }; for (const id of unsent) n[id] = EMPTY_TABLE; return n; }); say(TABLES.discarded); };
  useLayer(discardAll, 'other', unsent.length > 0);
  const handlers = (d: Deal): StepHandlers => ({
    onDraft: (x: BandDraft | null) => {
      const signed = bandOf(display(d).band);
      const had = stateOf(d.id).handoff;
      patch(d.id, { draft: x && !sameBand(x, signed) ? x : null, read: false, handoff: null });
      if (had) say(TABLES.draftMoved);
    },
    onRead: () => patch(d.id, { read: true }),
    onDiscard: () => { patch(d.id, EMPTY_TABLE); say(TABLES.discarded); },
    onHandoff: (version, draft) => patch(d.id, { handoff: { version, draft } }),
  });

  const [pickedNeed, pickNeed] = usePick(needDeals, (d) => d.id);
  const [pickedTable, pickTable] = usePick(openDeals, (d) => d.id);

  const firstNeed = needDeals[0] ? needOf.get(needDeals[0].id) : undefined;
  const ifNothing = firstNeed ? silenceParts(firstNeed.on_silence).head : null;
  const yourCall: YourCall | null = needDeals.length ? { count: needDeals.length, ifNothing, onOpen: () => route.open('need', 'need') } : null;

  if (!all) {
    return (
      <ModuleLayer module="tables" kicker={TABLES.kicker} answer={dq.error ? TABLES_TRADE.dealsWhat : TABLES.reading} yourCall={null}>
        {dq.error ? <ReadFailed error={dq.error} what={TABLES_TRADE.dealsWhat} message={TABLES_TRADE.unread} onRetry={dq.refetch} /> : <Placeholder what={READING_WHAT.deals} shape="cards" />}
      </ModuleLayer>
    );
  }

  const { answer, sub } = answerOf(c, needDeals, live);
  const cards: ModuleCard[] = [];
  if (needDeals.length) cards.push({ id: 'need', view: 'need', label: TABLES_VIEWS.need, value: TABLES.needValue(needDeals.length), note: TABLES.needNote, ifNothing });
  cards.push({ id: 'tables', view: 'tables', label: TABLES_VIEWS.tables, value: TABLES.openValue(live), note: TABLES.openNote(live) });
  cards.push({ id: 'shop', view: 'shop', label: TABLES_VIEWS.shop, value: nGroups ? TABLES.shopValue(nGroups) : canShop ? TABLES.shopValue(0) : TABLES.shopNone, note: TABLES.shopNote });
  cards.push({ id: 'closed', view: 'closed', label: TABLES_VIEWS.closed, value: TABLES.endedValue(closed.length), note: TABLES.endedNote });

  const open = (d: Deal) => nav.deal(d.id);
  const tablePane = (d: Deal | undefined, withNeed: boolean) => {
    if (!d) return null;
    const disp = display(d);
    const need = needOf.get(d.id);
    const who = c.who(d);
    return (
      <RevealGroup className="tb-pane" key={d.id}>
        <Reveal><header className="tr-phead">
          <h2 title={disp.title}>{disp.title}</h2>
          <span className="tr-with" title={who.full}>{TABLES.withWho(who.short)}</span>
          <StateChip deal={d} />
          <Amount money={dealTotal(d)} tone={amountTone(d)} />
          <span className="ui-spacer" />
          {worthWatching(d, disp.band) ? <Btn sm kind="plain" onClick={() => { watchTable(d.id); route.open('watch'); }} title={TABLES_WATCH.watchItTitle}>{TABLES_WATCH.watchIt}</Btn> : null}
          <Btn sm kind="plain" onClick={() => open(d)} title={TABLES_TRADE.openDealTitle}>{TABLES_TRADE.openDeal}</Btn>
        </header></Reveal>
        <Reveal><p className="tr-note">{tableNote(d, c)}</p></Reveal>
        {withNeed && need ? <Reveal><NeedCard deal={d} disp={disp} need={need} who={who.short} onDeal={() => open(d)} onToast={say} /></Reveal> : null}
        <Reveal><TableDetail deal={d} disp={disp} need={need} who={who.short} st={stateOf(d.id)} steps={handlers(d)} onToast={say} /></Reveal>
        <Reveal><TheirWords dealId={d.id} who={who.full} /></Reveal>
      </RevealGroup>
    );
  };
  const tableList = (rows: readonly Deal[], label: string, picked: Deal | undefined, pick: (k: string) => void, empty: string) => (
    <ListEngine<Deal> label={label} rows={rows} getKey={(d) => d.id} filters={rows.length > 8 ? filters : undefined} columns={tableCols} estimateSize={36}
      renderRow={(d) => <TableRow1 deal={d} c={c} picked={picked?.id === d.id} />}
      rowLabel={(d) => `${display(d).title}, ${c.who(d).full}`} onPick={(d) => pick(d.id)} onOpen={open} empty={empty} />
  );
  const tablesView = (title: string, subLine: ReactNode) => ({
    title, sub: subLine,
    render: () => <SplitView label={TABLES.openList} count={openDeals.length} list={tableList(openDeals, TABLES.openList, pickedTable, pickTable, TABLES.openEmpty)} pane={tablePane(pickedTable, true)} />,
  });

  // Latest: the open tables (waiting ones first), then the ones that ended; each opens its deal.
  const latestRows = [...openDeals, ...closed];
  const latest: LatestProps = {
    title: LATEST_OF.tables, total: latestRows.length,
    rows: latestRows.slice(0, MAX_ROWS).map((d) => ({
      key: d.id, label: `${display(d).title}, ${OPEN_THE_DEAL}`, onOpen: () => open(d),
      node: isLive(d) ? <TableRow1 deal={d} c={c} picked={false} /> : <DealRow1 deal={d} who={c.who(d).full} />,
    })),
    seeAll: { onOpen: () => route.open(openDeals.length ? 'tables' : 'closed') },
  };

  return (
    <ModuleLayer module="tables" kicker={TABLES.kicker} answer={answer} sub={sub} yourCall={yourCall} latest={latest}
      purpose={<ExplainHint label={TABLES.whyTitle} line={TABLES.purpose}><ol className="tr-steps">{TABLES.why.map((s) => <li key={s}>{s}</li>)}</ol></ExplainHint>}
      action={<><Btn onClick={() => route.open('watch')} title={TABLES_WATCH.watchAllTitle}>{TABLES_WATCH.watchAll}</Btn><Btn onClick={() => nav.place('pairing')} title={TABLES.openTableTitle}>{TABLES.openTable}</Btn></>}
      cards={cards}
      views={{
        need: {
          title: TABLES_VIEWS.need, sub: needDeals.length ? TABLES.needSub(needDeals.length) : undefined,
          render: () => <SplitView label={TABLES.needList} count={needDeals.length} list={tableList(needDeals, TABLES.needList, pickedNeed, pickNeed, TABLES.needEmpty)} pane={tablePane(pickedNeed, true)} />,
        },
        tables: tablesView(TABLES_VIEWS.tables, TABLES.openSub),
        ladder: tablesView(TABLES_VIEWS.ladder, <ExplainHint label={TABLES.ladderSubLabel} line={TABLES.ladderSubLine}>{TABLES.ladderSub}</ExplainHint>),
        shop: {
          title: TABLES_VIEWS.shop, sub: TABLES.shopNote,
          actions: <ShopAroundButton groups={groupList} deals={deals} display={display} onGrouped={() => void groups.refetch()} onToast={say} />,
          render: () => (
            <>
              {groups.error ? <ReadFailed error={groups.error} what={TABLES.groupsWhat} message={TABLES_TRADE.unread} onRetry={groups.refetch} /> : null}
              <ShopView groups={groupList} deals={deals} display={display} />
            </>
          ),
        },
        watch: {
          title: TABLES_VIEWS.watch, sub: <ExplainHint label={TABLES_WATCH.subLabel} line={TABLES_WATCH.subLine}>{TABLES_WATCH.sub}</ExplainHint>,
          render: () => <WatchView deals={deals} display={display} needOf={needOf} who={c.who} />,
        },
        closed: {
          title: TABLES_VIEWS.closed, sub: closed.length ? TABLES.endedSub(closed.length) : undefined,
          render: () => (
            <ListEngine<Deal> label={TABLES.endedList} rows={closed} getKey={(d) => d.id} filters={ENDED_FILTERS} columns={endedCols} estimateSize={36}
              renderRow={(d) => <DealRow1 deal={d} who={c.who(d).full} />}
              rowLabel={(d) => `${display(d).title}, ${OPEN_THE_DEAL}`} onOpen={open} empty={TABLES.endedEmpty} />
          ),
        },
      }} />
  );
}

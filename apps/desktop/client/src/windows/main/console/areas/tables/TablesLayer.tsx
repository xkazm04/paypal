// The Tables layer (rebuild WP3a): haggling for deals. The summary is one answer ("is a deal waiting
// for me, and is it inside my limit?"), the "Your call" chip, the one quiet action (open a table) and
// up to four cards: Needs you, Open tables (each table's price ladder), Shop around, Ended. Each card
// opens a nested view: a searchable list on the left and the picked table on the right. Main never
// signs: a decision and a new price range hand off to the approval window (`approval_open`); withdraw
// and shop around move no money. The unsent price-range drafts live here, so they survive a view
// change; Escape discards an unsent draft before it leaves the page.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import { useQuery } from '../../../../../lib/hooks';
import { headlineWords, LATEST_OF, OPEN_THE_DEAL, TABLES, TABLES_TRADE, TABLES_VIEWS, TABLES_WATCH, tablesClip, tablesItem, tablesShortWho } from '../../../../../lib/words';
import { WalletNotice } from '../../../../../shared/honesty';
import { Btn, Chip, useLayer, useToast } from '../../../../../shared/ui';
import { silenceParts, shortTitle } from '../../../home/model';
import { amountTone, dealTotal, isLive, isOwnerAccept, isSettled } from '../../../logic';
import { bandOf, fenceKey, LIMIT_WORD, sameBand, short, type BandDraft } from '../../../modules/tables/ladder';
import { useCpLookup } from '../../../ui';
import { useModuleRoute } from '../../../viewNav';
import { useDeals, useNeeds, useWorldSelector, type World } from '../../../world';
import type { LayerProps } from '../../layers';
import { ListEngine, type ListFilter, type ListSort } from '../../ListEngine';
import { MAX_ROWS, type LatestProps } from '../../Latest';
import { ModuleLayer, type YourCall } from '../../ModuleLayer';
import type { ModuleCard } from '../../ModuleSummary';
import { Amount, Countdown, DealRow, StateChip, WhoChip } from '../../rows';
import { EMPTY_TABLE, roomLine, TableDetail, type StepHandlers, type TableState } from './Ladder';
import { NeedCard } from './Need';
import { SplitView, TheirWords, usePick } from './parts';
import { canShopAround, liveGroups, ShopAroundButton, ShopView } from './Shop';
import { watchTable, worthWatching } from '../../../modules/tables/watchPick';
import { WatchView } from './Watch';

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
function liveSorts(c: Ctx): readonly ListSort<Deal>[] {
  return [
    { value: 'soonest', label: TABLES.sSoonest, compare: (a, b) => (c.needOf.has(b.id) ? 1 : 0) - (c.needOf.has(a.id) ? 1 : 0) || deadlineOf(c, a) - deadlineOf(c, b) },
    { value: 'name', label: TABLES.sName, compare: (a, b) => c.display(a).title.localeCompare(c.display(b).title) },
  ];
}
const ENDED_FILTERS: readonly ListFilter<Deal>[] = [
  { value: 'paid', label: TABLES.fPaid, test: isSettled },
  { value: 'stopped', label: TABLES.fStopped, test: (d) => !isSettled(d) },
];
const ENDED_SORTS: readonly ListSort<Deal>[] = [
  { value: 'newest', label: TABLES.sNewest, compare: (a, b) => (b.updated_at ?? b.created_at ?? 0) - (a.updated_at ?? a.created_at ?? 0) },
  { value: 'largest', label: TABLES.sLargest, compare: (a, b) => dealTotal(b).minor - dealTotal(a).minor },
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
  const rest = needDeals.length - 1;
  const more = rest ? TABLES.more(rest) : '';
  if (need.actions.includes('review')) {
    const answer = amt ? (isOwnerAccept(need, lead) ? TABLES.offers(who, amt, item) : TABLES.agreed(who, amt, item)) : TABLES.headline(headlineWords(need.headline));
    const room = roomLine(lead, need.amount_minor ?? null, bandOf(c.display(lead).band));
    return { answer, sub: `${room ?? TABLES.nothingAccepted}${more}` };
  }
  return { answer: TABLES.mismatch(who, item), sub: `${TABLES.mismatchSub}${more}` };
}

/** A table as a list row: what, with whom, the limit as signed (no read: the display has it), state, time. */
function TableRow({ deal, c, picked }: { deal: Deal; c: Ctx; picked: boolean }) {
  const disp = c.display(deal);
  const need = c.needOf.get(deal.id);
  const band = bandOf(disp.band);
  const key = fenceKey(deal.side);
  const fence = band?.[key] ?? null;
  return (
    <span className={`tr-row${need ? ' needs' : ''}${picked ? ' picked' : ''}`}>
      <span className="dot" aria-hidden="true" />
      <span className="t">
        <b title={disp.title}>{shortTitle(disp.title)}</b>
        <span className="sub"><WhoChip name={c.who(deal).short} /> · {fence !== null ? <>{LIMIT_WORD[key]} <span className="num">{short(fence, deal.terms.currency)}</span></> : TABLES.noRange}</span>
      </span>
      <span className="tr-end">
        {need ? <Chip tone="gold">{TABLES.needChip}</Chip> : <StateChip deal={deal} />}
        <Countdown deadline={need?.deadline ?? disp.deadline} />
      </span>
    </span>
  );
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
  const sorts = useMemo(() => liveSorts(c), [c]);
  // Rows come in the list's first order, so the table picked by default is the one on top.
  const soonest = sorts[0]?.compare;
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
      <ModuleLayer module="tables" kicker={TABLES.kicker} answer={dq.error ? TABLES_TRADE.dealsWhat : TABLES.reading} yourCall={null}
        empty={dq.error ? <WalletNotice error={dq.error} what={TABLES_TRADE.dealsWhat} message={TABLES_TRADE.unread} /> : TABLES.reading} />
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
      <div className="tb-pane" key={d.id}>
        <header className="tr-phead">
          <h2 title={disp.title}>{disp.title}</h2>
          <span className="tr-with" title={who.full}>{TABLES.withWho(who.short)}</span>
          <StateChip deal={d} />
          <Amount money={dealTotal(d)} tone={amountTone(d)} />
          <span className="ui-spacer" />
          {worthWatching(d, disp.band) ? <Btn sm kind="plain" onClick={() => { watchTable(d.id); route.open('watch'); }} title={TABLES_WATCH.watchItTitle}>{TABLES_WATCH.watchIt}</Btn> : null}
          <Btn sm kind="plain" onClick={() => open(d)} title={TABLES_TRADE.openDealTitle}>{TABLES_TRADE.openDeal}</Btn>
        </header>
        {withNeed && need ? <NeedCard deal={d} disp={disp} need={need} who={who.short} onDeal={() => open(d)} onToast={say} /> : null}
        <TableDetail deal={d} disp={disp} need={need} who={who.short} st={stateOf(d.id)} steps={handlers(d)} onToast={say} />
        <TheirWords dealId={d.id} who={who.full} />
      </div>
    );
  };
  const tableList = (rows: readonly Deal[], label: string, picked: Deal | undefined, pick: (k: string) => void, empty: string) => (
    <ListEngine<Deal> label={label} rows={rows} getKey={(d) => d.id} filters={rows.length > 8 ? filters : undefined} sorts={sorts} estimateSize={60} measure
      searchText={(d) => `${display(d).title} ${cp(d.counterparty).name}`}
      renderRow={(d) => <TableRow deal={d} c={c} picked={picked?.id === d.id} />}
      rowLabel={(d) => `${display(d).title}, ${c.who(d).full}`} onPick={(d) => pick(d.id)} onOpen={open} empty={empty} />
  );
  const tablesView = (title: string, subLine: string) => ({
    title, sub: subLine,
    render: () => <SplitView label={TABLES.openList} count={openDeals.length} list={tableList(openDeals, TABLES.openList, pickedTable, pickTable, TABLES.openEmpty)} pane={tablePane(pickedTable, true)} />,
  });

  // Latest: the open tables (waiting ones first), then the ones that ended; each opens its deal.
  const latestRows = [...openDeals, ...closed];
  const latest: LatestProps = {
    title: LATEST_OF.tables, total: latestRows.length,
    rows: latestRows.slice(0, MAX_ROWS).map((d) => ({
      key: d.id, label: `${display(d).title}, ${OPEN_THE_DEAL}`, onOpen: () => open(d),
      node: isLive(d) ? <TableRow deal={d} c={c} picked={false} /> : <DealRow deal={d} who={c.who(d).full} />,
    })),
    seeAll: { onOpen: () => route.open(openDeals.length ? 'tables' : 'closed') },
  };

  return (
    <ModuleLayer module="tables" kicker={TABLES.kicker} answer={answer} sub={sub} yourCall={yourCall} latest={latest}
      action={<><Btn onClick={() => route.open('watch')} title={TABLES_WATCH.watchAllTitle}>{TABLES_WATCH.watchAll}</Btn><Btn onClick={() => nav.place('pairing')} title={TABLES.openTableTitle}>{TABLES.openTable}</Btn></>}
      cards={cards}
      explain={{ summary: TABLES.whyTitle, body: <ol className="tr-steps">{TABLES.why.map((s) => <li key={s}>{s}</li>)}</ol> }}
      views={{
        need: {
          title: TABLES_VIEWS.need, sub: needDeals.length ? TABLES.needSub(needDeals.length) : undefined,
          render: () => <SplitView label={TABLES.needList} count={needDeals.length} list={tableList(needDeals, TABLES.needList, pickedNeed, pickNeed, TABLES.needEmpty)} pane={tablePane(pickedNeed, true)} />,
        },
        tables: tablesView(TABLES_VIEWS.tables, TABLES.openSub),
        ladder: tablesView(TABLES_VIEWS.ladder, TABLES.ladderSub),
        shop: {
          title: TABLES_VIEWS.shop, sub: TABLES.shopNote,
          actions: <ShopAroundButton groups={groupList} deals={deals} display={display} onGrouped={() => void groups.refetch()} onToast={say} />,
          render: () => (
            <>
              {groups.error ? <WalletNotice error={groups.error} what={TABLES.groupsWhat} message={TABLES_TRADE.unread} /> : null}
              <ShopView groups={groupList} deals={deals} display={display} />
            </>
          ),
        },
        watch: {
          title: TABLES_VIEWS.watch, sub: TABLES_WATCH.sub,
          render: () => <WatchView deals={deals} display={display} needOf={needOf} who={c.who} />,
        },
        closed: {
          title: TABLES_VIEWS.closed, sub: closed.length ? TABLES.endedSub(closed.length) : undefined,
          render: () => (
            <ListEngine<Deal> label={TABLES.endedList} rows={closed} getKey={(d) => d.id} filters={ENDED_FILTERS} sorts={ENDED_SORTS} estimateSize={56} measure
              searchText={(d) => `${display(d).title} ${cp(d.counterparty).name}`}
              renderRow={(d) => <DealRow deal={d} who={c.who(d).full} />}
              rowLabel={(d) => `${display(d).title}, ${OPEN_THE_DEAL}`} onOpen={open} empty={TABLES.endedEmpty} />
          ),
        },
      }} />
  );
}

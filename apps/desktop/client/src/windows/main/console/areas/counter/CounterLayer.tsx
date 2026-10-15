// The Counter layer (rebuild WP3a): the owner's shop. One answer ("is anyone buying?"), the "Your
// call" chip, and four cards: Open orders, Your prices, Shop rules, Closed orders. Each opens a nested
// view: a searchable list and the picked order or item beside it. Lowest prices are a signed seller
// rule set: a price change is a draft here whose only way out is the approval window (`approval_open`);
// main never signs. Escape with an unsigned change warns once; Ctrl+Enter reviews it. The order
// history is read only for the picked order. Pure logic: modules/counter/model.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Deal } from '@bindings/Deal';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import { clockLabel, formatMinor, formatMoney } from '../../../../../lib/format';
import { useNow, useQuery } from '../../../../../lib/hooks';
import { COUNTER, COUNTER_VIEWS, LATEST_OF, OPEN_THE_DEAL, TABLES_TRADE, timeLeftWords } from '../../../../../lib/words';
import { WalletNotice } from '../../../../../shared/honesty';
import { Btn, Chip, Kv, Loading, useLayer, useLayerCount, useToast } from '../../../../../shared/ui';
import { silenceParts } from '../../../home/model';
import { chipClass, dealTotal, isLive, PENDING_BACKEND, sumByCurrency } from '../../../logic';
import {
  buildCatalog, draftFloor, draftImpact, draftState, itemName, matchesFilter, sellerMandates, underDraft, vsMarket, type CatalogRow, type FloorDraft,
} from '../../../modules/counter/model';
import { useCpLookup } from '../../../ui';
import { useModuleRoute } from '../../../viewNav';
import { useDeals, useNeeds, useWorldSelector, type World } from '../../../world';
import type { LayerProps } from '../../layers';
import { ListEngine, type ListFilter, type ListSort } from '../../ListEngine';
import { MAX_ROWS, type LatestProps } from '../../Latest';
import { ModuleLayer, type YourCall } from '../../ModuleLayer';
import type { ModuleCard } from '../../ModuleSummary';
import { Amount, Countdown, StateChip, WhoChip } from '../../rows';
import { SplitView, usePick } from '../tables/parts';
import { MiniBar, OrderPane } from './Order';
import { DraftBar, ItemPane } from './Prices';

const selModuleOf = (w: World) => w.moduleOfDeal;
const selDisplay = (w: World) => w.display;
const selNeedOf = (w: World) => w.needOf;
const selAll = (w: World) => w.deals.data;

const sum = (ds: readonly Deal[]): string => sumByCurrency(ds.map(dealTotal)).map((m) => formatMinor(m.minor, m.currency)).join(' · ');

const ORDER_SORTS = (deadlineOf: (d: Deal) => number): readonly ListSort<Deal>[] => [
  { value: 'soonest', label: COUNTER.sSoonest, compare: (a, b) => deadlineOf(a) - deadlineOf(b) },
  { value: 'largest', label: COUNTER.sLargest, compare: (a, b) => dealTotal(b).minor - dealTotal(a).minor },
];
const PAST_SORTS: readonly ListSort<Deal>[] = [
  { value: 'newest', label: COUNTER.sNewest, compare: (a, b) => (b.updated_at ?? b.created_at ?? 0) - (a.updated_at ?? a.created_at ?? 0) },
  { value: 'largest', label: COUNTER.sLargest, compare: (a, b) => dealTotal(b).minor - dealTotal(a).minor },
];
const PAST_FILTERS: readonly ListFilter<Deal>[] = [
  { value: 'paid', label: COUNTER.fPaid, test: (d) => chipClass(d) === 'done' },
  { value: 'stopped', label: COUNTER.fStopped, test: (d) => chipClass(d) !== 'done' },
];
const ITEM_SORTS: readonly ListSort<CatalogRow>[] = [
  { value: 'name', label: COUNTER.sName, compare: (a, b) => itemName(a).localeCompare(itemName(b)) },
  { value: 'orders', label: COUNTER.ordersNow, compare: (a, b) => b.deals.filter(isLive).length - a.deals.filter(isLive).length },
];

export function CounterLayer({ nav }: LayerProps) {
  const route = useModuleRoute();
  const toast = useToast();
  const now = useNow();
  const dq = useDeals();
  const all = dq.data;
  const allDeals = useWorldSelector(selAll);
  const moduleOf = useWorldSelector(selModuleOf);
  const display = useWorldSelector(selDisplay);
  const needOf = useWorldSelector(selNeedOf);
  const needs = useNeeds();
  const cp = useCpLookup();
  const mq = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  const seller = useMemo(() => sellerMandates(mq.data ?? []), [mq.data]);
  const mandate = seller[0] ?? null;
  const deals = useMemo(() => (all ?? []).filter((d) => moduleOf(d) === 'counter'), [all, moduleOf]);
  const rows = useMemo(() => buildCatalog(seller, deals, allDeals ?? [], (d) => display(d).title), [seller, deals, allDeals, display]);
  const rowOf = useMemo(() => new Map(rows.map((r) => [r.itemRef, r])), [rows]);
  const live = useMemo(() => {
    const at = (d: Deal) => needOf(d.id)?.deadline ?? display(d).deadline ?? Infinity;
    return deals.filter(isLive).sort((a, b) => at(a) - at(b));
  }, [deals, needOf, display]);
  const past = useMemo(() => deals.filter((d) => !isLive(d)).sort((a, b) => (b.updated_at ?? b.created_at ?? 0) - (a.updated_at ?? a.created_at ?? 0)), [deals]);
  const mine = useMemo(() => needs.filter((n) => deals.some((d) => d.id === n.deal_id)), [needs, deals]);
  const deadlineOf = (d: Deal): number => needOf(d.id)?.deadline ?? display(d).deadline ?? Infinity;
  const deadlineRef = useRef(deadlineOf);
  deadlineRef.current = deadlineOf;
  const orderSorts = useMemo(() => ORDER_SORTS((d) => deadlineRef.current(d)), []);
  const orderFilters = useMemo<readonly ListFilter<Deal>[]>(() => [
    { value: 'needs', label: COUNTER.fNeeds, test: (d) => !!needOf(d.id) },
    { value: 'waiting', label: COUNTER.fWaiting, test: (d) => chipClass(d) === 'wait' },
  ], [needOf]);

  // The price draft: item -> typed text (an unsigned seller rule change).
  const [draft, setDraft] = useState<FloorDraft>({});
  const [armed, setArmed] = useState(false);
  const { diff, errors } = useMemo(() => draftState(rows, draft), [rows, draft]);
  const impact = useMemo(() => draftImpact(diff), [diff]);
  const hasDraft = diff.length > 0 || errors.length > 0;
  const itemFilters = useMemo<readonly ListFilter<CatalogRow>[]>(() => [
    { value: 'live', label: COUNTER.fWithOrders, test: (r) => matchesFilter(r, 'live', draft) },
    { value: 'over', label: COUNTER.fAbove, test: (r) => matchesFilter(r, 'over', draft) },
    { value: 'draft', label: COUNTER.fChanged, test: (r) => matchesFilter(r, 'draft', draft) },
  ], [draft]);
  // Escape with an unsigned change warns once (a layer, so it runs before the console's Back).
  useLayer(() => { setArmed(true); toast(COUNTER.escWarn, 'gold'); }, 'other', hasDraft && !armed);
  useEffect(() => { if (!hasDraft) setArmed(false); }, [hasDraft]);
  const setFloor = (item: string, text: string | undefined) => setDraft((d) => {
    const n = { ...d };
    if (text === undefined) delete n[item]; else n[item] = text;
    return n;
  });
  const fixFirst = () => { const e = errors[0]; if (e) toast(COUNTER.fixFirst(errors.length, itemName(e.row), e.error), 'bad'); else if (!diff.length) toast(COUNTER.noDiff); };
  const opened = () => {
    const first = diff[0];
    toast(first?.row.source ? COUNTER.handedOff(formatMoney(first.to), diff.length - 1) : COUNTER.handedOffNone, 'gold');
  };
  // Ctrl+Enter reviews the draft (only when no sheet or popover is above the page).
  const layers = useLayerCount();
  const reviewRef = useRef<() => void>(() => {});
  reviewRef.current = () => {
    if (errors.length || !diff.length) { fixFirst(); return; }
    document.querySelector<HTMLButtonElement>('.ctr-tray .ui-btn.gold')?.click();
  };
  useEffect(() => {
    const k = (e: globalThis.KeyboardEvent) => {
      if (layers > (hasDraft && !armed ? 1 : 0)) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && hasDraft) { e.preventDefault(); reviewRef.current(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [layers, hasDraft, armed]);

  const [pickedOrder, pickOrder] = usePick(live, (d) => d.id);
  const [pickedPast, pickPast] = usePick(past, (d) => d.id);
  const [pickedItem, pickItem] = usePick(rows, (r) => r.itemRef);
  const first = mine[0];
  const ifNothing = first ? silenceParts(first.on_silence).head : null;
  const yourCall: YourCall | null = mine.length ? { count: mine.length, ifNothing, onOpen: () => route.open('orders', 'orders') } : null;

  if (!all) {
    return (
      <ModuleLayer module="counter" kicker={COUNTER.kicker} answer={dq.error ? TABLES_TRADE.dealsWhat : COUNTER.reading} yourCall={null}
        empty={dq.error ? <WalletNotice error={dq.error} what={TABLES_TRADE.dealsWhat} message={TABLES_TRADE.unread} /> : COUNTER.reading} />
    );
  }

  // The answer: is anyone buying, and what is waiting.
  let answer: string;
  let sub: string | undefined;
  if (!live.length) {
    const paid = past.filter((d) => chipClass(d) === 'done');
    answer = COUNTER.nobody;
    sub = paid.length ? COUNTER.paidSub(paid.length, sum(paid)) : COUNTER.waitSub;
  } else {
    const asks = live.filter((d) => !!needOf(d.id)).length;
    answer = `${COUNTER.open(live.length, sum(live))}${asks ? COUNTER.openNeeds(asks) : ''}`;
    const soon = live.map((d) => ({ d, at: needOf(d.id)?.deadline ?? display(d).deadline })).filter((x): x is { d: Deal; at: number } => x.at !== null).sort((a, b) => a.at - b.at)[0];
    sub = soon ? COUNTER.closest(cp(soon.d.counterparty).name, timeLeftWords(soon.at - now)) : undefined;
  }
  const signedFloors = rows.filter((r) => r.signed).length;
  const cards: ModuleCard[] = [
    { id: 'orders', view: 'orders', label: COUNTER_VIEWS.orders, value: COUNTER.ordersValue(live.length), note: live.length ? sum(live) : COUNTER.ordersNote,
      chip: mine.length ? COUNTER.needsChip : undefined, chipTone: 'gold', ifNothing },
    { id: 'prices', view: 'prices', label: COUNTER_VIEWS.prices, value: COUNTER.pricesValue(rows.length), note: COUNTER.pricesNote(signedFloors, !!mandate),
      chip: hasDraft ? COUNTER.draftChip : undefined, chipTone: 'gold' },
    { id: 'rules', view: 'rules', label: COUNTER_VIEWS.rules, value: mq.data ? COUNTER.rulesValue(!!mandate) : '—', note: COUNTER.rulesNote(mandate ? clockLabel(mandate.payload.expires) : null) },
    { id: 'earlier', view: 'earlier', label: COUNTER_VIEWS.earlier, value: COUNTER.earlierValue(past.length), note: COUNTER.earlierNote(past.length > 0) },
  ];

  const orderRow = (d: Deal, picked: boolean) => {
    const disp = display(d);
    const need = needOf(d.id);
    const row = rowOf.get(d.terms.item_ref);
    return (
      <span className={`tr-row${need ? ' needs' : ''}${picked ? ' picked' : ''}`}>
        <span className="dot" aria-hidden="true" />
        <span className="t">
          <b title={disp.title}>{disp.title}</b>
          <span className="sub"><WhoChip name={cp(d.counterparty).name} /></span>
          {isLive(d) ? <span className="ctr-line"><MiniBar deal={d} /><Countdown deadline={need?.deadline ?? disp.deadline} /></span> : null}
        </span>
        <span className="ctr-end">
          {need ? <Chip tone="gold">{COUNTER.needsChip}</Chip> : <StateChip deal={d} />}
          {underDraft(d, row, draft) ? <Chip tone="coral" title={COUNTER.withdrawsTitle}>{COUNTER.withdrawsChip}</Chip> : null}
          <Amount money={dealTotal(d)} tone={isLive(d) ? undefined : chipClass(d) === 'done' ? 'moved' : 'struck'} />
        </span>
      </span>
    );
  };
  const orderList = (rowsOf: readonly Deal[], label: string, picked: Deal | undefined, pick: (k: string) => void, empty: string, filters: readonly ListFilter<Deal>[], sorts: readonly ListSort<Deal>[]) => (
    <ListEngine<Deal> label={label} rows={rowsOf} getKey={(d) => d.id} filters={filters} sorts={sorts} estimateSize={64} measure
      searchText={(d) => `${display(d).title} ${cp(d.counterparty).name}`}
      renderRow={(d) => orderRow(d, picked?.id === d.id)}
      rowLabel={(d) => `${display(d).title}, ${cp(d.counterparty).name}`} onPick={(d) => pick(d.id)} onOpen={(d) => nav.deal(d.id)} empty={empty} />
  );
  // Latest: the live orders (waiting ones first, as the orders view lists them), else the earlier ones.
  const latestOrders = (list: readonly Deal[], open: boolean): LatestProps => ({
    title: LATEST_OF.counter, total: list.length, rowGuess: 78,
    rows: list.slice(0, MAX_ROWS).map((d) => ({ key: d.id, label: `${display(d).title}, ${OPEN_THE_DEAL}`, onOpen: () => nav.deal(d.id), node: orderRow(d, false) })),
    seeAll: { onOpen: () => route.open(open ? 'orders' : 'earlier') },
  });
  const orderPane = (d: Deal | undefined) => (d ? <OrderPane key={d.id} deal={d} disp={display(d)} row={rowOf.get(d.terms.item_ref)} draft={draft} /> : null);
  const catPending = !!PENDING_BACKEND.counter;
  const tray = <DraftBar mandate={mandate} diff={diff} errors={errors} impact={impact} title={display}
    onDiscard={() => { setDraft({}); toast(COUNTER.discarded(!!mandate)); }} onFixFirst={fixFirst} onOpened={opened} />;

  return (
    <ModuleLayer module="counter" kicker={COUNTER.kicker} answer={answer} sub={sub} yourCall={yourCall} latest={latestOrders([...live, ...past], live.length > 0)}
      cards={cards}
      explain={{ summary: COUNTER.whyTitle, body: <ul className="tr-steps">{COUNTER.why.map(([t, x]) => <li key={t}><b>{t}.</b> {x}</li>)}</ul> }}
      views={{
        orders: {
          title: COUNTER_VIEWS.orders, sub: COUNTER.ordersSub(live.length),
          render: () => (
            <>
              <SplitView label={COUNTER.ordersList} count={live.length} list={orderList(live, COUNTER.ordersList, pickedOrder, pickOrder, COUNTER.ordersEmpty, orderFilters, orderSorts)} pane={orderPane(pickedOrder)} />
              {hasDraft ? tray : null}
            </>
          ),
        },
        prices: {
          title: COUNTER_VIEWS.prices, sub: COUNTER.pricesSub(rows.length),
          render: () => (
            <>
              {mq.error ? <WalletNotice error={mq.error} what={COUNTER.rulesWhat} message={TABLES_TRADE.unread} /> : null}
              {!mq.data && !mq.error ? <Loading what={COUNTER.rulesReading} /> : (
                <SplitView label={COUNTER.itemsList} count={rows.length}
                  list={(
                    <ListEngine<CatalogRow> label={COUNTER.itemsList} rows={rows} getKey={(r) => r.itemRef} filters={itemFilters} sorts={ITEM_SORTS} estimateSize={56}
                      searchText={(r) => `${r.title ?? ''} ${r.itemRef}`}
                      renderRow={(r) => {
                        const f = draftFloor(r, draft);
                        const changed = draft[r.itemRef] !== undefined;
                        const n = r.deals.filter(isLive).length;
                        return (
                          <span className={`tr-row${pickedItem?.itemRef === r.itemRef ? ' picked' : ''}`}>
                            <span className="t"><b title={itemName(r)}>{itemName(r)}</b><span className="sub">{vsMarket(f, r.market).short} · {COUNTER.ordersCount(n)}</span></span>
                            {changed ? <Chip tone="gold">{COUNTER.draftChip}</Chip> : <span />}
                            {f ? <Amount money={f} /> : <span className="tx-dim">{COUNTER.notSet}</span>}
                          </span>
                        );
                      }}
                      rowLabel={(r) => itemName(r)} onPick={(r) => pickItem(r.itemRef)} empty={COUNTER.itemsEmpty} />
                  )}
                  pane={pickedItem ? <ItemPane key={pickedItem.itemRef} row={pickedItem} draft={draft} mandate={mandate} catPending={catPending}
                    onText={(t) => setFloor(pickedItem.itemRef, t)} onOrder={(d) => nav.deal(d.id)} /> : null} />
              )}
              {tray}
            </>
          ),
        },
        rules: {
          title: COUNTER_VIEWS.rules, sub: COUNTER.rulesSub,
          actions: <Btn onClick={() => nav.place('rules')}>{COUNTER.openRules}</Btn>,
          render: () => (mq.error ? <WalletNotice error={mq.error} what={COUNTER.rulesWhat} message={TABLES_TRADE.unread} /> : !mq.data ? <Loading what={COUNTER.rulesReading} /> : <ShopRules mandate={mandate} count={seller.length} floors={signedFloors} />),
        },
        earlier: {
          title: COUNTER_VIEWS.earlier, sub: COUNTER.earlierSub(past.length),
          render: () => <SplitView label={COUNTER.earlierList} count={past.length} list={orderList(past, COUNTER.earlierList, pickedPast, pickPast, COUNTER.earlierEmpty, PAST_FILTERS, PAST_SORTS)} pane={orderPane(pickedPast)} />,
        },
      }} />
  );
}

/** The shop rules: the promise, what is set, how long, for which agent, and where they change. */
function ShopRules({ mandate, count, floors }: { mandate: MandateListEntry | null; count: number; floors: number }) {
  if (!mandate) return <p className="le-empty">{COUNTER.rulesNone}</p>;
  return (
    <div className="ctr-rules">
      <Kv items={[
        [COUNTER.promise, COUNTER.promiseV],
        [COUNTER.pricesSet, COUNTER.pricesSetV(floors)],
        [COUNTER.inForceK, `${clockLabel(mandate.payload.not_before)} → ${clockLabel(mandate.payload.expires)}`],
        [COUNTER.signedFor, COUNTER.signedForV(mandate.agent)],
        count > 1 ? [COUNTER.also, COUNTER.alsoV(count - 1)] : null,
        [COUNTER.changedIn, COUNTER.changedInV],
        [COUNTER.version, <span className="tx-dim">{COUNTER.versionV(mandate.payload.version)}</span>],
      ]} />
    </div>
  );
}

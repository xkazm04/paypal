// Shop around on the Tables layer (rebuild WP3a): the groups of sellers for one item, each seller's
// latest signed price and the winner once one agreed, and the quiet "Shop around" action that groups
// open tables for one item (`deal_group_open`). Grouping only restricts: Rust lets one seller agree
// and tells the others no with a signed message; no money moves here. Pure logic: modules/tables/groups.ts.
import { useMemo, useState } from 'react';
import type { Deal } from '@bindings/Deal';
import type { DealGroupView } from '@bindings/DealGroupView';
import type { GroupTable } from '@bindings/GroupTable';
import { formatMoney } from '../../../../../lib/format';
import { useMutation } from '../../../../../lib/hooks';
import { GROUP_CLOSED, GROUP_WINNER, SHOP_AROUND, SHOP_AROUND_MEANS, SHOP_AROUND_OTHERS, sellersWord, shoppingFor, stateWord, TABLES, tablesItem, tablesShortWho } from '../../../../../lib/words';
import { WalletNotice } from '../../../../../shared/honesty';
import { Btn, Chip, Kv, Sheet, type ChipTone } from '../../../../../shared/ui';
import { isLive } from '../../../logic';
import { groupStanding, isOpenTable, shopAroundSets } from '../../../modules/tables/groups';
import { useCpLookup } from '../../../ui';
import { useLayerNav } from '../../layers';
import { ListEngine, type ListSort } from '../../ListEngine';
import { Amount, StateChip, WhoChip } from '../../rows';
import type { World } from '../../../world';
import { SplitView, usePick } from './parts';

/** Groups still worth showing: bargaining, or won while the winning deal is still under way. */
export function liveGroups(groups: readonly DealGroupView[], deals: readonly Deal[]): DealGroupView[] {
  const byId = new Map(deals.map((d) => [d.id, d]));
  return groups.filter((g) => {
    const s = groupStanding(g);
    if (s.kind === 'bargaining') return true;
    if (s.kind === 'won') {
      const w = byId.get(s.winner.deal_id);
      return !!w && isLive(w);
    }
    return false;
  });
}

function chipOf(g: DealGroupView, who: (t: GroupTable) => string): { tone: ChipTone; text: string } {
  const s = groupStanding(g);
  if (s.kind === 'won') return { tone: 'ok', text: TABLES.agreedWith(who(s.winner)) };
  if (s.kind === 'ended') return { tone: 'line', text: TABLES.endedNothing };
  return { tone: 'teal', text: TABLES.bargaining };
}

const SORTS: readonly ListSort<DealGroupView>[] = [
  { value: 'size', label: TABLES.sLargest, compare: (a, b) => b.tables.length - a.tables.length },
];

/** The Shop around view: the groups on the left, the picked group's sellers on the right. */
export function ShopView({ groups, deals, display }: { groups: readonly DealGroupView[]; deals: readonly Deal[]; display: World['display'] }) {
  const cp = useCpLookup();
  const live = useMemo(() => liveGroups(groups, deals), [groups, deals]);
  const byId = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);
  const itemOf = (g: DealGroupView): string => {
    const first = byId.get(g.tables[0]?.deal_id ?? '');
    return first ? tablesItem(display(first).title) : `the ${g.item_ref}`;
  };
  const who = (t: GroupTable) => tablesShortWho(cp(t.counterparty));
  const [picked, pick] = usePick(live, (g) => g.group_id);
  return (
    <SplitView label={TABLES.groupsWhat} count={live.length}
      list={(
        <ListEngine<DealGroupView> label={TABLES.groupList} rows={live} getKey={(g) => g.group_id} sorts={SORTS} estimateSize={64}
          searchText={(g) => `${itemOf(g)} ${g.tables.map((t) => cp(t.counterparty).name).join(' ')}`}
          renderRow={(g) => {
            const c = chipOf(g, who);
            const s = groupStanding(g);
            return (
              <span className={`tr-row${picked?.group_id === g.group_id ? ' picked' : ''}`}>
                <span className="t"><b>{shoppingFor(itemOf(g))}</b><span className="sub">{sellersWord(g.tables.length)}{s.kind === 'bargaining' && s.best?.seller_price ? <> · {TABLES.best(formatMoney(s.best.seller_price))}</> : null}</span></span>
                <Chip tone={c.tone}>{c.text}</Chip>
              </span>
            );
          }}
          rowLabel={(g) => shoppingFor(itemOf(g))} onOpen={(g) => pick(g.group_id)}
          empty={TABLES.shopEmpty} />
      )}
      pane={picked ? <GroupDetail group={picked} item={itemOf(picked)} byId={byId} who={who} /> : null} />
  );
}

function GroupDetail({ group, item, byId, who }: { group: DealGroupView; item: string; byId: ReadonlyMap<string, Deal>; who: (t: GroupTable) => string }) {
  const nav = useLayerNav();
  const s = groupStanding(group);
  const best = s.kind === 'bargaining' ? s.best : null;
  const c = chipOf(group, who);
  return (
    <div className="tb-group">
      <header className="tr-phead">
        <h2 title={item}>{shoppingFor(item)}</h2>
        <Chip tone={c.tone} title={SHOP_AROUND_MEANS}>{c.text}</Chip>
      </header>
      <ul className="tb-sellers" aria-label={TABLES.sellersFor(item)}>
        {group.tables.map((t) => {
          const deal = byId.get(t.deal_id);
          const word = group.winner === t.deal_id ? GROUP_WINNER : t.closed_by_group ? GROUP_CLOSED : stateWord(t.state, { side: 'buyer', kind: 'haggle' });
          const struck = t.closed_by_group || (!isOpenTable(t) && group.winner !== t.deal_id);
          const sub = group.winner === t.deal_id ? TABLES.agreedPrice
            : t.closed_by_group ? TABLES.toldNo
            : t.seller_price ? (best?.deal_id === t.deal_id ? TABLES.lowestSoFar : TABLES.latestPrice)
            : TABLES.noPriceYet;
          return (
            <li key={t.deal_id}>
              <span className="t"><WhoChip name={who(t)} /><span className="sub">{sub}</span></span>
              <Chip tone={word.tone} title={word.means}>{word.text}</Chip>
              {t.seller_price ? <Amount money={t.seller_price} tone={struck ? 'struck' : undefined} /> : <span className="tx-dim">{TABLES.noPrice}</span>}
              {deal ? <Btn sm kind="plain" onClick={() => nav.deal(t.deal_id)}>{TABLES.tableWith(who(t))} ›</Btn> : null}
            </li>
          );
        })}
      </ul>
      <p className="ui-hint">{s.kind === 'won' ? SHOP_AROUND_OTHERS : TABLES.shopMeansFirst}</p>
    </div>
  );
}

/** "Shop around": shown only when two or more sellers have an open table for the same item. Never gold. */
export function ShopAroundButton({ groups, deals, display, onGrouped, onToast }: {
  groups: readonly DealGroupView[]; deals: readonly Deal[]; display: World['display']; onGrouped: () => void; onToast: (text: string, tone?: 'gold' | 'ok') => void;
}) {
  const cp = useCpLookup();
  const run = useMutation('deal_group_open');
  const [open, setOpen] = useState(false);
  const set = shopAroundSets(deals, groups)[0];
  if (!set || !set[0]) return null;
  const item = tablesItem(display(set[0]).title);
  const close = () => { setOpen(false); run.reset(); };
  return (
    <>
      <Btn onClick={() => setOpen(true)} title={TABLES.shopTitle(sellersWord(set.length), item)}>{SHOP_AROUND}</Btn>
      {open ? (
        <Sheet title={TABLES.shopQ(item)} size="narrow" onClose={close} className="ar-tables"
          footer={<>
            <Btn onClick={close}>{TABLES.notNow}</Btn>
            <Btn kind="primary" disabled={run.pending} onClick={async () => {
              const r = await run.run({ deal_ids: set.map((d) => d.id) });
              if (r === undefined) return;
              setOpen(false);
              onGrouped();
              onToast(TABLES.shopDone(item, sellersWord(set.length)), 'ok');
            }}>{run.pending ? TABLES.grouping : TABLES.shopWith(sellersWord(set.length))}</Btn>
          </>}>
          <p>{SHOP_AROUND_MEANS}</p>
          <ul className="tb-sellers" aria-label={TABLES.sellers}>
            {set.map((d) => <li key={d.id}><span className="t"><WhoChip name={tablesShortWho(cp(d.counterparty))} /></span><StateChip deal={d} /></li>)}
          </ul>
          <Kv items={TABLES.shopFacts} />
          {run.error ? <WalletNotice error={run.error} what={TABLES.shopWhat} /> : null}
        </Sheet>
      ) : null}
    </>
  );
}

/** Whether any two open tables could shop around (the summary card says "Ready"). */
export const canShopAround = (deals: readonly Deal[], groups: readonly DealGroupView[]): boolean => shopAroundSets(deals, groups).length > 0;

// Shop around (T8) on the Tables page: one card per group ("Shopping around for the 27-inch 4K
// monitor: 2 sellers") with each seller's latest signed price and the winner once one agreed, and
// the quiet "Shop around" action that groups open tables for one item. Grouping only restricts:
// Rust lets one seller agree and tells the others no with a signed message; no money moves here.
// Styles: ../tables.css (.tb-group*). Pure logic: ./groups.ts.
import { useState } from 'react';
import type { Deal } from '@bindings/Deal';
import type { DealGroupView } from '@bindings/DealGroupView';
import type { GroupTable } from '@bindings/GroupTable';
import { formatMoney } from '../../../../lib/format';
import { useMutation } from '../../../../lib/hooks';
import {
  GROUP_CLOSED, GROUP_WINNER, SHOP_AROUND, SHOP_AROUND_MEANS, SHOP_AROUND_OTHERS, sellersWord, shoppingFor, stateWord,
} from '../../../../lib/words';
import { MinorMoney, WalletNotice } from '../../../../shared/honesty';
import { Btn, Chip, Group, Kv, Row, Sheet, type ChipTone } from '../../../../shared/ui';
import { isLive } from '../../logic';
import { useCpLookup, useToast } from '../../ui';
import { useWorld } from '../../world';
import type { ModuleProps } from '../common';
import { groupStanding, isOpenTable, shopAroundSets } from './groups';

/** "the refurbished 27-inch 4K monitor" from the deal title (same rule as the page's answer). */
const asItem = (title: string): string => `the ${/^[A-Z][a-z]/.test(title) ? title.charAt(0).toLowerCase() + title.slice(1) : title}`;
const shortWho = (c: { house?: boolean; name: string }): string => (c.house ? 'House seller' : c.name.split(' · ')[0] ?? c.name);

/** Groups still worth a card: bargaining, or won while the winning deal is still under way. */
function showing(groups: readonly DealGroupView[], deals: readonly Deal[]): DealGroupView[] {
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

/** One card per live group, above the single tables. */
export function ShopAroundCards({ groups, deals, nav }: { groups: readonly DealGroupView[]; deals: readonly Deal[]; nav: ModuleProps['nav'] }) {
  const live = showing(groups, deals);
  if (!live.length) return null;
  return (
    <section className="tb-groups" aria-label="Shopping around">
      {live.map((g) => <GroupCard key={g.group_id} group={g} deals={deals} nav={nav} />)}
    </section>
  );
}

function GroupCard({ group, deals, nav }: { group: DealGroupView; deals: readonly Deal[]; nav: ModuleProps['nav'] }) {
  const w = useWorld();
  const cp = useCpLookup();
  const s = groupStanding(group);
  const first = deals.find((d) => d.id === group.tables[0]?.deal_id);
  const item = first ? asItem(w.display(first).title) : `the ${group.item_ref}`;
  const who = (t: GroupTable) => shortWho(cp(t.counterparty));
  const chip: { tone: ChipTone; text: string } = s.kind === 'won'
    ? { tone: 'ok', text: `Agreed with ${who(s.winner)}` }
    : s.kind === 'ended' ? { tone: 'line', text: 'Ended, nothing bought' } : { tone: 'teal', text: 'Bargaining' };
  const best = s.kind === 'bargaining' ? s.best : null;
  return (
    <article className="tb-card tb-group">
      <header className="tb-card-h">
        <h3 title={item}>{shoppingFor(item)}</h3>
        <span className="with">{sellersWord(group.tables.length)}</span>
        <Chip tone={chip.tone} title={SHOP_AROUND_MEANS}>{chip.text}</Chip>
      </header>
      <Group label={`Sellers for ${item}`}>
        {group.tables.map((t) => {
          const deal = deals.find((d) => d.id === t.deal_id);
          const need = !!w.needOf(t.deal_id);
          const word = group.winner === t.deal_id ? GROUP_WINNER : t.closed_by_group ? GROUP_CLOSED : stateWord(t.state, { side: 'buyer', kind: 'haggle' });
          const struck = t.closed_by_group || (!isOpenTable(t) && group.winner !== t.deal_id);
          const sub = group.winner === t.deal_id ? 'Their price, agreed'
            : t.closed_by_group ? 'Told no · no money moved'
            : t.seller_price ? (best?.deal_id === t.deal_id ? 'Their latest price · lowest so far' : 'Their latest price')
            : 'No price yet';
          return (
            <Row key={t.deal_id} title={who(t)} sub={sub} need={need} onOpen={deal ? () => nav.onDeal(t.deal_id) : undefined}
              label={`${who(t)}: ${word.text}${t.seller_price ? `, ${formatMoney(t.seller_price)}` : ''}`}>
              <Chip tone={word.tone} title={word.means}>{word.text}</Chip>
              {t.seller_price ? <span className={`amt ${struck ? 'struck' : ''}`}><MinorMoney minor={t.seller_price.minor} currency={t.seller_price.currency} /></span> : <span className="amt proposed">no price yet</span>}
            </Row>
          );
        })}
      </Group>
      <p className="tb-group-foot">{s.kind === 'won' ? SHOP_AROUND_OTHERS : 'The first seller to agree wins; the others are told no. You pay at most once.'}</p>
    </article>
  );
}

/** "Shop around": shown only when two or more sellers have an open table for the same item. Never gold. */
export function ShopAroundButton({ groups, deals, onGrouped }: { groups: readonly DealGroupView[]; deals: readonly Deal[]; onGrouped: () => void }) {
  const w = useWorld();
  const cp = useCpLookup();
  const toast = useToast();
  const run = useMutation('deal_group_open');
  const [open, setOpen] = useState(false);
  const set = shopAroundSets(deals, groups)[0];
  if (!set) return null;
  const item = asItem(w.display(set[0]!).title);
  const close = () => { setOpen(false); run.reset(); };
  return (
    <>
      <Btn onClick={() => setOpen(true)} title={`Let ${sellersWord(set.length)} compete for ${item}. The first to agree wins.`}>{SHOP_AROUND}</Btn>
      {open ? (
        <Sheet title={`Shop around for ${item}?`} size="narrow" onClose={close} className="mod-tables"
          footer={<>
            <Btn onClick={close}>Not now</Btn>
            <Btn kind="primary" disabled={run.pending} onClick={async () => {
              const r = await run.run({ deal_ids: set.map((d) => d.id) });
              if (r === undefined) return;
              setOpen(false);
              onGrouped();
              toast(<>Shopping around for <b>{item}</b> with {sellersWord(set.length)}. The first to agree wins.</>, 'ok');
            }}>{run.pending ? 'Grouping…' : `Shop around with ${sellersWord(set.length)}`}</Btn>
          </>}>
          <p className="tb-sheet-p">{SHOP_AROUND_MEANS}</p>
          <Group label="Sellers">
            {set.map((d) => (
              <Row key={d.id} title={shortWho(cp(d.counterparty))} sub={`Table ${w.display(d).label}`}>
                <Chip tone="teal" title={stateWord(d.state, d).means}>{stateWord(d.state, d).text}</Chip>
              </Row>
            ))}
          </Group>
          <Kv items={[['Money', 'none moves until one seller agrees'], ['Price range', 'the same signed range on every table'], ['Other sellers', 'told no automatically, nothing to approve']]} />
          {run.error ? <WalletNotice error={run.error} what="Shop around" /> : null}
        </Sheet>
      ) : null}
    </>
  );
}

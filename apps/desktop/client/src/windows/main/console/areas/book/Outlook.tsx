// The Book's outlook view (rebuild WP3b): what waits on a deadline, counted from the deals, not a
// forecast. Four lines (holds to decide, payment links open, renewals failing, payments being
// checked with PayPal); each says how many, the money of exactly those (scale finding #8: a count
// never stands next to one item's amount as if it were the total), and its soonest item apart; a
// hold is said as held, never as paid. Under them, those deals in one windowed list.
import { useMemo } from 'react';
import type { Deal } from '@bindings/Deal';
import type { Money } from '@bindings/Money';
import { useQuery } from '../../../../../lib/hooks';
import { BOOK, IF_NOTHING } from '../../../../../lib/words';
import { dealTotal } from '../../../logic';
import { atRiskOf } from '../../../modules/rescue/model';
import { silenceParts } from '../../../home/model';
import { useLayerNav } from '../../layers';
import { ListEngine, type ListFilter } from '../../ListEngine';
import { Amount, Countdown, DealRow } from '../../rows';
import { useDisplayOf } from '../../../world';
import { outlook, outlookCount, outlookKeyOf, OUTLOOK_KEYS, type OutlookItem, type OutlookKey } from './model';
import { fewRows, MoneyText, type BookWorld } from './parts';

/** The outlook over the World, with the deadline and the at-risk amount of each deal. */
export function useOutlook(b: BookWorld): OutlookItem[] {
  // A failing renewal shows what is at risk (the missed cycle), as Rescue does, never the fix's
  // discounted invoice.
  const rescue = useQuery('rescue_book', null, { refreshOn: ['deal:changed', 'receipt:created', 'attention:changed'] });
  const book = rescue.data;
  return useMemo(() => {
    const amountOf = (k: OutlookKey, d: Deal): Money => (k === 'renew' ? atRiskOf(d, book) : dealTotal(d));
    return outlook(b.all, b.checking, (d) => b.needOf.get(d.id)?.deadline ?? null, amountOf);
  }, [b.all, b.checking, b.needOf, book]);
}

function SoonestTitle({ id }: { id: string }) {
  const disp = useDisplayOf(id);
  return <span className="bk-ol-t" title={disp?.title}>{disp?.title ?? BOOK.dash}</span>;
}

/** One outlook line: how many, the money of exactly those, the soonest apart, the default. */
function OutlookLine({ it, b }: { it: OutlookItem; b: BookWorld }) {
  const w = BOOK.outlook[it.key];
  const n = it.deals.length;
  const need = it.soonest ? b.needOf.get(it.soonest.deal.id) : undefined;
  const silence = need ? silenceParts(need.on_silence).head : w.ifNothing;
  return (
    <li className={`bk-ol${n ? ' has' : ''}`} data-ol={it.key}>
      <span className="bk-ol-n num">{n}</span>
      <span className="bk-ol-main">
        <span className="bk-ol-h">{w.label(n)}</span>
        <span className="bk-ol-m">{n ? <><MoneyText ms={it.total} /> <span className="bk-dim">{w.totalNote}</span></> : <span className="bk-dim">{w.none}</span>}</span>
        {it.soonest && n > 1 ? (
          <span className="bk-ol-s">{BOOK.soonest} <Amount money={it.soonest.amount} /> · <SoonestTitle id={it.soonest.deal.id} />{it.soonest.deadline ? <> · <Countdown deadline={it.soonest.deadline} /></> : null}</span>
        ) : it.soonest?.deadline ? <span className="bk-ol-s"><Countdown deadline={it.soonest.deadline} /></span> : null}
        <span className="bk-ol-sil">{IF_NOTHING}: <b>{silence}</b></span>
      </span>
    </li>
  );
}

export function Outlook({ b, items }: { b: BookWorld; items: OutlookItem[] }) {
  const nav = useLayerNav();
  const rows = useMemo(() => items.flatMap((it) => it.deals), [items]);
  const filters = useMemo<readonly ListFilter<Deal>[]>(() => OUTLOOK_KEYS.map((k) => ({ value: k, label: BOOK.outlook[k].short, test: (d: Deal) => outlookKeyOf(d, b.checking) === k })), [b.checking]);
  return (
    <div className="bk-outlook">
      <ul className="bk-ols" aria-label={BOOK.outlookLabel}>{items.map((it) => <OutlookLine key={it.key} it={it} b={b} />)}</ul>
      <p className="ui-hint">{BOOK.notForecast(outlookCount(items))}</p>
      <ListEngine<Deal> className={fewRows(rows.length)} label={BOOK.outlookList} rows={rows} getKey={(d) => d.id} filters={filters} estimateSize={64} measure
        searchText={(d) => `${b.title(d)} ${b.who(d)}`}
        renderRow={(d) => <DealRow deal={d} need={b.needOf.get(d.id)} who={b.who(d)} />}
        rowLabel={(d) => b.title(d)} onOpen={(d) => nav.deal(d.id)} empty={BOOK.outlookEmpty} />
    </div>
  );
}

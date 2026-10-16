// Everything waiting: every decision that needs the owner, in the centre's order, narrowed by
// module. A windowed list (only the rows in view are drawn; one tab stop, arrows move). A row opens
// that decision in the centre, where its one gold action is; nothing here acts on money.
import { useMemo, type CSSProperties } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import type { Module } from '@bindings/Module';
import { formatTally } from '../../../lib/data/counts';
import { useWindowedRows, type RowProps } from '../../../lib/data/useWindowedRows';
import { formatMinor } from '../../../lib/format';
import { useNow } from '../../../lib/hooks';
import { EVERY_MODULE, houseWords, IF_NOTHING, LATEST_OF, OPEN_THE_DEAL, WAITING_EMPTY, WAITING_FILTER, WAITING_KICKER, WAITING_TITLE, waitingShown, waitingTitle } from '../../../lib/words';
import { MODULE, MODULES } from '../../../shared/modules';
import { FilterChips, ListShell, type FilterOption } from '../../../shared/ui';
import { shortTitle, silenceParts, timeLeft } from '../home/model';
import { decidedBy, splitHeadline } from '../logic';
import { useCpLookup } from '../ui';
import { useDeals, useDisplayOf, useWorldSelector, type World } from '../world';
import { Latest, LatestSkeleton, MAX_ROWS, type LatestProps } from './Latest';
import { DealRow } from './rows';
import { Reveal } from './stagger';

const selModuleOf = (w: World) => w.moduleOfDeal;
/** At or under this many waiting rows the list takes its own height (and the decided strip shows). */
const SHORT_LIST = 8;

/** A waiting row's height in px (fixed: three short lines). */
export const WAITING_ROW = 76;

type Filter = Module | 'all';

export function Waiting({ queue, module, onFilter, onPick, onDeal }: {
  queue: readonly AttentionItem[]; module: Module | undefined; onFilter: (m: Module | undefined) => void; onPick: (dealId: string) => void;
  /** Opens a deal (the "decided lately" strip under a short list). */
  onDeal?: (dealId: string) => void;
}) {
  const rows = module ? queue.filter((n) => n.module === module) : queue;
  const counts = new Map<Module, number>();
  for (const n of queue) counts.set(n.module, (counts.get(n.module) ?? 0) + 1);
  const options: FilterOption<Filter>[] = [
    { value: 'all', label: EVERY_MODULE, count: queue.length },
    ...MODULES.filter((m) => counts.has(m.key)).map((m) => ({ value: m.key as Filter, label: m.name, count: counts.get(m.key) ?? 0 })),
  ];
  const list = useWindowedRows({ rows, getKey: (n: AttentionItem) => n.deal_id, estimateSize: WAITING_ROW });
  // A short list takes its own height, and what was decided lately fills the room under it (rebuild
  // WP4a: no dead band). A long list keeps the whole sheet.
  const moduleOfDeal = useWorldSelector(selModuleOf);
  const short = rows.length > 0 && rows.length <= SHORT_LIST;
  const deals = useDeals().data;
  const cp = useCpLookup();
  const decided = useMemo(() => (deals ?? []).filter((d) => !!d.decided_by && (!module || moduleOfDeal(d) === module))
    .sort((a, b) => (b.updated_at ?? b.created_at ?? 0) - (a.updated_at ?? a.created_at ?? 0)), [deals, module, moduleOfDeal]);
  return (
    <div className={`cs-waiting${short ? ' short' : ''}`}>
      <div className="cs-lhead">
        <p className="kicker">{WAITING_KICKER}</p>
        <h1 className="display cs-title" tabIndex={-1} data-layer-title="">{queue.length ? waitingTitle(queue.length) : WAITING_TITLE}</h1>
      </div>
      <ListShell label={WAITING_TITLE} className="cs-wlist"
        filters={options.length > 2 ? <FilterChips<Filter> label={WAITING_FILTER} multi={false} options={options} value={[module ?? 'all']}
          onChange={(v) => { const f = v[0]; onFilter(!f || f === 'all' ? undefined : f); }} /> : undefined}
        summary={queue.length ? waitingShown(rows.length, queue.length, formatTally) : undefined}
        isEmpty={!rows.length} empty={WAITING_EMPTY}
        renderRows={() => (
          <div ref={list.scrollRef} onKeyDown={list.onKeyDown} className="cs-wscroll" role="list" aria-label={WAITING_TITLE} style={short ? { flex: 'none', height: rows.length * WAITING_ROW + 4 } : undefined}>
            <div style={{ height: list.totalSize, position: 'relative' }}>
              {list.items.map((it) => (
                <WaitingRow key={it.key} item={it.row} props={list.rowProps(it)} top={it.start} onPick={onPick} />
              ))}
            </div>
          </div>
        )} />
      {short && onDeal && decided.length ? (
        // The waiting list is the decisions themselves (wave 0); what was decided lately takes its turn.
        <DecidedLately decided={decided} onDeal={onDeal} who={(d) => cp(d.counterparty).name} />
      ) : null}
    </div>
  );
}

function WaitingRow({ item, props, top, onPick }: { item: AttentionItem; props: RowProps; top: number; onPick: (id: string) => void }) {
  const now = useNow();
  const disp = useDisplayOf(item.deal_id);
  const amount = formatMinor(item.amount_minor, item.currency);
  const [verb] = splitHeadline(item.headline, amount);
  const left = timeLeft(item.deadline, now);
  const who = item.counterparty ? houseWords(item.counterparty) : null;
  const { head } = silenceParts(item.on_silence);
  const style = { position: 'absolute', left: 0, right: 0, top, height: WAITING_ROW, '--c': MODULE[item.module].cssVar } as CSSProperties;
  return (
    <div role="listitem" style={style} className="cs-wrow-wrap">
      <button type="button" {...props} className="cs-wrow" onClick={() => onPick(item.deal_id)} data-fk={`w-${item.deal_id}`}>
        <span className="dot" aria-hidden="true" />
        <span className="t">
          <b>{verb} <span className="amt">{amount}</span></b>
          <span>{[who, disp ? shortTitle(disp.title) : null].filter(Boolean).join(' · ')}</span>
          <span className="sil">{IF_NOTHING}: {head}</span>
        </span>
        <span className="m">{MODULE[item.module].name}</span>
        <span className={`when ${left?.urgent ? 'now' : ''}`}>{left ? left.text : ''}</span>
      </button>
    </div>
  );
}

function DecidedLately({ decided, onDeal, who }: { decided: readonly Deal[]; onDeal: (id: string) => void; who: (d: Deal) => string }) {
  const strip: LatestProps = {
    title: LATEST_OF.decided, total: decided.length,
    rows: decided.slice(0, MAX_ROWS).map((d) => ({ key: d.id, label: `${decidedBy(d).text}, ${OPEN_THE_DEAL}`, onOpen: () => onDeal(d.id), node: <DealRow deal={d} who={who(d)} extra={decidedBy(d).text} /> })),
  };
  return <Reveal wave={2} sizeKey="waiting:decided" skeleton={<LatestSkeleton {...strip} />}><Latest {...strip} /></Reveal>;
}

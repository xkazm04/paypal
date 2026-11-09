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
import { useClock } from '../../../lib/hooks';
import { useRowMotion } from '../../../design/presets';
import { EVERY_MODULE, houseWords, IF_NOTHING, LATEST_OF, NO_DEADLINE, OPEN_THE_DEAL, WAITING_COLS, WAITING_EMPTY, WAITING_FILTER, WAITING_KICKER, WAITING_TITLE, waitingShown, waitingSub, waitingTitle } from '../../../lib/words';
import { MODULE, MODULES } from '../../../shared/modules';
import { ListShell, type FilterOption } from '../../../shared/ui';
import { shortTitle, silenceShort, timeLeft } from '../home/model';
import { decidedBy, splitHeadline } from '../logic';
import { useCpLookup } from '../ui';
import { useDeals, useDisplayOf, useWorldSelector, type World } from '../world';
import { Latest, LatestSkeleton, MAX_ROWS, type LatestProps } from './Latest';
import { DealRow1 } from './rows';
import { Reveal as Rise, RevealGroup } from '../../../design/Reveal';
import { Staged } from './stagger';

const selModuleOf = (w: World) => w.moduleOfDeal;
/** At or under this many waiting rows the list takes its own height (and the decided strip shows). */
const SHORT_LIST = 8;

/** A waiting row's height in px (fixed: who over what, beside one line per column). */
export const WAITING_ROW = 50;

type Filter = Module | 'all';
const keyOf = (n: AttentionItem): string => n.deal_id;

export function Waiting({ queue, module, onFilter, onPick, onDeal }: {
  queue: readonly AttentionItem[]; module: Module | undefined; onFilter: (m: Module | undefined) => void; onPick: (dealId: string) => void;
  /** Opens a deal (the "decided lately" strip under a short list). */
  onDeal?: (dealId: string) => void;
}) {
  const rows = useMemo(() => (module ? queue.filter((n) => n.module === module) : queue), [queue, module]);
  const counts = new Map<Module, number>();
  for (const n of queue) counts.set(n.module, (counts.get(n.module) ?? 0) + 1);
  const options: FilterOption<Filter>[] = [
    { value: 'all', label: EVERY_MODULE, count: queue.length },
    ...MODULES.filter((m) => counts.has(m.key)).map((m) => ({ value: m.key as Filter, label: m.name, count: counts.get(m.key) ?? 0 })),
  ];
  // The first decision the owner can actually make: it alone carries the filled action.
  const firstCall = rows.find((n) => n.kind === 'gate')?.deal_id;
  // A decision joining or leaving while the list is in view (design/presets.ts): keyed by deal over the
  // whole queue, so the module filter and a scroll never play it; a decided row fades where it stood.
  const motion = useRowMotion(queue, rows, keyOf);
  const list = useWindowedRows({ rows: motion.rows, getKey: keyOf, estimateSize: WAITING_ROW });
  // A short list takes its own height, and what was decided lately fills the room under it (rebuild
  // WP4a: no dead band). A long list keeps the whole sheet.
  const moduleOfDeal = useWorldSelector(selModuleOf);
  const short = rows.length > 0 && rows.length <= SHORT_LIST;
  const deals = useDeals().data;
  const cp = useCpLookup();
  const decided = useMemo(() => (deals ?? []).filter((d) => !!d.decided_by && (!module || moduleOfDeal(d) === module))
    .sort((a, b) => (b.updated_at ?? b.created_at ?? 0) - (a.updated_at ?? a.created_at ?? 0)), [deals, module, moduleOfDeal]);
  return (
    <RevealGroup className={`cs-waiting${short ? ' short' : ''}`}>
      <Rise className="cs-lhead">
        <p className="kicker">{WAITING_KICKER}</p>
        <h1 className="display cs-title" tabIndex={-1} data-layer-title="">{queue.length ? waitingTitle(queue.length) : WAITING_TITLE}</h1>
        {queue.length ? <p className="cs-wsub">{waitingSub(queue.length)}</p> : null}
      </Rise>
      <ListShell label={WAITING_TITLE} className="cs-wlist"
        filters={options.length > 2 ? (
          <label className="le-sort">{WAITING_FILTER}
            <select value={module ?? 'all'} onChange={(e) => { const f = e.target.value as Filter; onFilter(f === 'all' ? undefined : f); }}>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label} · {o.count}</option>)}
            </select>
          </label>
        ) : undefined}
        summary={queue.length ? waitingShown(rows.length, queue.length, formatTally) : undefined}
        isEmpty={!rows.length} empty={WAITING_EMPTY}
        renderRows={() => (<>
          {/* Read per row through its accessible name, so the heads are for the eye only. */}
          <div className="cs-whead" aria-hidden="true"><span>{WAITING_COLS.who}</span><span className="r">{WAITING_COLS.amount}</span><span>{WAITING_COLS.left}</span><span>{IF_NOTHING}</span><span className="r">{WAITING_COLS.call}</span></div>
          <div ref={list.scrollRef} onKeyDown={list.onKeyDown} className="cs-wscroll" role="list" aria-label={WAITING_TITLE} style={short ? { flex: 'none', height: motion.rows.length * WAITING_ROW + 4 } : undefined}>
            <div style={{ height: list.totalSize, position: 'relative' }}>
              {list.items.map((it) => (
                <WaitingRow key={it.key} item={it.row} props={list.rowProps(it)} top={it.start} onPick={onPick} first={it.row.deal_id === firstCall}
                  motion={motion.cls(it.key)} gone={motion.leaving(it.key)} />
              ))}
            </div>
          </div>
        </>)} />
      {short && onDeal && decided.length ? (
        // The waiting list is the decisions themselves (wave 0); what was decided lately takes its turn.
        <DecidedLately decided={decided} onDeal={onDeal} who={(d) => cp(d.counterparty).name} />
      ) : null}
    </RevealGroup>
  );
}

function WaitingRow({ item, props, top, onPick, first, motion, gone }: {
  item: AttentionItem; props: RowProps; top: number; onPick: (id: string) => void; first: boolean;
  /** The row's preset class this render (arrived / left), or ''. */
  motion: string;
  /** The row has left the queue and is fading where it stood: drawn, inert, hidden from readers. */
  gone: boolean;
}) {
  // The clock through useClock: the row re-renders when its words change ("3 h left" once a minute),
  // never on the one-second tick.
  const leftText = useClock((now) => timeLeft(item.deadline, now)?.text ?? null);
  const urgent = useClock((now) => timeLeft(item.deadline, now)?.urgent ?? false);
  const disp = useDisplayOf(item.deal_id);
  const amount = formatMinor(item.amount_minor, item.currency);
  // The call beside the amount; a headline that carries a second figure ("Asked $339.00, not $329.00") stays whole.
  const [verb] = splitHeadline(item.headline, amount);
  const call = /\d/.test(verb) ? item.headline : verb;
  const left = leftText === null ? null : { text: leftText, urgent };
  const who = item.counterparty ? houseWords(item.counterparty) : null;
  const title = disp ? shortTitle(disp.title) : null;
  const say = `${[item.headline, who, title].filter(Boolean).join(', ')}. ${IF_NOTHING}: ${item.on_silence}. ${[left?.text, MODULE[item.module].name].filter(Boolean).join(', ')}`;
  const style = { position: 'absolute', left: 0, right: 0, top, height: WAITING_ROW, '--c': MODULE[item.module].cssVar } as CSSProperties;
  return (
    <div role="listitem" style={style} className="cs-wrow-wrap" aria-hidden={gone || undefined} inert={gone || undefined}>
      <button type="button" {...props} className={`cs-wrow${first ? ' first' : ''}${motion ? ` ${motion}` : ''}`} aria-label={say} onClick={() => onPick(item.deal_id)} data-fk={gone ? undefined : `w-${item.deal_id}`}>
        <span className="t">
          <b>{who ? who.split(' · ')[0] : title}</b>
          {who && title ? <span>{title}</span> : null}
        </span>
        <span className="amt">{amount}</span>
        <span className={`when ${left?.urgent ? 'now' : ''}${left ? '' : ' none'}`}>{left ? left.text : NO_DEADLINE}</span>
        <span className="sil">{silenceShort(item.on_silence)}</span>
        {/* A gate is a decision (a verb); a hold only opens, so it reads as the fact, not a button. */}
        <span className={`call ${item.kind === 'gate' ? 'gate' : 'hold'}`}>{call}</span>
      </button>
    </div>
  );
}

function DecidedLately({ decided, onDeal, who }: { decided: readonly Deal[]; onDeal: (id: string) => void; who: (d: Deal) => string }) {
  const strip: LatestProps = {
    title: LATEST_OF.decided, total: decided.length, rowGuess: 40,
    rows: decided.slice(0, MAX_ROWS).map((d) => ({ key: d.id, label: `${decidedBy(d).text}, ${OPEN_THE_DEAL}`, onOpen: () => onDeal(d.id), node: <DealRow1 deal={d} who={who(d)} note={decidedBy(d).text} /> })),
  };
  return <Staged wave={2} sizeKey="waiting:decided" skeleton={<LatestSkeleton {...strip} />}><Latest {...strip} /></Staged>;
}

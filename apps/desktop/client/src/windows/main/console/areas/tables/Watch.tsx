// The Tables layer's "Watch the haggle" view: the haggles on the left, the picked one replayed on the
// right as the corridor (Corridor.tsx). The beats are read from the wallet like everything else on
// the page: the signed transcript, the deal's Rewind steps (where the wallet refused the agent and
// where the owner said yes), the signed band, the deal's market record, the rules' ask-me line and,
// on a live table, the gate waiting for the owner. Nothing here moves money or opens anything.
import { useMemo, useState } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import { AGREED_OR_LATER } from '@bindings/dealStates';
import { useQuery } from '../../../../../lib/hooks';
import { TABLES_WATCH as W } from '../../../../../lib/words';
import { isLive } from '../../../logic';
import { haggleOf, watchable } from '../../../modules/tables/corridor';
import { takeWatched } from '../../../modules/tables/watchPick';
import type { World } from '../../../world';
import { ListEngine } from '../../ListEngine';
import { StateChip, WhoChip } from '../../rows';
import { Btn } from '../../../../../shared/ui';
import { Corridor } from './Corridor';
import { SplitView, useTranscript } from './parts';

/** Haggles in watching order: the fullest finished haggles first (most offers signed, then newest),
 *  then the live tables, newest first. */
export function watchOrder(deals: readonly Deal[], display: World['display']): Deal[] {
  const rounds = (d: Deal) => display(d).band?.rounds_used ?? 0;
  const done = (d: Deal) => AGREED_OR_LATER.has(d.state);
  return deals
    .filter((d) => d.kind === 'haggle')
    .sort((a, b) => Number(done(b)) - Number(done(a)) || (done(a) ? rounds(b) - rounds(a) : 0) || (b.updated_at ?? 0) - (a.updated_at ?? 0) || a.id.localeCompare(b.id));
}

type Props = {
  deals: readonly Deal[];
  display: World['display'];
  needOf: ReadonlyMap<string, AttentionItem>;
  who: (d: Deal) => { short: string; full: string };
};

export function WatchView({ deals, display, needOf, who }: Props) {
  const rows = useMemo(() => watchOrder(deals, display), [deals, display]);
  const [k, setK] = useState<string | null>(takeWatched);
  const [stage, setStage] = useState(false);
  const picked = (k !== null ? rows.find((d) => d.id === k) : undefined) ?? rows[0];
  const list = (
    <ListEngine<Deal> label={W.list} rows={rows} getKey={(d) => d.id} estimateSize={60} measure
      searchText={(d) => `${display(d).title} ${who(d).full}`}
      renderRow={(d) => (
        <span className={`tr-row${picked?.id === d.id ? ' picked' : ''}`}>
          <span className="dot" aria-hidden="true" />
          <span className="t"><b title={display(d).title}>{display(d).title}</b><span className="sub"><WhoChip name={who(d).short} /></span></span>
          <span className="tr-end"><StateChip deal={d} /></span>
        </span>
      )}
      rowLabel={(d) => `${display(d).title}, ${who(d).full}`} onPick={(d) => setK(d.id)} onOpen={(d) => setK(d.id)} empty={W.empty} />
  );
  const pane = picked ? <WatchPane key={picked.id} deal={picked} display={display} need={needOf.get(picked.id)} who={who(picked).short} stage={stage} onStage={setStage} /> : null;
  if (stage && pane) return <div className="hc-stage">{pane}</div>;
  return <SplitView label={W.list} count={rows.length} list={list} pane={pane} />;
}

function WatchPane({ deal, display, need, who, stage, onStage }: { deal: Deal; display: World['display']; need: AttentionItem | undefined; who: string; stage: boolean; onStage: (on: boolean) => void }) {
  const tr = useTranscript(deal.id);
  const hist = useQuery('deal_history', { deal_id: deal.id }, { refreshOn: ['deal:changed'] });
  const mandates = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  const band = display(deal).band;
  const askAbove = useMemo(() => {
    const entry = mandates.data?.find((m) => m.payload.id === deal.mandate_id && m.payload.version === deal.mandate_version);
    const c = entry?.payload.clauses.find((x) => x.type === 'human_present_over');
    return c && c.type === 'human_present_over' ? c.amount.minor : null;
  }, [mandates.data, deal.mandate_id, deal.mandate_version]);
  const haggle = useMemo(() => tr.data ? haggleOf({
    currency: deal.terms.currency, side: deal.side, transcript: tr.data, history: hist.data?.steps ?? null,
    ceiling: band?.ceiling?.minor ?? null, floor: band?.floor?.minor ?? null, maxOffers: band?.max_rounds ?? null, askAbove,
    market: deal.market ? { p25: deal.market.p25.minor, median: deal.market.median.minor, p75: deal.market.p75.minor } : null,
    gate: isLive(deal) && need?.kind === 'gate' ? { clause: need.clause?.number ?? null, price: deal.terms.unit_price.minor } : null,
  }) : null, [tr.data, hist.data, deal, band, askAbove, need]);
  if (!haggle || (hist.loading && !hist.data)) return <p className="le-empty">{W.reading}</p>;
  if (!watchable(haggle)) return <p className="le-empty">{W.empty}</p>;
  return (
    <div className="tb-pane">
      <header className="tr-phead">
        <h2 title={display(deal).title}>{display(deal).title}</h2>
        <span className="tr-with">{who}</span>
        <span className="ui-spacer" />
        <Btn sm kind="plain" onClick={() => onStage(!stage)} title={stage ? W.listTitle : W.stageTitle}>{stage ? W.list : W.stage}</Btn>
      </header>
      <p className="tb-left">{W.sub}</p>
      <Corridor haggle={haggle} who={who} big={stage} />
    </div>
  );
}

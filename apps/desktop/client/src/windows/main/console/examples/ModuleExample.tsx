// A worked example of the framework for the WP3 builders (browser preview only: the main window
// shows it in place of a module's old page when the preview URL carries `?framework-example`, never
// in the shell). It builds a module layer from the World alone: ModuleLayer with its answer, Your
// call, four summary cards that open two nested views, an explanation, and a ListEngine of the
// module's deals drawn with the shared row parts. Copy the shape, not the words: each area writes
// its own words in lib/words/<area>.ts.
import { useMemo } from 'react';
import type { Deal } from '@bindings/Deal';
import type { Module } from '@bindings/Module';
import { formatCount } from '../../../../lib/data/counts';
import { EXAMPLE } from '../../../../lib/words';
import { silenceParts } from '../../home/model';
import { isLive, isSettled } from '../../logic';
import { useCpLookup } from '../../ui';
import { useDeals, useNeeds, useWorldSelector, type World } from '../../world';
import { useLayerNav, type LayerProps } from '../layers';
import { ListEngine, type ListFilter, type ListSort } from '../ListEngine';
import { ModuleLayer } from '../ModuleLayer';
import { defineModuleViews } from '../ModuleSummary';
import { DealRow } from '../rows';

/** The example's two detail views, registered for every module (keys are the `v=` in the hash). */
const VIEWS = { 'ex-all': EXAMPLE.allView, 'ex-waiting': EXAMPLE.waitingView } as const;
for (const m of ['tables', 'spend', 'counter', 'book', 'shield', 'rescue'] as const) defineModuleViews(m, VIEWS);

const FILTERS: readonly ListFilter<Deal>[] = [
  { value: 'live', label: EXAMPLE.live, test: isLive },
  { value: 'settled', label: EXAMPLE.settled, test: isSettled },
];
const SORTS: readonly ListSort<Deal>[] = [
  { value: 'newest', label: EXAMPLE.newest, compare: (a, b) => (b.updated_at ?? b.created_at ?? 0) - (a.updated_at ?? a.created_at ?? 0) },
  { value: 'largest', label: EXAMPLE.largest, compare: (a, b) => b.terms.unit_price.minor * b.terms.qty - a.terms.unit_price.minor * a.terms.qty },
];

const selModuleOf = (w: World) => w.moduleOfDeal;
const selDisplay = (w: World) => w.display;

function DealList({ deals, label }: { deals: readonly Deal[]; label: string }) {
  const nav = useLayerNav();
  const needs = useNeeds();
  const cp = useCpLookup();
  const display = useWorldSelector(selDisplay);
  const needOf = useMemo(() => new Map(needs.map((n) => [n.deal_id, n] as const)), [needs]);
  return (
    <ListEngine<Deal> label={label} rows={deals} getKey={(d) => d.id} filters={FILTERS} sorts={SORTS} estimateSize={(d) => (needOf.has(d.id) ? 64 : 48)} measure
      searchText={(d) => `${display(d).title} ${cp(d.counterparty).name}`}
      renderRow={(d) => <DealRow deal={d} need={needOf.get(d.id)} who={cp(d.counterparty).name} />}
      rowLabel={(d) => display(d).title}
      onOpen={(d) => nav.deal(d.id)}
      detail={(d) => <DealRow deal={d} need={needOf.get(d.id)} who={cp(d.counterparty).name} />}
      empty={EXAMPLE.empty} />
  );
}

export function ModuleExample({ route }: LayerProps) {
  const module: Module = route.level === 'module' ? route.module : 'spend';
  const all = useDeals().data;
  const moduleOf = useWorldSelector(selModuleOf);
  const needs = useNeeds();
  const deals = useMemo(() => (all ?? []).filter((d) => module === 'book' || moduleOf(d) === module), [all, moduleOf, module]);
  const mine = needs.filter((n) => n.module === module);
  const waitingDeals = useMemo(() => { const ids = new Set(mine.map((n) => n.deal_id)); return deals.filter((d) => ids.has(d.id)); }, [deals, mine]);
  const first = mine[0];
  return (
    <ModuleLayer module={module} answer={EXAMPLE.answer(deals.length, mine.length)}
      cards={[
        { id: 'ex-waiting', view: 'ex-waiting', label: EXAMPLE.waitingView, value: formatCount(mine.length), ifNothing: first ? silenceParts(first.on_silence).head : null },
        { id: 'ex-live', view: 'ex-all', label: EXAMPLE.live, value: formatCount(deals.filter(isLive).length) },
        { id: 'ex-settled', view: 'ex-all', label: EXAMPLE.settled, value: formatCount(deals.filter(isSettled).length) },
        { id: 'ex-all', view: 'ex-all', label: EXAMPLE.allView, value: formatCount(deals.length) },
      ]}
      explain={{ summary: EXAMPLE.whyTitle, body: <p>{EXAMPLE.why}</p> }}
      views={{
        'ex-all': { title: EXAMPLE.allView, render: () => <DealList deals={deals} label={EXAMPLE.allView} /> },
        'ex-waiting': { title: EXAMPLE.waitingView, render: () => <DealList deals={waitingDeals} label={EXAMPLE.waitingView} /> },
      }}>
      <DealList deals={deals} label={EXAMPLE.allView} />
    </ModuleLayer>
  );
}

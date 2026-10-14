// Area: counter (rebuild WP3a). The Counter layer: console/areas/counter/CounterLayer.tsx, built on
// the framework (console/ModuleLayer.tsx, console/ListEngine.tsx, console/rows.tsx; guide:
// docs/build/rebuild/wp25.md). This file, the area's stylesheet (console/areas/counter.css), its words
// (lib/words/counter.ts) and everything under console/areas/counter/ belong to this area. The detail
// views are registered here (keys of the old links, #m=counter&v=...). tables.css carries the parts
// the three trade areas share (.tr-*).
import { lazyPart } from '../../../../lib/lazy';
import { COUNTER_VIEWS } from '../../../../lib/words';
import { MODULE } from '../../../../shared/modules';
import { ModuleCrumb } from '../crumbs';
import { defineLayer, type LayerProps } from '../layers';
import { defineModuleViews } from '../ModuleSummary';
import '../areas/tables.css';
import '../areas/counter.css';

export const COUNTER_VIEW_LABELS = defineModuleViews('counter', COUNTER_VIEWS);

export const layers = [
  defineLayer({
    id: 'counter',
    title: () => MODULE.counter.name,
    Crumb: ModuleCrumb,
    component: lazyPart<LayerProps>(() => import('../areas/counter/CounterLayer').then((m) => m.CounterLayer)),
  }),
];

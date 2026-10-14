// Area: counter (rebuild WP3). TODO(WP3 counter): the builder who owns this area replaces the interim
// body below (the old modules/counter.tsx page) with the new page, built on the framework (console/ModuleLayer.tsx,
// console/ListEngine.tsx, console/rows.tsx; guide: docs/build/rebuild/wp25.md). This file, the
// area's stylesheet (console/areas/counter.css), its words (lib/words/counter.ts) and anything new under
// console/areas/counter/ belong to that builder alone; the registry (console/layers.registry.ts)
// already imports this file.
import { lazyPart } from '../../../../lib/lazy';
import { MODULE } from '../../../../shared/modules';
import { ModuleCrumb } from '../crumbs';
import { defineLayer, type LayerProps } from '../layers';
import '../areas/counter.css';

export const layers = [
  defineLayer({
    id: 'counter',
    title: () => MODULE.counter.name,
    Crumb: ModuleCrumb,
    component: lazyPart<LayerProps>(() => import('../legacy').then((m) => m.LegacyModuleLayer)),
  }),
];

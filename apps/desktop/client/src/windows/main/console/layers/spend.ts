// Area: spend (rebuild WP3). TODO(WP3 spend): the builder who owns this area replaces the interim
// body below (the old modules/spend.tsx page) with the new page, built on the framework (console/ModuleLayer.tsx,
// console/ListEngine.tsx, console/rows.tsx; guide: docs/build/rebuild/wp25.md). This file, the
// area's stylesheet (console/areas/spend.css), its words (lib/words/spend.ts) and anything new under
// console/areas/spend/ belong to that builder alone; the registry (console/layers.registry.ts)
// already imports this file.
import { lazyPart } from '../../../../lib/lazy';
import { MODULE } from '../../../../shared/modules';
import { ModuleCrumb } from '../crumbs';
import { defineLayer, type LayerProps } from '../layers';
import '../areas/spend.css';

export const layers = [
  defineLayer({
    id: 'spend',
    title: () => MODULE.spend.name,
    Crumb: ModuleCrumb,
    component: lazyPart<LayerProps>(() => import('../legacy').then((m) => m.LegacyModuleLayer)),
  }),
];

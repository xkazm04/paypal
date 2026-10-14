// Area: shield (rebuild WP3). TODO(WP3 shield): the builder who owns this area replaces the interim
// body below (the old modules/shield.tsx page) with the new page, built on the framework (console/ModuleLayer.tsx,
// console/ListEngine.tsx, console/rows.tsx; guide: docs/build/rebuild/wp25.md). This file, the
// area's stylesheet (console/areas/shield.css), its words (lib/words/shield.ts) and anything new under
// console/areas/shield/ belong to that builder alone; the registry (console/layers.registry.ts)
// already imports this file.
import { lazyPart } from '../../../../lib/lazy';
import { MODULE } from '../../../../shared/modules';
import { ModuleCrumb } from '../crumbs';
import { defineLayer, type LayerProps } from '../layers';
import '../areas/shield.css';

export const layers = [
  defineLayer({
    id: 'shield',
    title: () => MODULE.shield.name,
    Crumb: ModuleCrumb,
    component: lazyPart<LayerProps>(() => import('../legacy').then((m) => m.LegacyModuleLayer)),
  }),
];

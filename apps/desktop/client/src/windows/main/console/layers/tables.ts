// Area: tables (rebuild WP3). TODO(WP3 tables): the builder who owns this area replaces the interim
// body below (the old modules/tables.tsx page) with the new page, built on the framework (console/ModuleLayer.tsx,
// console/ListEngine.tsx, console/rows.tsx; guide: docs/build/rebuild/wp25.md). This file, the
// area's stylesheet (console/areas/tables.css), its words (lib/words/tables.ts) and anything new under
// console/areas/tables/ belong to that builder alone; the registry (console/layers.registry.ts)
// already imports this file.
import { lazyPart } from '../../../../lib/lazy';
import { MODULE } from '../../../../shared/modules';
import { ModuleCrumb } from '../crumbs';
import { defineLayer, type LayerProps } from '../layers';
import '../areas/tables.css';

export const layers = [
  defineLayer({
    id: 'tables',
    title: () => MODULE.tables.name,
    Crumb: ModuleCrumb,
    component: lazyPart<LayerProps>(() => import('../legacy').then((m) => m.LegacyModuleLayer)),
  }),
];

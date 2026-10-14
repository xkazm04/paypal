// Area: rescue (rebuild WP3). TODO(WP3 rescue): the builder who owns this area replaces the interim
// body below (the old modules/rescue.tsx page) with the new page, built on the framework (console/ModuleLayer.tsx,
// console/ListEngine.tsx, console/rows.tsx; guide: docs/build/rebuild/wp25.md). This file, the
// area's stylesheet (console/areas/rescue.css), its words (lib/words/rescue.ts) and anything new under
// console/areas/rescue/ belong to that builder alone; the registry (console/layers.registry.ts)
// already imports this file.
import { lazyPart } from '../../../../lib/lazy';
import { MODULE } from '../../../../shared/modules';
import { ModuleCrumb } from '../crumbs';
import { defineLayer, type LayerProps } from '../layers';
import '../areas/rescue.css';

export const layers = [
  defineLayer({
    id: 'rescue',
    title: () => MODULE.rescue.name,
    Crumb: ModuleCrumb,
    component: lazyPart<LayerProps>(() => import('../legacy').then((m) => m.LegacyModuleLayer)),
  }),
];

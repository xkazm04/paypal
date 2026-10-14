// Area: setup (rebuild WP3). TODO(WP3 setup): the builder who owns this area replaces the interim
// body below (the WP2 Charter as a layer) with the new page, built on the framework (console/ModuleLayer.tsx,
// console/ListEngine.tsx, console/rows.tsx; guide: docs/build/rebuild/wp25.md). This file, the
// area's stylesheet (console/areas/setup.css), its words (lib/words/setup.ts) and anything new under
// console/areas/setup/ belong to that builder alone; the registry (console/layers.registry.ts)
// already imports this file.
import { lazyPart } from '../../../../lib/lazy';
import { SETUP_PAGE_TITLE } from '../../../../lib/words';
import { defineLayer, type LayerProps } from '../layers';
import '../areas/setup.css';

export const layers = [
  defineLayer({ id: 'setup', title: () => SETUP_PAGE_TITLE, ownSeal: true, component: lazyPart<LayerProps>(() => import('../legacy').then((m) => m.LegacySetupLayer)) }),
];

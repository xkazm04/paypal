// Area: safety (rebuild WP3). TODO(WP3 safety): the builder who owns this area replaces the interim
// body below (the old safety record view) with the new page, built on the framework (console/ModuleLayer.tsx,
// console/ListEngine.tsx, console/rows.tsx; guide: docs/build/rebuild/wp25.md). This file, the
// area's stylesheet (console/areas/safety.css), its words (lib/words/safety.ts) and anything new under
// console/areas/safety/ belong to that builder alone; the registry (console/layers.registry.ts)
// already imports this file.
import { lazyPart } from '../../../../lib/lazy';
import { PLACE_NAME } from '../../../../lib/words';
import { defineLayer, type LayerProps } from '../layers';
import '../areas/safety.css';

export const layers = [
  defineLayer({ id: 'safety', title: () => PLACE_NAME.safety, tone: 'var(--teal)', component: lazyPart<LayerProps>(() => import('../legacy').then((m) => m.LegacySafetyLayer)) }),
];

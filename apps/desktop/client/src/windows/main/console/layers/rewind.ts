// Area: rewind (rebuild WP3). TODO(WP3 rewind): the builder who owns this area replaces the interim
// body below (the WP2 RewindLayer) with the new page, built on the framework (console/ModuleLayer.tsx,
// console/ListEngine.tsx, console/rows.tsx; guide: docs/build/rebuild/wp25.md). This file, the
// area's stylesheet (console/areas/rewind.css), its words (lib/words/rewind.ts) and anything new under
// console/areas/rewind/ belong to that builder alone; the registry (console/layers.registry.ts)
// already imports this file.
import { lazyPart } from '../../../../lib/lazy';
import { REWIND_TITLE } from '../../../../lib/words';
import { defineLayer, type LayerProps } from '../layers';
import '../areas/rewind.css';

export const layers = [
  defineLayer({ id: 'rewind', title: () => REWIND_TITLE, tone: 'var(--teal)', component: lazyPart<LayerProps>(() => import('../legacy').then((m) => m.LegacyRewindLayer)) }),
];

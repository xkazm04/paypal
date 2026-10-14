// Area: rules (rebuild WP3). TODO(WP3 rules): the builder who owns this area replaces the interim
// body below (the old Agent rules list and an interim wallet-limits page) with the new page, built on the framework (console/ModuleLayer.tsx,
// console/ListEngine.tsx, console/rows.tsx; guide: docs/build/rebuild/wp25.md). This file, the
// area's stylesheet (console/areas/rules.css), its words (lib/words/rules.ts) and anything new under
// console/areas/rules/ belong to that builder alone; the registry (console/layers.registry.ts)
// already imports this file.
import { lazyPart } from '../../../../lib/lazy';
import { PLACE_NAME } from '../../../../lib/words';
import { defineLayer, type LayerProps } from '../layers';
import '../areas/rules.css';

export const layers = [
  defineLayer({ id: 'rules', title: () => PLACE_NAME.rules, tone: 'var(--gold)', component: lazyPart<LayerProps>(() => import('../legacy').then((m) => m.LegacyRulesLayer)) }),
  defineLayer({ id: 'limits', title: () => PLACE_NAME.limits, tone: 'var(--gold)', component: lazyPart<LayerProps>(() => import('../legacy').then((m) => m.LegacyLimitsLayer)) }),
];

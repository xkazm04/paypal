// Area: deal (rebuild WP3). TODO(WP3 deal): the builder who owns this area replaces the interim
// body below (the old DealView) with the new page, built on the framework (console/ModuleLayer.tsx,
// console/ListEngine.tsx, console/rows.tsx; guide: docs/build/rebuild/wp25.md). This file, the
// area's stylesheet (console/areas/deal.css), its words (lib/words/deal.ts) and anything new under
// console/areas/deal/ belong to that builder alone; the registry (console/layers.registry.ts)
// already imports this file.
import { lazyPart } from '../../../../lib/lazy';
import { DEAL_CRUMB } from '../../../../lib/words';
import { DealCrumb } from '../crumbs';
import { defineLayer, type LayerProps } from '../layers';
import '../areas/deal.css';

export const layers = [
  defineLayer({ id: 'deal', title: () => DEAL_CRUMB, Crumb: DealCrumb, component: lazyPart<LayerProps>(() => import('../legacy').then((m) => m.LegacyDealLayer)) }),
];

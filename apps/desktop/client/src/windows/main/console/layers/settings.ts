// Area: settings (rebuild WP3). TODO(WP3 settings): the builder who owns this area replaces the interim
// body below (the old Settings checklist (the Circuit)) with the new page, built on the framework (console/ModuleLayer.tsx,
// console/ListEngine.tsx, console/rows.tsx; guide: docs/build/rebuild/wp25.md). This file, the
// area's stylesheet (console/areas/settings.css), its words (lib/words/settings.ts) and anything new under
// console/areas/settings/ belong to that builder alone; the registry (console/layers.registry.ts)
// already imports this file.
import { lazyPart } from '../../../../lib/lazy';
import { PLACE_NAME } from '../../../../lib/words';
import { defineLayer, type LayerProps } from '../layers';
import '../areas/settings.css';

export const layers = [
  defineLayer({ id: 'settings', title: () => PLACE_NAME.settings, component: lazyPart<LayerProps>(() => import('../legacy').then((m) => m.LegacySettingsLayer)) }),
];

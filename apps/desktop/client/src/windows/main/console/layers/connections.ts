// Area: connections (rebuild WP3). TODO(WP3 connections): the builder who owns this area replaces the interim
// body below (the old pairing desk, for both layers) with the new page, built on the framework (console/ModuleLayer.tsx,
// console/ListEngine.tsx, console/rows.tsx; guide: docs/build/rebuild/wp25.md). This file, the
// area's stylesheet (console/areas/connections.css), its words (lib/words/connections.ts) and anything new under
// console/areas/connections/ belong to that builder alone; the registry (console/layers.registry.ts)
// already imports this file.
import { lazyPart } from '../../../../lib/lazy';
import { PLACE_NAME } from '../../../../lib/words';
import { defineLayer, type LayerProps } from '../layers';
import '../areas/connections.css';

const desk = lazyPart<LayerProps>(() => import('../legacy').then((m) => m.LegacyConnectionsLayer));
export const layers = [
  defineLayer({ id: 'connections', title: () => PLACE_NAME.connections, component: desk }),
  defineLayer({ id: 'pairing', title: () => PLACE_NAME.pairing, component: desk }),
];

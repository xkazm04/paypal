// Area: connections (rebuild WP3c). Connections (PayPal, the agent app, the house seller, who you deal with) and the pairing desk.
// Built on the framework (console/layers.tsx, console/ListEngine.tsx, console/rows.tsx) and the
// owner places' shared frame (console/areas/settings/frame.tsx); guide: docs/build/rebuild/wp3c.md.
// This file, console/areas/connections.css, lib/words/connections.ts and console/areas/connections/ are the area's.
import { lazyPart } from '../../../../lib/lazy';
import { PLACE_NAME } from '../../../../lib/words';
import { defineLayer, type LayerProps } from '../layers';
import '../areas/connections.css';

const page = lazyPart<LayerProps>(() => import('../areas/connections/ConnectionsLayer').then((m) => m.ConnectionsLayer));
export const layers = [
  defineLayer({ id: 'connections', title: () => PLACE_NAME.connections, tone: 'var(--teal)', component: page }),
  defineLayer({ id: 'pairing', title: () => PLACE_NAME.pairing, tone: 'var(--teal)', component: page }),
];

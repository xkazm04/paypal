// Area: settings (rebuild WP3c). Settings: the lock, your agents, appearance, notifications, the charter, quit.
// Built on the framework (console/layers.tsx, console/ListEngine.tsx, console/rows.tsx) and the
// owner places' shared frame (console/areas/settings/frame.tsx); guide: docs/build/rebuild/wp3c.md.
// This file, console/areas/settings.css, lib/words/settings.ts and console/areas/settings/ are the area's.
import { lazyPart } from '../../../../lib/lazy';
import { PLACE_NAME, SETTINGS_CARD } from '../../../../lib/words';
import { defineLayer, type LayerProps } from '../layers';
import '../areas/settings.css';

export const layers = [
  defineLayer({ id: 'settings', title: () => PLACE_NAME.settings, views: { approving: SETTINGS_CARD.approving, agents: SETTINGS_CARD.agents, look: SETTINGS_CARD.appearance, notify: SETTINGS_CARD.notify }, component: lazyPart<LayerProps>(() => import('../areas/settings/SettingsLayer').then((m) => m.SettingsLayer)) }),
];

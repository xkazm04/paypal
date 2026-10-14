// Area: safety (rebuild WP3c). Your safety record: the verdict, findings, who decided, refusals, the record itself.
// Built on the framework (console/layers.tsx, console/ListEngine.tsx, console/rows.tsx) and the
// owner places' shared frame (console/areas/settings/frame.tsx); guide: docs/build/rebuild/wp3c.md.
// This file, console/areas/safety.css, lib/words/safety.ts and console/areas/safety/ are the area's.
import { lazyPart } from '../../../../lib/lazy';
import { PLACE_NAME, SAFETY_CARD } from '../../../../lib/words';
import { defineLayer, type LayerProps } from '../layers';
import '../areas/safety.css';

export const layers = [
  defineLayer({ id: 'safety', title: () => PLACE_NAME.safety, tone: 'var(--teal)', views: { records: SAFETY_CARD.records, refused: SAFETY_CARD.refused }, component: lazyPart<LayerProps>(() => import('../areas/safety/SafetyLayer').then((m) => m.SafetyLayer)) }),
];

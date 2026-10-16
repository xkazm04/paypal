// Area: rules (rebuild WP3c). Agent rules (the signed rule sets, scale finding #15) and the wallet limits.
// Built on the framework (console/layers.tsx, console/ListEngine.tsx, console/rows.tsx) and the
// owner places' shared frame (console/areas/settings/frame.tsx); guide: docs/build/rebuild/wp3c.md.
// This file, console/areas/rules.css, lib/words/rules.ts and console/areas/rules/ are the area's.
import { lazyPart } from '../../../../lib/lazy';
import { PLACE_NAME } from '../../../../lib/words';
import { defineLayer, type LayerProps } from '../layers';
import '../areas/rules.css';

const page = lazyPart<LayerProps>(() => import('../areas/rules/RulesLayer').then((m) => m.RulesLayer));
export const layers = [
  defineLayer({ id: 'rules', title: () => PLACE_NAME.rules, tone: 'var(--gold)', component: page }),
  defineLayer({ id: 'limits', title: () => PLACE_NAME.limits, tone: 'var(--gold)', component: page }),
];

// Area: shield (rebuild WP3b). The Shield layer: scam checks and holds
// (console/areas/shield/ShieldLayer.tsx). Its views are registered here, so the crumbs and Escape
// know them before the layer's chunk loads. Styles: console/areas/shield.css; words: lib/words/shield.ts.
import { lazyPart } from '../../../../lib/lazy';
import { SHIELD_VIEWS_TITLE } from '../../../../lib/words';
import { MODULE } from '../../../../shared/modules';
import { ModuleCrumb } from '../crumbs';
import { defineLayer, type LayerProps } from '../layers';
import { defineModuleViews } from '../ModuleSummary';
import '../areas/shield.css';

export const SHIELD_VIEWS = defineModuleViews('shield', SHIELD_VIEWS_TITLE);

export const layers = [
  defineLayer({
    id: 'shield',
    title: () => MODULE.shield.name,
    Crumb: ModuleCrumb,
    component: lazyPart<LayerProps>(() => import('../areas/shield/ShieldLayer').then((m) => m.ShieldLayer)),
  }),
];

// Area: rescue (rebuild WP3b). The Rescue layer: failed renewals, one fix for one subscriber, or
// nothing (console/areas/rescue/RescueLayer.tsx). Its views are registered here, so the crumbs and
// Escape know them before the layer's chunk loads. Styles: console/areas/rescue.css; words:
// lib/words/rescue.ts.
import { lazyPart } from '../../../../lib/lazy';
import { RESCUE_VIEWS_TITLE } from '../../../../lib/words';
import { MODULE } from '../../../../shared/modules';
import { ModuleCrumb } from '../crumbs';
import { defineLayer, type LayerProps } from '../layers';
import { defineModuleViews } from '../ModuleSummary';
import '../areas/rescue.css';

export const RESCUE_VIEWS = defineModuleViews('rescue', RESCUE_VIEWS_TITLE);

export const layers = [
  defineLayer({
    id: 'rescue',
    title: () => MODULE.rescue.name,
    Crumb: ModuleCrumb,
    component: lazyPart<LayerProps>(() => import('../areas/rescue/RescueLayer').then((m) => m.RescueLayer)),
  }),
];

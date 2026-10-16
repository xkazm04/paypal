// Area: spend (rebuild WP3a). The Spend layer: console/areas/spend/SpendLayer.tsx, built on the
// framework (console/ModuleLayer.tsx, console/ListEngine.tsx, console/rows.tsx; guide:
// docs/build/rebuild/wp25.md). This file, the area's stylesheet (console/areas/spend.css), its words
// (lib/words/spend.ts) and everything under console/areas/spend/ belong to this area. The detail
// views are registered here (keys of the old links, #m=spend&v=...). tables.css carries the parts the
// three trade areas share (.tr-*).
import { lazyPart } from '../../../../lib/lazy';
import { SPEND_VIEWS } from '../../../../lib/words';
import { MODULE } from '../../../../shared/modules';
import { ModuleCrumb } from '../crumbs';
import { defineLayer, type LayerProps } from '../layers';
import { defineModuleViews } from '../ModuleSummary';
import '../areas/tables.css';
import '../areas/spend.css';

export const SPEND_VIEW_LABELS = defineModuleViews('spend', SPEND_VIEWS);

export const layers = [
  defineLayer({
    id: 'spend',
    title: () => MODULE.spend.name,
    Crumb: ModuleCrumb,
    component: lazyPart<LayerProps>(() => import('../areas/spend/SpendLayer').then((m) => m.SpendLayer)),
  }),
];

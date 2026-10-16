// Area: tables (rebuild WP3a). The Tables layer: console/areas/tables/TablesLayer.tsx, built on the
// framework (console/ModuleLayer.tsx, console/ListEngine.tsx, console/rows.tsx; guide:
// docs/build/rebuild/wp25.md). This file, the area's stylesheet (console/areas/tables.css), its words
// (lib/words/tables.ts) and everything under console/areas/tables/ belong to this area; the registry
// (console/layers.registry.ts) imports this file. The detail views are registered here, so the crumbs
// and Escape know them before the chunk loads; the keys are those of the old links (#m=tables&v=...).
import { lazyPart } from '../../../../lib/lazy';
import { TABLES_VIEWS } from '../../../../lib/words';
import { MODULE } from '../../../../shared/modules';
import { ModuleCrumb } from '../crumbs';
import { defineLayer, type LayerProps } from '../layers';
import { defineModuleViews } from '../ModuleSummary';
import '../areas/tables.css';

export const TABLES_VIEW_LABELS = defineModuleViews('tables', TABLES_VIEWS);

export const layers = [
  defineLayer({
    id: 'tables',
    title: () => MODULE.tables.name,
    Crumb: ModuleCrumb,
    component: lazyPart<LayerProps>(() => import('../areas/tables/TablesLayer').then((m) => m.TablesLayer)),
  }),
];

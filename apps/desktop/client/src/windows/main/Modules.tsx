// Layer 1 - the six modules. This file only dispatches: each module page lives in
// modules/<name>.tsx (+ modules/<name>.css) and owns its head and body; shared pieces are in
// modules/common.tsx. The root element carries `module mod-<name>` and the module colour (--mc),
// so module CSS can scope every rule under `.mod-<name>`.
//
// Each module page is its own chunk (lib/lazy.ts): Home is the first paint, so the six pages load
// after it, while the window is idle. Their stylesheets stay eager, imported here in page order.
import { Suspense, type ReactNode } from 'react';
import type { Module } from '@bindings/Module';
import { WalletNotice } from '../../shared/honesty';
import { Glyph, MODULE } from '../../shared/modules';
import { PageHead } from '../../shared/ui';
import { ModuleHead, type Nav } from './modules/common';
import { Loading, mc } from './ui';
import { ModuleRouteContext, viewLabel, type ModuleRoute } from './viewNav';
import { useWorld } from './world';

/** The module pages, for the window's idle preload (App.tsx). Every module is a console layer now
 *  (console/layers/<area>.ts); none is left here (rebuild WP3). */
export const MODULE_PAGES = [] as const;

// DealView imports BandCard from here; keep the path working.
export { BandCard } from './modules/common';
export type { Nav } from './modules/common';

/** `route` carries the open detail view and how to change it (read by modules through useModuleRoute). */
export function ModuleView({ module, route }: { module: Module; nav: Nav; route?: ModuleRoute }) {
  const w = useWorld();
  const all = w.deals.data;
  let body: ReactNode;
  if (w.deals.error && !all) body = <><ModuleHead module={module} /><WalletNotice error={w.deals.error} what="Ledger" /></>;
  else if (!all) body = <><ModuleHead module={module} /><Loading what="the ledger" /></>;
  else body = <ModuleHead module={module} />;
  // While a page's chunk loads (only if it is opened before the idle preload finished), the page
  // shows its title where the page will put it and a calm loading line.
  const waiting = <><PageHead title={MODULE[module].name} icon={<Glyph module={module} />} /><Loading what="this page" /></>;
  return (
    <div className={`module mod-${module}`} style={mc(module)}>
      <ModuleRouteContext.Provider value={route ? { ...route, view: viewLabel(module, route.view) ? route.view : null } : { view: null, open: () => {} }}>
        <Suspense fallback={waiting}>{body}</Suspense>
      </ModuleRouteContext.Provider>
    </div>
  );
}

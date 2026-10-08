// Layer 1 - the six modules. This file only dispatches: each module page lives in
// modules/<name>.tsx (+ modules/<name>.css) and owns its head and body; shared pieces are in
// modules/common.tsx. The root element carries `module mod-<name>` and the module colour (--mc),
// so module CSS can scope every rule under `.mod-<name>`.
//
// Each module page is its own chunk (lib/lazy.ts): Home is the first paint, so the six pages load
// after it, while the window is idle. Their stylesheets stay eager, imported here in page order.
import { Suspense, useMemo, type ReactNode } from 'react';
import type { Module } from '@bindings/Module';
import { WalletNotice } from '../../shared/honesty';
import { Glyph, MODULE } from '../../shared/modules';
import { PageHead } from '../../shared/ui';
import { lazyPart } from '../../lib/lazy';
import './modules/book.css';
import { ModuleHead, useSorted, type Nav } from './modules/common';
import './modules/counter.css';
import './modules/rescue.css';
import './modules/shield.css';
import './modules/spend.css';
import './modules/tables.css';
import { Loading, mc } from './ui';
import { useWorld } from './world';

const Book = lazyPart(() => import('./modules/book').then((m) => m.Book));
const Counter = lazyPart(() => import('./modules/counter').then((m) => m.Counter));
const Rescue = lazyPart(() => import('./modules/rescue').then((m) => m.Rescue));
const Shield = lazyPart(() => import('./modules/shield').then((m) => m.Shield));
const Spend = lazyPart(() => import('./modules/spend').then((m) => m.Spend));
const Tables = lazyPart(() => import('./modules/tables').then((m) => m.Tables));

/** The module pages, for the window's idle preload (App.tsx). */
export const MODULE_PAGES = [Tables, Spend, Counter, Book, Shield, Rescue] as const;

// DealView imports BandCard from here; keep the path working.
export { BandCard } from './modules/common';
export type { Nav } from './modules/common';

export function ModuleView({ module, nav }: { module: Module; nav: Nav }) {
  const w = useWorld();
  const all = w.deals.data;
  const mine = useMemo(() => (all ?? []).filter((d) => w.moduleOfDeal(d) === module), [all, w, module]);
  const sorted = useSorted(mine);
  let body: ReactNode;
  if (w.deals.error && !all) body = <><ModuleHead module={module} /><WalletNotice error={w.deals.error} what="Ledger" /></>;
  else if (!all) body = <><ModuleHead module={module} /><Loading what="the ledger" /></>;
  else {
    switch (module) {
      case 'tables': body = <Tables deals={sorted} nav={nav} />; break;
      case 'spend': body = <Spend deals={sorted} nav={nav} />; break;
      case 'counter': body = <Counter deals={sorted} nav={nav} />; break;
      case 'book': body = <Book nav={nav} />; break;
      case 'shield': body = <Shield deals={sorted} nav={nav} />; break;
      case 'rescue': body = <Rescue deals={sorted} nav={nav} />; break;
    }
  }
  // While a page's chunk loads (only if it is opened before the idle preload finished), the page
  // shows its title where the page will put it and a calm loading line.
  const waiting = <><PageHead title={MODULE[module].name} icon={<Glyph module={module} />} /><Loading what="this page" /></>;
  return (
    <div className={`module mod-${module}`} style={mc(module)}>
      <Suspense fallback={waiting}>{body}</Suspense>
    </div>
  );
}

// Layer 1 - the six modules. This file only dispatches: each module page lives in
// modules/<name>.tsx (+ modules/<name>.css) and owns its head and body; shared pieces are in
// modules/common.tsx. The root element carries `module mod-<name>` and the module colour (--mc),
// so module CSS can scope every rule under `.mod-<name>`.
import { useMemo, type ReactNode } from 'react';
import type { Module } from '@bindings/Module';
import { WalletNotice } from '../../shared/honesty';
import { Book } from './modules/book';
import { ModuleHead, useSorted, type Nav } from './modules/common';
import { Counter } from './modules/counter';
import { Rescue } from './modules/rescue';
import { Shield } from './modules/shield';
import { Spend } from './modules/spend';
import { Tables } from './modules/tables';
import { Loading, mc } from './ui';
import { useWorld } from './world';

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
  return (
    <div className={`module mod-${module}`} style={mc(module)}>
      {body}
    </div>
  );
}

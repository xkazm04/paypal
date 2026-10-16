// Crumbs that need a read: a module's detail view by its registered label, a deal by its name.
// A layer def's `Crumb` uses these (layers/<module>.ts, layers/deal.ts); a layer without one shows
// its `title`.
import { DEAL_CRUMB } from '../../../lib/words';
import { MODULE } from '../../../shared/modules';
import { shortTitle } from '../home/model';
import { resolveDealRef, type Route } from '../logic';
import { useViewLabel } from '../viewNav';
import { useDealLabels, useDeals, useDisplayOf } from '../world';

/** "Ledger" on a module's detail view, the module's name on its summary. */
export function ModuleCrumb({ route }: { route: Route }) {
  const m = route.level === 'module' ? route.module : 'book';
  const view = useViewLabel(m, route.level === 'module' ? route.view : undefined);
  return <>{view ?? MODULE[m].name}</>;
}

/** The deal's short title once it is read, "Deal" until then. */
export function DealCrumb({ route }: { route: Route }) {
  const deals = useDeals().data;
  const labels = useDealLabels();
  const id = route.level === 'deal' && deals ? resolveDealRef(route.deal, deals, labels)?.id : undefined;
  const disp = useDisplayOf(id);
  return <>{disp ? shortTitle(disp.title) : DEAL_CRUMB}</>;
}

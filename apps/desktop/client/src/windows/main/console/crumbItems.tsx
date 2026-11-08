// The crumb items of a chain of routes, built once: the top bar's trail (Console.tsx) and a module
// page's own breadcrumb row (ModuleLayer.tsx) draw the same items. A crumb goes to that layer; the
// one just above the current is the same as Back; the current one is not a link.
import { CHARTER_TITLE } from '../../../lib/words';
import { sheetViewOf, type Route } from '../logic';
import type { Crumb } from './CrumbTrail';
import { layerOf } from './layers.registry';

/** A crumb's label: the layer's own Crumb (a deal's name, a module view's label), else its title. */
export function CrumbLabel({ r, firstRun = false }: { r: Route; firstRun?: boolean }) {
  if (r.level === 'home' && firstRun) return <>{CHARTER_TITLE}</>;
  const def = layerOf(r);
  const v = sheetViewOf(r);
  const view = v ? def.views?.[v] : undefined;
  if (view) return <>{view}</>;
  const C = def.Crumb;
  return C ? <C route={r} /> : <>{def.title(r)}</>;
}

export function crumbItems(chain: readonly Route[], o: { firstRun?: boolean; back: () => void; go: (r: Route) => void }): Crumb[] {
  return chain.map((r, i) => ({ label: <CrumbLabel r={r} firstRun={o.firstRun} />, onClick: i === chain.length - 2 ? o.back : i < chain.length - 2 ? () => o.go(r) : undefined }));
}

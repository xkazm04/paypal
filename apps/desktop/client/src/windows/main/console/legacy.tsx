// Interim layer bodies (rebuild WP2.5): the existing pages, mounted as layers of the console until
// each WP3 area replaces its own. An area file under console/layers/ points its `component` here;
// the WP3 builder of that area points it at the new page instead (no edit to this file is needed,
// and none should be made: it is shared). The Director deletes this file once no area imports it.
//
// What moved here from the old Sheet and Safety sheet: Settings (the Circuit checklist), Connections
// and the pairing desk, Agent rules, and the safety record, each now a layer with a heading of its
// own (focus lands there going in; Back, Escape and the crumbs are the console's). Everything
// privileged still only hands off to the approval window (Handoff -> approval_open).
import { useMemo } from 'react';
import { lazyPart } from '../../../lib/lazy';
import { backend } from '../../../lib/runtime';
import { SEAL_RING, sealLabel } from '../../../lib/words';
import { Seal } from '../../../shared/brand';
import { placeOfSheet } from '../logic';
import { ModuleView } from '../Modules';
import { Charter } from '../setup/Charter';
import { useModuleRoute } from '../viewNav';
import type { LayerProps } from './layers';

/** The framework's worked example (console/examples), in the browser preview only. */
const ModuleExample = lazyPart<LayerProps>(() => import('./examples/ModuleExample').then((m) => m.ModuleExample));
const showExample = (): boolean => backend().kind === 'mock' && new URLSearchParams(location.search).has('framework-example');

/** A module's existing page (modules/<name>.tsx through Modules.tsx). */
export function LegacyModuleLayer(p: LayerProps) {
  const { route, nav } = p;
  const moduleRoute = useModuleRoute();
  const moduleNav = useMemo(() => ({ onDeal: nav.deal, onSheet: (t: Parameters<typeof placeOfSheet>[0]) => nav.place(placeOfSheet(t)), onSafety: () => nav.place('safety') }), [nav]);
  if (route.level !== 'module') return null;
  if (showExample()) return <ModuleExample {...p} />;
  return <ModuleView module={route.module} route={moduleRoute} nav={moduleNav} />;
}

/** The Charter as a layer (#s=setup). */
export function LegacySetupLayer({ route, nav, state }: LayerProps) {
  if (route.level !== 'setup') return null;
  const p = state.presence;
  const seal = <Seal state={p.state} progress={null} label={sealLabel(p.word, p.line)} ring={SEAL_RING} />;
  return <Charter step={route.step ?? null} onStep={(s) => nav.go({ level: 'setup', step: s }, { replace: true })} onDone={nav.home} seal={seal} />;
}

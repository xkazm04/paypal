// The Charter as a layer of the console (#s=setup&step=...). Moved here from the interim
// console/legacy.tsx (rebuild WP4a) unchanged: the Charter draws the wallet's seal itself, its step
// is the route's (a step change replaces the history entry), and Done goes back to the centre.
// Everything privileged inside it only hands off to the approval window (Handoff -> approval_open).
import { SEAL_RING, sealLabel } from '../../../../../lib/words';
import { Seal } from '../../../../../shared/brand';
import { Charter } from '../../../setup/Charter';
import type { LayerProps } from '../../layers';

export function SetupLayer({ route, nav, state }: LayerProps) {
  if (route.level !== 'setup') return null;
  const p = state.presence;
  const seal = <Seal state={p.state} progress={null} label={sealLabel(p.word, p.line)} ring={SEAL_RING} />;
  return <Charter step={route.step ?? null} onStep={(s) => nav.go({ level: 'setup', step: s }, { replace: true })} onDone={nav.home} seal={seal} />;
}

// The getting-started facts for Main (moved from the Dial home's home/Start.tsx): which of the
// steps are done, read from settings, the signed rules, the connections and the agent app. Pure
// mapping lives in lib/firstRun.ts; this file only reads. Also the note the Tumbler leaves when its
// welcome buttons open The Table: Main takes it once and goes to the Set up step it names.
import { useCallback, useEffect, useMemo } from 'react';
import { connectionFacts, gettingStarted, rulesInForce, settingsFacts, takeSetupIntent, type GettingStarted } from '../../../lib/firstRun';
import { useEvent, useNow, useQuery } from '../../../lib/hooks';
import type { SetupStepKey } from '../../../lib/words';
import { useSettings } from '../world';

/** The getting-started path for this wallet, from settings, the signed rules and the connections. */
export function useStart(): GettingStarted {
  const now = useNow();
  const s = useSettings().data;
  const mandates = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  const cps = useQuery('counterparty_list', null, { refreshOn: ['pairing:pinned', 'settings:changed'] });
  const inForce = rulesInForce(mandates.data, now);
  const conn = cps.data;
  // The Table can also ask whether the chosen agent app is installed and ready (engine_status).
  const engines = useQuery('engine_status', null, { refreshOn: ['settings:changed'] });
  const engine = s?.selected_engine ?? null;
  const engineAvailable = engine && engines.data ? engines.data.find((e) => e.id === engine)?.available ?? false : null;
  return useMemo(() => gettingStarted({
    ...settingsFacts(s), rulesInForce: inForce, ...connectionFacts(conn), engineAvailable,
  }), [s, inForce, conn, engineAvailable]);
}

/** How long the console lets a `main:route` event settle on its own route before it follows the
 *  Tumbler's Set up note (the note is written just before the route event is sent). */
export const SETUP_INTENT_SETTLE_MS = 250;

/** Takes the Tumbler's note (on open, on every `main:route` and when another window writes it)
 *  and goes to the Set up step it names. */
export function useSetupIntent(go: (step: SetupStepKey) => void): void {
  const take = useCallback(() => {
    const t = setTimeout(() => { const step = takeSetupIntent(Date.now()); if (step) go(step); }, SETUP_INTENT_SETTLE_MS);
    return () => clearTimeout(t);
  }, [go]);
  useEffect(() => take(), [take]);
  useEvent('main:route', () => { take(); });
  useEffect(() => {
    const on = () => { take(); };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, [take]);
}

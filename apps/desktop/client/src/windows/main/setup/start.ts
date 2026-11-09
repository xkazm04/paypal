// The getting-started facts for Main (moved from the Dial home's home/Start.tsx): which of the
// steps are done, read from settings, the signed rules, the connections and the agent app. Pure
// mapping lives in lib/firstRun.ts; this file only reads. Also the note the Tumbler leaves when its
// welcome buttons open The Table: Main takes it once and goes to the Set up step it names.
import { useCallback, useEffect, useMemo } from 'react';
import { connectionFacts, gettingStarted, rulesInForce, settingsFacts, takeSetupIntent, type GettingStarted } from '../../../lib/firstRun';
import { agentAppAvailable, useAgentApp } from '../../../lib/engine';
import { useClock, useEvent, useQuery } from '../../../lib/hooks';
import type { SetupStepKey } from '../../../lib/words';
import { useSettings } from '../world';

/** The getting-started path for this wallet, from settings, the signed rules and the connections.
 *  The clock is read through useClock: the caller (the whole console) re-renders only when the count
 *  of rules in force changes (a rule expiring), never on the one-second tick. */
export function useStart(): GettingStarted {
  const s = useSettings().data;
  const mandates = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  const cps = useQuery('counterparty_list', null, { refreshOn: ['pairing:pinned', 'settings:changed'] });
  const list = mandates.data;
  const inForce = useClock((now) => rulesInForce(list, now));
  const conn = cps.data;
  // Whether the chosen agent app is installed and ready: engine_brief, the same answer every window reads.
  const engineAvailable = agentAppAvailable(useAgentApp(s?.selected_engine).state);
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

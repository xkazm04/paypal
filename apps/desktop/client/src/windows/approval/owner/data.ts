// What the what-if reads: mandate_simulate (approval only, read-only, no unlock). Rust replays the
// draft and the rules in force over this week's recorded deals with its own check; nothing is
// signed, written or sent. The call is debounced so typing or dragging a limit asks once it
// settles, and the last answer stays on screen (marked as updating) until the next one lands.
import { useEffect, useRef, useState } from 'react';
import type { MandateSimulateArgs } from '@bindings/MandateSimulateArgs';
import type { MandateSimulation } from '@bindings/MandateSimulation';
import { toWalletError, type WalletError } from '../../../lib/contract';
import { backend } from '../../../lib/runtime';

/** How long the draft must stay still before the wallet is asked again. */
export const SIMULATE_DEBOUNCE_MS = 400;

export type Simulation = {
  /** The latest answer (it may be for an earlier draft while `updating`); null before the first. */
  sim: MandateSimulation | null;
  /** The latest failure (REFUSED = this draft can't be signed), cleared by the next answer. */
  error: WalletError | null;
  /** A newer draft is waiting for its answer. */
  updating: boolean;
};

type Invoke = (args: MandateSimulateArgs) => Promise<MandateSimulation>;
const viaBackend: Invoke = (args) => backend().invoke('mandate_simulate', args);

/** Ask Rust for the what-if of `args` once it has been still for `delay` ms. null = nothing to ask. */
export function useSimulation(args: MandateSimulateArgs | null, opts: { delay?: number; invoke?: Invoke } = {}): Simulation {
  return useDebouncedSimulation(args, opts.invoke ?? viaBackend, JSON.stringify, opts.delay);
}

/**
 * The one debounce behind both what-ifs (the rules' mandate_simulate, the wallet limits'
 * envelope_simulate): ask `invoke` with the latest `args` once their key has been still for
 * `delay` ms. `keyOf` leaves out what never changes the answer (the limits' moving expiry).
 */
export function useDebouncedSimulation<A>(args: A | null, invoke: (args: A) => Promise<MandateSimulation>, keyOf: (args: A) => string, delay = SIMULATE_DEBOUNCE_MS): Simulation {
  const call = useRef(invoke);
  call.current = invoke;
  const latest = useRef(args);
  latest.current = args;
  const key = args ? keyOf(args) : null;
  const [answer, setAnswer] = useState<{ key: string | null; sim: MandateSimulation | null; error: WalletError | null }>({ key: null, sim: null, error: null });
  useEffect(() => {
    if (key === null) return;
    let live = true;
    const timer = setTimeout(() => {
      const now = latest.current;
      if (!now) return;
      call.current(now).then(
        (sim) => live && setAnswer({ key, sim, error: null }),
        (e: unknown) => live && setAnswer((a) => ({ key, sim: a.sim, error: toWalletError(e) })),
      );
    }, delay);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, delay]);
  return { sim: answer.sim, error: answer.error, updating: key !== null && answer.key !== key };
}

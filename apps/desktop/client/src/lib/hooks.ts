import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ArgsOf, CommandName, EventName, InvokeOptions, PayloadOf, ResultOf } from './contract';
import { WalletError, toWalletError } from './contract';
import { useCommand } from './data/query';

export { useCommand, type CommandRead, type ReadOptions } from './data/query';
import { backend } from './runtime';
import { onClockChange } from './clock';
import { useCalm } from '../design/motion';
import { nowUnix } from './format';

/** Subscribe to a targeted Rust event for the lifetime of the component. */
export function useEvent<E extends EventName>(event: E, cb: (payload: PayloadOf<E>) => void): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    let off: (() => void) | null = null;
    let dead = false;
    // Like lib/data/bus.ts: a refused subscription is reported, never an unhandled rejection.
    void Promise.resolve()
      .then(() => backend().listen(event, (p) => ref.current(p)))
      .then(
        (u) => (dead ? u() : (off = u)),
        (e: unknown) => console.error('event subscription failed', event, e),
      );
    return () => {
      dead = true;
      off?.();
    };
  }, [event]);
}

export type Query<T> = {
  data: T | undefined;
  error: WalletError | null;
  loading: boolean;
  refetch: () => Promise<void>;
};

/**
 * Read command with refetch, on the query layer (lib/data): one cache entry per read shared by every
 * component that asks for it, events turned into coalesced invalidations (lib/data/invalidation.ts
 * plus `refreshOn`), a 10 s time limit per read, and the last good answer kept when a refetch fails.
 * An answer is never shown under other arguments (a deal switch), and a slow old answer cannot
 * overwrite a newer one. The return shape and the call signature are the ones the views were built on.
 */
export function useQuery<K extends CommandName>(
  cmd: K,
  args: ArgsOf<K>,
  opts: { refreshOn?: EventName[]; enabled?: boolean; token?: string } = {},
): Query<ResultOf<K>> {
  return useCommand(cmd, args, opts);
}

export type Mutation<K extends CommandName> = {
  run: (args: ArgsOf<K>, opts?: InvokeOptions) => Promise<ResultOf<K> | undefined>;
  pending: boolean;
  error: WalletError | null;
  reset: () => void;
};

/** A command with side effects. Failures are kept as typed state for honest rendering. */
export function useMutation<K extends CommandName>(cmd: K): Mutation<K> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<WalletError | null>(null);
  const run = useCallback(
    async (args: ArgsOf<K>, opts?: InvokeOptions) => {
      setPending(true);
      setError(null);
      try {
        return await backend().invoke(cmd, args, opts);
      } catch (e) {
        setError(toWalletError(e));
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [cmd],
  );
  const reset = useCallback(() => setError(null), []);
  return useMemo(() => ({ run, pending, error, reset }), [run, pending, error, reset]);
}

/** A ticking Unix-seconds clock for countdowns. Countdowns are computed from absolute
 *  deadlines, so a throttled hidden webview self-corrects on the next tick. It reads the one
 *  client clock (lib/clock.ts): wall time in the shell; in a browser preview a jump of the
 *  simulated clock re-renders every countdown at once instead of on the next second. */
const clock = (() => {
  let now = nowUnix();
  const subs = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let offJump: (() => void) | null = null;
  /** Set while a quiet read's value holds: until the current task ends (a render, with React's
   *  repeated getSnapshot calls, is one task) or the last countdown that read it goes away, so a
   *  second boundary inside one render cannot change it. */
  let held = false;
  const tick = () => { now = nowUnix(); held = false; subs.forEach((s) => s()); };
  return {
    subscribe(cb: () => void) {
      subs.add(cb);
      if (!timer) timer = setInterval(tick, 1000);
      if (!offJump) offJump = onClockChange(tick);
      return () => {
        subs.delete(cb);
        if (!subs.size && timer) { clearInterval(timer); timer = null; }
        if (!subs.size && offJump) { offJump(); offJump = null; }
        // The last countdown left: the next one drawn is a new screen and reads the clock again.
        if (!subs.size) held = false;
      };
    },
    // With nothing subscribed no tick runs, so the first countdown drawn after a quiet spell
    // reads the clock itself instead of the second the last countdown left. That read is held for
    // the rest of the task: useSyncExternalStore calls getSnapshot more than once per render and
    // requires the same value each time ("The result of getSnapshot should be cached"), which a
    // fresh read failed whenever a second ended between two calls (seen in the director's takes).
    get: () => {
      if (subs.size || held) return now;
      now = nowUnix();
      held = true;
      queueMicrotask(() => { held = false; });
      return now;
    },
  };
})();

/** The snapshot useNow reads (exported for its tests). */
export const nowSnapshot = (): number => clock.get();

export function useNow(): number {
  return useSyncExternalStore(clock.subscribe, clock.get, clock.get);
}

/** Whether JS-timed motion should be calm: the OS asks for reduced motion OR the owner turned the
 *  in-app calm mode on (design/motion.ts, the one rule the CSS follows too). */
export function usePrefersReducedMotion(): boolean {
  return useCalm();
}

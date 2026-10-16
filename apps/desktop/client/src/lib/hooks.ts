import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ArgsOf, CommandName, EventName, InvokeOptions, PayloadOf, ResultOf } from './contract';
import { WalletError, toWalletError } from './contract';
import { useCommand } from './data/query';

export { useCommand, type CommandRead, type ReadOptions } from './data/query';
import { backend } from './runtime';
import { onClockChange } from './clock';
import { nowUnix } from './format';

/** Subscribe to a targeted Rust event for the lifetime of the component. */
export function useEvent<E extends EventName>(event: E, cb: (payload: PayloadOf<E>) => void): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    let off: (() => void) | null = null;
    let dead = false;
    void backend()
      .listen(event, (p) => ref.current(p))
      .then((u) => (dead ? u() : (off = u)));
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
  const tick = () => { now = nowUnix(); subs.forEach((s) => s()); };
  return {
    subscribe(cb: () => void) {
      subs.add(cb);
      if (!timer) timer = setInterval(tick, 1000);
      if (!offJump) offJump = onClockChange(tick);
      return () => {
        subs.delete(cb);
        if (!subs.size && timer) { clearInterval(timer); timer = null; }
        if (!subs.size && offJump) { offJump(); offJump = null; }
      };
    },
    get: () => now,
  };
})();

export function useNow(): number {
  return useSyncExternalStore(clock.subscribe, clock.get, clock.get);
}

export function usePrefersReducedMotion(): boolean {
  const q = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  return useSyncExternalStore(
    (cb) => { q?.addEventListener('change', cb); return () => q?.removeEventListener('change', cb); },
    () => q?.matches ?? false,
    () => false,
  );
}

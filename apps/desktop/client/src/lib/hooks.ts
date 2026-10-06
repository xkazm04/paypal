import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ArgsOf, CommandName, EventName, InvokeOptions, PayloadOf, ResultOf } from './contract';
import { WalletError, toWalletError } from './contract';
import { backend } from './runtime';
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
 * Read command with refetch. Events are projections, not retained state: subscribe first,
 * then fetch (STATUS handoff), and refetch whenever one of `refreshOn` fires.
 */
export function useQuery<K extends CommandName>(
  cmd: K,
  args: ArgsOf<K>,
  opts: { refreshOn?: EventName[]; enabled?: boolean; token?: string } = {},
): Query<ResultOf<K>> {
  const [data, setData] = useState<ResultOf<K>>();
  const [error, setError] = useState<WalletError | null>(null);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(args);
  const enabled = opts.enabled ?? true;
  const token = opts.token;

  const refetch = useCallback(async () => {
    if (!enabled) return;
    try {
      const r = await backend().invoke(cmd, JSON.parse(key) as ArgsOf<K>, token ? { token } : undefined);
      setData(r);
      setError(null);
    } catch (e) {
      setError(toWalletError(e));
    } finally {
      setLoading(false);
    }
  }, [cmd, key, enabled, token]);

  useEffect(() => {
    const offs: Array<() => void> = [];
    let dead = false;
    for (const ev of opts.refreshOn ?? []) {
      void backend()
        .listen(ev, () => void refetch())
        .then((u) => (dead ? u() : offs.push(u)));
    }
    void refetch();
    return () => {
      dead = true;
      offs.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch, (opts.refreshOn ?? []).join('|')]);

  return { data, error, loading, refetch };
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
  return { run, pending, error, reset: () => setError(null) };
}

/** A ticking Unix-seconds clock for countdowns. Countdowns are computed from absolute
 *  deadlines, so a throttled hidden webview self-corrects on the next tick. */
const clock = (() => {
  let now = nowUnix();
  const subs = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    subscribe(cb: () => void) {
      subs.add(cb);
      if (!timer) timer = setInterval(() => { now = nowUnix(); subs.forEach((s) => s()); }, 1000);
      return () => {
        subs.delete(cb);
        if (!subs.size && timer) { clearInterval(timer); timer = null; }
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

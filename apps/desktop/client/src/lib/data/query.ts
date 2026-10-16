// The typed read hook of the query layer. lib/hooks.ts useQuery is this hook with the old return
// shape; new code may use either.
import { useQuery as useTanstackQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ArgsOf, CommandName, EventName, ResultOf } from '../contract';
import { toWalletError, type WalletError } from '../contract';
import { busOf } from './bus';
import { isFresh } from './client';
import { readCommand } from './invoke';
import { FRESH_POLICY, keyOf, type ReadMeta } from './keys';
import { useDataClient } from './provider';

export type ReadOptions = {
  /** Events that make this read stale, in addition to the map in invalidation.ts. */
  refreshOn?: EventName[];
  enabled?: boolean;
  /** Approval-window capability token. Never part of the key; kept in memory only. */
  token?: string;
};

export type CommandRead<T> = {
  /** The last good answer for these arguments, kept while a refetch fails. */
  data: T | undefined;
  /** The last failure for these arguments, or null once a read succeeds again. */
  error: WalletError | null;
  /** No answer and no failure yet for these arguments. */
  loading: boolean;
  /** The data shown is older than a failed read: say so instead of presenting it as current. */
  stale: boolean;
  refetch: () => Promise<void>;
};

/** One read, shared by every component that asks for the same thing (lib/data/keys.ts), read again
 *  when an event makes it stale (lib/data/invalidation.ts), and never shown under other arguments. */
export function useCommand<K extends CommandName>(cmd: K, args: ArgsOf<K>, opts: ReadOptions = {}): CommandRead<ResultOf<K>> {
  const client = useDataClient();
  const argsJson = JSON.stringify(args);
  // The key is a function of the arguments' JSON, so a new args object each render is the same read.
  const info = useMemo(() => keyOf(cmd, JSON.parse(argsJson) as ArgsOf<K>), [cmd, argsJson]);
  const enabled = opts.enabled ?? true;
  const token = useRef(opts.token);
  token.current = opts.token;
  const meta: ReadMeta = { dealId: info.dealId };
  const policy = isFresh(client) ? FRESH_POLICY : info.policy;

  const q = useTanstackQuery<ResultOf<K>, WalletError>(
    {
      queryKey: info.key,
      queryFn: () => readCommand(cmd, JSON.parse(argsJson) as ArgsOf<K>, token.current ? { token: token.current } : undefined),
      enabled,
      staleTime: policy.staleTime,
      gcTime: policy.gcTime,
      meta,
    },
    client,
  );

  const events = (opts.refreshOn ?? []).join('|');
  // `info` is memoised on the arguments' JSON, so this runs again only for a different read.
  useEffect(() => {
    if (!events) return;
    const bus = busOf(client);
    const offs = events.split('|').map((e) => bus.register(e as EventName, info.key, info.dealId));
    return () => offs.forEach((off) => off());
  }, [client, events, info]);

  const qRefetch = q.refetch;
  const refetch = useCallback(async () => {
    if (!enabled) return;
    await qRefetch();
  }, [enabled, qRefetch]);

  const data = q.data;
  const error = q.error ? toWalletError(q.error) : null;
  const loading = q.status === 'pending';
  return useMemo(
    () => ({ data, error, loading, stale: error !== null && data !== undefined, refetch }),
    [data, error, loading, refetch],
  );
}

// The QueryClient of one window. Reads go over IPC, not the network: no online/offline pausing, no
// refetch on window focus (the shell pushes events instead).
import { QueryClient } from '@tanstack/react-query';
import { toWalletError } from '../contract';
import { NAMED_POLICY } from './keys';

/** One more try after a short wait, and only when the shell said the read is unavailable (the
 *  runtime is still starting, or a read timed out). Refusals, locks, bad input: never retried. */
export const RETRY_DELAY_MS = 750;

export function shouldRetry(failures: number, error: unknown): boolean {
  return failures < 1 && toWalletError(error).code === 'UNAVAILABLE';
}

export type ClientOptions = {
  /** false: a failure shows at once (a tree mounted without the window's provider, i.e. a test). */
  retry?: boolean;
  /** true: every read uses the fresh policy (keys.ts FRESH_POLICY): read again on every mount and
   *  dropped once unshown, as before the query layer. The approval and tumbler windows, and a tree
   *  with no provider, read this way; only the main window keeps named reads across mounts. */
  fresh?: boolean;
};

const freshClients = new WeakSet<QueryClient>();

/** True for a client whose reads all use the fresh policy. */
export function isFresh(client: QueryClient): boolean {
  return freshClients.has(client);
}

export function createDataClient(o: ClientOptions = {}): QueryClient {
  const retry = o.retry ?? true;
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: NAMED_POLICY.staleTime,
        gcTime: NAMED_POLICY.gcTime,
        retry: retry ? shouldRetry : false,
        retryDelay: RETRY_DELAY_MS,
        networkMode: 'always',
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
  if (o.fresh) freshClients.add(client);
  return client;
}

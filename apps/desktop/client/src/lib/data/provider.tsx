// The window's read layer: one QueryClient and one event subscription set per window, mounted by
// lib/mount.tsx around every window's App.
import { QueryClientContext, QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { busOf, retainMapped } from './bus';
import { createDataClient } from './client';

/** How a window reads. 'main': the event map (invalidation.ts) is held while mounted and named reads
 *  are kept across mounts (keys.ts NAMED_POLICY). 'plain' (the approval and tumbler windows): reads
 *  follow only their own `refreshOn` and are read again on every mount, as before the layer; they are
 *  still shared while mounted, coalesced and time-limited. */
export type DataScope = 'main' | 'plain';

/** Provides the query client of a window (lib/mount.tsx) or of a test tree. A client can be passed in
 *  (tests); otherwise one is made for this tree. */
export function DataProvider({ client, retry, scope = 'main', children }: { client?: QueryClient; retry?: boolean; scope?: DataScope; children: ReactNode }) {
  const [c] = useState(() => client ?? createDataClient({ ...(retry === undefined ? {} : { retry }), fresh: scope === 'plain' }));
  useEffect(() => (scope === 'main' ? retainMapped(busOf(c)) : undefined), [c, scope]);
  return <QueryClientProvider client={c}>{children}</QueryClientProvider>;
}

/** The window's client, or, in a tree mounted without a provider (a component test), a client of
 *  this component's own that does not retry, so it behaves like the read hook before the layer. */
export function useDataClient(): QueryClient {
  const ctx = useContext(QueryClientContext);
  const own = useRef<QueryClient | null>(null);
  if (ctx) return ctx;
  if (!own.current) own.current = createDataClient({ retry: false, fresh: true });
  return own.current;
}

/** True when a provider is above: WorldProvider mounts its own when there is none. */
export function useHasDataProvider(): boolean {
  return useContext(QueryClientContext) !== undefined;
}

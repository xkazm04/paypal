// The Book's PayPal evidence through the shared query cache (rebuild WP3b, scale finding #17).
// Every read is the per-deal entry ['deal_evidence', id] (lib/data/keys.ts) that the deal page
// reads too, so a deal opened from the Book reads nothing again; the event map
// (lib/data/invalidation.ts) marks an entry stale when its deal changes. Only what is drawn is
// read: a ledger row asks for its own deal's evidence when it is in view (the list is windowed),
// and the "PayPal agrees" figure asks only for the week's paid deals. At most READ_CONCURRENCY
// evidence reads are out at once, however many rows ask. Read-only: nothing here moves money.
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import type { DealEvidence } from '@bindings/DealEvidence';
import { toWalletError, type WalletError } from '../../../../../lib/contract';
import { isFresh } from '../../../../../lib/data/client';
import { readCommand } from '../../../../../lib/data/invoke';
import { FRESH_POLICY, keyOf, type ReadMeta } from '../../../../../lib/data/keys';
import { useDataClient } from '../../../../../lib/data/provider';
import { READ_CONCURRENCY } from '../../../../../lib/readEach';

/** A small gate: at most `n` reads run at once; the rest wait their turn in order. */
export function gate(n: number): <T>(run: () => Promise<T>) => Promise<T> {
  let busy = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (busy >= n) return;
    const go = queue.shift();
    if (go) go();
  };
  return <T>(run: () => Promise<T>) => new Promise<T>((resolve, reject) => {
    queue.push(() => {
      busy += 1;
      run().then(resolve, reject).finally(() => { busy -= 1; next(); });
    });
    next();
  });
}

const evidenceGate = gate(READ_CONCURRENCY);

function useOptions() {
  const client = useDataClient();
  return useMemo(() => {
    const fresh = isFresh(client);
    return (id: string) => {
      const info = keyOf('deal_evidence', { deal_id: id });
      const policy = fresh ? FRESH_POLICY : info.policy;
      const meta: ReadMeta = { dealId: id };
      return {
        queryKey: info.key,
        queryFn: () => evidenceGate(() => readCommand('deal_evidence', { deal_id: id })),
        staleTime: policy.staleTime,
        gcTime: policy.gcTime,
        meta,
      };
    };
  }, [client]);
}

/** One deal's evidence, read when the caller is drawn (a row in view, a detail pane). */
export function useDealEvidence(id: string | null | undefined): { data: DealEvidence | undefined; error: WalletError | null } {
  const client = useDataClient();
  const opts = useOptions();
  const q = useQuery<DealEvidence, WalletError>({ ...opts(id ?? ''), enabled: !!id }, client);
  return { data: q.data, error: q.error ? toWalletError(q.error) : null };
}

export type EvidenceMap = { map: ReadonlyMap<string, DealEvidence>; error: WalletError | null; loading: boolean };

/** The evidence of a bounded set of deals (the week's paid deals), as one map. */
export function useEvidenceOf(ids: readonly string[]): EvidenceMap {
  const client = useDataClient();
  const opts = useOptions();
  const rs = useQueries({ queries: ids.map((id) => opts(id)) }, client);
  // One map per change of the set or of an answer, so a consumer's memo runs again only then.
  const stamp = `${ids.join('|')}#${rs.map((r) => r.dataUpdatedAt).join(',')}`;
  const kept = useRef<{ stamp: string; map: ReadonlyMap<string, DealEvidence> }>({ stamp: '', map: new Map() });
  if (kept.current.stamp !== stamp) {
    const m = new Map<string, DealEvidence>();
    rs.forEach((r, i) => { const id = ids[i]; if (r.data && id !== undefined) m.set(id, r.data); });
    kept.current = { stamp, map: m };
  }
  const firstError = rs.find((r) => r.error)?.error ?? null;
  const loading = rs.some((r) => r.status === 'pending');
  return { map: kept.current.map, error: firstError ? toWalletError(firstError) : null, loading };
}

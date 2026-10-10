// Which deals that ended at their deadline did so while a money step was still being checked with
// PayPal, when the steps a surface holds cannot tell. The away card reads history only from the
// owner's last look and the Rewind reads one week, so a check that began earlier is out of sight.
// The deal's own record decides then: deal_evidence carries money_check (the deal's oldest open
// money operation, which stays on a deal that ended with one open), as the deal page already
// reads it. Read-only: one evidence read per ending, nothing here can move money.
import { useEffect, useMemo, useState } from 'react';
import type { HistoryStep } from '@bindings/HistoryStep';
import { backend } from '../../lib/runtime';
import { endedBeforePayPalShowed } from './logic';

/** The deals with an ending the steps cannot place: sorted, distinct deal ids. */
export function endingsToRead(steps: readonly HistoryStep[]): string[] {
  const ids = steps
    .filter((s) => (s.kind === 'expired' || s.kind === 'lapsed') && !endedBeforePayPalShowed(steps, s))
    .map((s) => s.deal_id);
  return [...new Set(ids)].sort();
}

const NONE: ReadonlySet<string> = new Set();

/** The deals whose own record shows they ended while a money step was open; `pending` while the
 *  reads for the current endings are out, so a caller can wait rather than word an ending it cannot tell. */
export function useEndedUnshown(steps: readonly HistoryStep[], enabled: boolean): { unshown: ReadonlySet<string>; pending: boolean } {
  const key = useMemo(() => endingsToRead(steps).join(','), [steps]);
  const [done, setDone] = useState<{ key: string; unshown: ReadonlySet<string> } | null>(null);
  useEffect(() => {
    if (!enabled || !key) return;
    const ids = key.split(',');
    let dead = false;
    void Promise.allSettled(ids.map((id) => backend().invoke('deal_evidence', { deal_id: id }))).then((rs) => {
      if (dead) return;
      const found = new Set<string>();
      // A rejected read leaves its deal out, so that deal keeps today's words.
      rs.forEach((r, i) => { const id = ids[i]; if (id && r.status === 'fulfilled' && r.value.money_check) found.add(id); });
      setDone({ key, unshown: found });
    });
    return () => { dead = true; };
  }, [enabled, key]);
  if (!enabled || !key) return { unshown: NONE, pending: false };
  if (done?.key !== key) return { unshown: done?.unshown ?? NONE, pending: true };
  return { unshown: done.unshown, pending: false };
}

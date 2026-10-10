// Which deals that ended at their deadline did so while a money step was still being checked with
// PayPal, when the steps a surface holds cannot tell. The away card reads history only from the
// owner's last look and the Rewind reads one week, so a check that began earlier is out of sight.
// The deal's own record decides then: deal_evidence carries money_check (the deal's oldest open
// money operation, which stays on a deal that ended with one open), as the deal page already
// reads it. Read-only: one evidence read per ending, nothing here can move money.
import { useEffect, useMemo, useState } from 'react';
import type { HistoryStep } from '@bindings/HistoryStep';
import { readEach } from '../../lib/readEach';
import { backend } from '../../lib/runtime';
import { endedBeforePayPalShowed } from './logic';

/** The most endings read per surface. It mirrors HISTORY_STEPS in crates/table-runtime/src/history.rs,
 *  which caps the deal_history steps these ids come from; it is stated here so the width of the
 *  reads is visible at the call site. An ending past it is not read and counts as unread. */
export const ENDING_READS_MAX = 500;

/** The deals with an ending the steps cannot place: sorted, distinct deal ids. */
export function endingsToRead(steps: readonly HistoryStep[]): string[] {
  const ids = steps
    .filter((s) => (s.kind === 'expired' || s.kind === 'lapsed') && !endedBeforePayPalShowed(steps, s))
    .map((s) => s.deal_id);
  return [...new Set(ids)].sort();
}

const NONE: ReadonlySet<string> = new Set();

type Endings = { unshown: ReadonlySet<string>; unread: ReadonlySet<string>; pending: boolean };

/** The deals whose own record shows they ended while a money step was open (`unshown`), and the
 *  endings whose record could not be read (`unread`); `pending` while the reads for the current
 *  endings are out, so a caller can wait rather than word an ending it cannot tell. */
export function useEndedUnshown(steps: readonly HistoryStep[], enabled: boolean): Endings {
  const key = useMemo(() => endingsToRead(steps).join(','), [steps]);
  const [done, setDone] = useState<{ key: string; unshown: ReadonlySet<string>; unread: ReadonlySet<string> } | null>(null);
  useEffect(() => {
    if (!enabled || !key) return;
    const all = key.split(',');
    const ids = all.slice(0, ENDING_READS_MAX);
    let dead = false;
    void readEach(ids, (id) => backend().invoke('deal_evidence', { deal_id: id })).then((rs) => {
      if (dead) return;
      const found = new Set<string>();
      // A read that failed or timed out is not known: its deal is unread and never keeps the calm
      // ending's words ("no money moved"), which is the claim the read exists to stop.
      const unread = new Set<string>(all.slice(ENDING_READS_MAX));
      rs.forEach((r, i) => {
        const id = ids[i];
        if (!id) return;
        if (r.status === 'rejected') unread.add(id);
        else if (r.value.money_check) found.add(id);
      });
      setDone({ key, unshown: found, unread });
    });
    return () => { dead = true; };
  }, [enabled, key]);
  if (!enabled || !key) return { unshown: NONE, unread: NONE, pending: false };
  if (done?.key !== key) return { unshown: done?.unshown ?? NONE, unread: done?.unread ?? NONE, pending: true };
  return { unshown: done.unshown, unread: done.unread, pending: false };
}

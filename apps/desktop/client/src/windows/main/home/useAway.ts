// "While you were away" for the console (moved from the Dial home's AwayCard.tsx): what happened
// since this viewer last looked, from the wallet's own record (deal_history, main only) and the
// deals' terms - never from counterparty text. The decision centre shows its lines as cards in the
// stack row. Read-only: nothing here can move money. Statement reads stay capped (ENDING_READS_MAX).
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Deal } from '@bindings/Deal';
import type { HistoryStep } from '@bindings/HistoryStep';
import { clockNow } from '../../../lib/clock';
import { useClock, useQuery } from '../../../lib/hooks';
import { readEach } from '../../../lib/readEach';
import { backend } from '../../../lib/runtime';
import type { StatementRead } from '../../../lib/words';
import { ENDING_READS_MAX, useEndedUnshown } from '../unshown';
import { awaySummary, QUIET_NEWS_AFTER, readLastSeen, startOfToday, statementReadIds, SEEN_AFTER_MS, worthShowing, writeLastSeen, type AwaySummary } from './away';

const NO_STEPS: readonly HistoryStep[] = [];

export type Away = {
  /** null while the record is read, after a dismiss, on first run, or when the record can't be read. */
  summary: AwaySummary | null;
  dismiss: () => void;
};

/** Reads "last seen" once per page (the card keeps that moment until dismissed), and marks the centre
 *  as seen after it has been on screen a few seconds, every minute after, and on leaving it. */
export function useAway(o: { active: boolean; enabled: boolean; needs: number; deals: readonly Deal[] }): Away {
  const [seen] = useState(() => readLastSeen(clockNow()));
  const [dismissed, setDismissed] = useState(false);
  const on = o.enabled && !dismissed;
  const q = useQuery('deal_history', { deal_id: null, from: seen.at, to: null }, { enabled: on, refreshOn: ['deal:changed'] });
  // `now` reaches the summary through three things only: its "since ..." words (the local day), whether a
  // quiet stretch is long enough to be news (QUIET_NEWS_AFTER) and the window's upper bound. The first two
  // are followed as discrete values, so this re-renders at midnight and when the threshold passes, not
  // every second; the bound is read from the clock when the record or any other input changes.
  const day = useClock(startOfToday);
  const longAway = useClock((n) => n - seen.at >= QUIET_NEWS_AFTER);
  const data = q.data;
  // Whether a statement read came back unmatched, for the deals whose line is an unconfirmed ending in
  // this window's steps (the only line that uses it), capped like the endings' reads. A read that
  // failed or timed out stays out of `reads`, so its line says the wallet has no match, true either way.
  const unconfirmed = useMemo(() => statementReadIds(data?.steps ?? NO_STEPS).slice(0, ENDING_READS_MAX).join(','), [data]);
  const reading = on && !!data && !q.error;
  const [reads, setReads] = useState<ReadonlyMap<string, StatementRead>>(new Map());
  useEffect(() => {
    if (!reading || !unconfirmed) return;
    const ids = unconfirmed.split(',');
    let dead = false;
    void readEach(ids, (id) => backend().invoke('deal_evidence', { deal_id: id })).then((rs) => {
      if (dead) return;
      const m = new Map<string, StatementRead>();
      rs.forEach((r, i) => { const id = ids[i]; if (id && r.status === 'fulfilled') m.set(id, r.value.statement_unmatched); });
      setReads(m);
    });
    return () => { dead = true; };
  }, [reading, unconfirmed]);

  useEffect(() => {
    if (!o.active || !o.enabled) return;
    const shown = Date.now();
    const mark = () => { if (document.visibilityState !== 'hidden') writeLastSeen(clockNow()); };
    const first = setTimeout(mark, SEEN_AFTER_MS);
    const every = setInterval(mark, 60_000);
    const leave = () => writeLastSeen(clockNow());
    window.addEventListener('pagehide', leave);
    return () => {
      clearTimeout(first);
      clearInterval(every);
      window.removeEventListener('pagehide', leave);
      // Leaving Home after a real look counts as seen (not a mount that was undone at once).
      if (Date.now() - shown > 1500) writeLastSeen(clockNow());
    };
  }, [o.active, o.enabled]);

  const dismiss = useCallback(() => { setDismissed(true); writeLastSeen(clockNow()); }, []);
  // Endings whose check began before the window are told by the deal's own record; the card waits for it.
  // An ending whose record could not be read is worded as not known (unread), never as no money moved.
  const { unshown, unread, pending } = useEndedUnshown(data?.steps ?? NO_STEPS, on && !!data && !q.error);
  const summary = useMemo(() => {
    if (!on || !data || q.error || pending) return null;
    const s = awaySummary(data.steps, o.deals, seen.at, Math.max(clockNow(), seen.at), { needs: o.needs, truncated: data.truncated, reads, unshown, unread });
    return worthShowing(s) ? s : null;
  }, [on, data, q.error, o.deals, seen.at, day, longAway, o.needs, reads, unshown, unread, pending]);
  return { summary, dismiss };
}

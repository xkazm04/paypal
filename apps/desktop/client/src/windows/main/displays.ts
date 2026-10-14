// deal_display for the main window, read only for the deals whose display can have changed. A
// deal_display read does several ledger reads and a mandate-signature check in the one runtime
// actor, and list_deals holds every deal the wallet ever had, so reading them all on each ledger
// event made the work grow with the lifetime ledger. Here the width per ledger event is the live
// deals plus the deals whose row changed, not the lifetime ledger. Read-only: nothing here can
// move money.
import { useEffect, useRef, useState } from 'react';
import type { Deal } from '@bindings/Deal';
import type { DealDisplay } from '@bindings/DealDisplay';
import type { DealState } from '@bindings/DealState';
import { toWalletError, type WalletError } from '../../lib/contract';
import { READ_CONCURRENCY, readEach } from '../../lib/readEach';
import { backend } from '../../lib/runtime';
import { isTerminal } from './logic';

/** What a display was read for: the deal's state and the moment its row last changed, or null when
 *  the shell does not report that moment (the deal is then read every time). */
export function displayToken(d: Deal): string | null {
  return d.updated_at === undefined ? null : `${d.state}|${d.updated_at}`;
}

// A capture read back on a deal already paid closes its money check without touching the deal's
// row (crates/table-app/src/pipeline/resolve.rs, the ("capture", "CAPTURED") if captured arm, and
// its parks; table-ledger's record_resolution writes updated_at only with refs or an event), so
// the display's "if you do nothing" line can change while the token stays the same.
const CHECKED_AFTER_END: ReadonlySet<DealState> = new Set(['CAPTURED', 'RECEIPTED']);

/** The deals whose display is read again: not read yet, changed since (or no token), or live. A
 *  live deal's display carries the clock-dependent "if you do nothing" line, so it is re-read on
 *  every refetch, as before. */
export function displaysToRead(deals: readonly Deal[], cache: ReadonlyMap<string, { token: string | null }>): string[] {
  return deals.filter((d) => {
    const had = cache.get(d.id);
    if (!had) return true;
    const token = displayToken(d);
    if (token === null || token !== had.token) return true;
    return !isTerminal(d) || CHECKED_AFTER_END.has(d.state);
  }).map((d) => d.id);
}

type Entry = { token: string | null; display: DealDisplay };

/** How many reads go out before the answers so far are shown. A ledger of hundreds of deals used to
 *  show every deal's fallback display until the last read landed; now each batch lands on screen. */
export const DISPLAY_BATCH = 100;

/** Live deals first (they are the ones on screen: waiting, in progress), then the ended ones. */
export function displayReadOrder(deals: readonly Deal[], ids: readonly string[]): string[] {
  const live = new Set(deals.filter((d) => !isTerminal(d)).map((d) => d.id));
  return [...ids.filter((id) => live.has(id)), ...ids.filter((id) => !live.has(id))];
}

/** deal_display per listed deal, keeping the earlier answer for a deal not read again and dropping
 *  deals no longer listed. A failed read leaves that deal out of the map (it gets the fallback
 *  display) and sets `error`; the deal is read again on the next refetch. The reads go out in
 *  batches, live deals first, and every batch is shown when it lands; `ready` turns true once a
 *  whole pass has been read (until then a label that is not in the map yet may still arrive). A
 *  pass cut short by a newer list keeps what its batches already put in the cache. */
export function useDisplays(deals: Deal[] | undefined): { map: Map<string, DealDisplay>; error: WalletError | null; ready: boolean } {
  const cache = useRef<ReadonlyMap<string, Entry>>(new Map());
  const [state, setState] = useState<{ map: Map<string, DealDisplay>; error: WalletError | null; ready: boolean }>({ map: new Map(), error: null, ready: false });
  useEffect(() => {
    if (!deals) return;
    let dead = false;
    const ids = displayReadOrder(deals, displaysToRead(deals, cache.current));
    const byId = new Map(deals.map((d) => [d.id, d]));
    void (async () => {
      let error: WalletError | null = null;
      for (let at = 0; at === 0 || at < ids.length; at += DISPLAY_BATCH) {
        const part = ids.slice(at, at + DISPLAY_BATCH);
        const rs = await readEach(part, (id) => backend().invoke('deal_display', { deal_id: id }), { concurrency: READ_CONCURRENCY });
        if (dead) return;
        const next = new Map<string, Entry>();
        for (const d of deals) {
          const had = cache.current.get(d.id);
          if (had) next.set(d.id, had);
        }
        rs.forEach((r, i) => {
          const id = part[i];
          const d = id === undefined ? undefined : byId.get(id);
          if (!id || !d) return;
          if (r.status === 'fulfilled') next.set(id, { token: displayToken(d), display: r.value });
          else { next.delete(id); error = toWalletError(r.reason); }
        });
        cache.current = next;
        const last = at + DISPLAY_BATCH >= ids.length;
        const seen = error;
        setState((s) => ({ map: new Map([...next].map(([id, e]): [string, DealDisplay] => [id, e.display])), error: seen, ready: s.ready || last }));
      }
    })();
    return () => { dead = true; };
  }, [deals]);
  return state;
}

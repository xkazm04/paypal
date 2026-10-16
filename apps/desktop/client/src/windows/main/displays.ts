// deal_display for the main window, read only for the deals whose display can have changed. A
// deal_display read does several ledger reads and a mandate-signature check in the one runtime
// actor, and list_deals holds every deal the wallet ever had, so reading them all on each ledger
// event made the work grow with the lifetime ledger. Here the width per ledger event is the live
// deals plus the deals whose row changed, not the lifetime ledger. Read-only: nothing here can
// move money.
import { useEffect, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { Deal } from '@bindings/Deal';
import type { DealDisplay } from '@bindings/DealDisplay';
import type { DealState } from '@bindings/DealState';
import { toWalletError, type WalletError } from '../../lib/contract';
import { readCommand } from '../../lib/data/invoke';
import { NAMED_POLICY, dealKey } from '../../lib/data/keys';
import { useDataClient } from '../../lib/data/provider';
import { READ_CONCURRENCY, createReadPool, isAborted, readEach } from '../../lib/readEach';
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

/** How many reads go out before the answers so far are shown. A ledger of hundreds of deals used to
 *  show every deal's fallback display until the last read landed; now each batch lands on screen. */
export const DISPLAY_BATCH = 100;

/** Live deals first (they are the ones on screen: waiting, in progress), then the ended ones. */
export function displayReadOrder(deals: readonly Deal[], ids: readonly string[]): string[] {
  const live = new Set(deals.filter((d) => !isTerminal(d)).map((d) => d.id));
  return [...ids.filter((id) => live.has(id)), ...ids.filter((id) => !live.has(id))];
}

/** What the main window shows of the displays: one map per pass result, stable while nothing in it
 *  changed, so a selector over it does not re-render on a pass that read the same answers. */
export type DisplaysState = { map: Map<string, DealDisplay>; error: WalletError | null; ready: boolean };

// The pass runner of one client (one window). The answers live in the query cache, one
// ['deal_display', id] entry per deal, shared with every component that reads a deal's display
// (lib/display.ts useDealDisplay, the tumbler's forms); the runner keeps only the token each answer
// was read for. One pass runs at a time: a newer deal list aborts the running pass (it starts no
// further read; reads already out settle and are kept), and the next pass runs on the latest list
// once they have settled. The runner owns one pool of READ_CONCURRENCY slots that every batch and
// every pass reads through, and a read keeps its slot until it has settled, so at most
// READ_CONCURRENCY deal_display reads of the passes are ever in flight, a stuck read of an earlier
// batch or an aborted pass included, whatever the event rate.
type Runner = {
  request(deals: readonly Deal[]): void;
  subscribe(cb: (s: DisplaysState) => void): () => void;
  get(): DisplaysState;
};

const runners = new WeakMap<QueryClient, Runner>();

function runnerOf(client: QueryClient): Runner {
  let r = runners.get(client);
  if (!r) {
    r = createRunner(client);
    runners.set(client, r);
  }
  return r;
}

function createRunner(client: QueryClient): Runner {
  const tokens = new Map<string, string | null>();
  const subs = new Set<(s: DisplaysState) => void>();
  let state: DisplaysState = { map: new Map(), error: null, ready: false };
  let listed: readonly Deal[] = [];
  let latest: readonly Deal[] | null = null;
  let running: AbortController | null = null;
  const pool = createReadPool(READ_CONCURRENCY);

  const answer = (id: string): DealDisplay | undefined => client.getQueryData<DealDisplay>(dealKey('deal_display', id));

  const publish = (patch: Partial<DisplaysState>): void => {
    const map = new Map<string, DealDisplay>();
    for (const d of listed) {
      const x = answer(d.id);
      if (x) map.set(d.id, x);
    }
    const same = map.size === state.map.size && [...map].every(([id, x]) => state.map.get(id) === x);
    const next: DisplaysState = { map: same ? state.map : map, error: patch.error === undefined ? state.error : patch.error, ready: state.ready || !!patch.ready };
    if (next.map === state.map && next.error === state.error && next.ready === state.ready) return;
    state = next;
    subs.forEach((f) => f(state));
  };

  const read = (id: string, d: Deal): Promise<DealDisplay> =>
    client
      .fetchQuery({
        queryKey: dealKey('deal_display', id),
        queryFn: () => readCommand('deal_display', { deal_id: id }),
        staleTime: 0,
        gcTime: NAMED_POLICY.gcTime,
        retry: false,
        meta: { dealId: id },
      })
      .then((v) => {
        tokens.set(id, displayToken(d));
        return v;
      });

  const pump = (): void => {
    if (running || !latest || subs.size === 0) return;
    const deals = latest;
    latest = null;
    listed = deals;
    const byId = new Map(deals.map((d) => [d.id, d]));
    for (const id of [...tokens.keys()]) if (!byId.has(id)) tokens.delete(id);
    const known = new Map<string, { token: string | null }>();
    for (const [id, token] of tokens) if (answer(id) !== undefined) known.set(id, { token });
    const ids = displayReadOrder(deals, displaysToRead(deals, known));
    const ctl = new AbortController();
    running = ctl;
    void (async () => {
      let error: WalletError | null = null;
      for (let at = 0; at === 0 || at < ids.length; at += DISPLAY_BATCH) {
        const part = ids.slice(at, at + DISPLAY_BATCH);
        const rs = await readEach(part, (id) => {
          const d = byId.get(id);
          return d ? read(id, d) : Promise.reject(new Error('deal is not listed'));
        }, { concurrency: READ_CONCURRENCY, signal: ctl.signal, pool });
        rs.forEach((r, i) => {
          const id = part[i];
          if (id === undefined || r.status === 'fulfilled' || isAborted(r.reason)) return;
          tokens.delete(id);
          error = toWalletError(r.reason);
        });
        const last = at + DISPLAY_BATCH >= ids.length;
        publish({ error, ready: last && !ctl.signal.aborted });
        if (ctl.signal.aborted) break;
      }
      running = null;
      pump();
    })();
  };

  // A display read elsewhere (a deal page, a card) lands in the same entry: show it here too.
  let queued = false;
  client.getQueryCache().subscribe((e) => {
    // A running pass shows its own answers batch by batch (and any other that landed meanwhile).
    if (running || e.type !== 'updated' || e.action.type !== 'success' || e.query.queryKey[0] !== 'deal_display' || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      publish({});
    });
  });

  return {
    request(deals) {
      latest = deals;
      if (running) running.abort();
      else pump();
    },
    subscribe(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
        if (subs.size === 0) running?.abort();
      };
    },
    get: () => state,
  };
}

/** deal_display per listed deal, from the query cache, reading again only what displaysToRead names.
 *  A failed read keeps that deal's last good answer if it had one (else it gets the fallback
 *  display), sets `error`, and is read again on the next pass. The reads go out in batches, live
 *  deals first, and every batch is shown when it lands; `ready` turns true once a whole pass has
 *  been read (until then a label that is not in the map yet may still arrive). One list per window:
 *  the World is the only caller. */
export function useDisplays(deals: Deal[] | undefined): DisplaysState {
  const client = useDataClient();
  const runner = runnerOf(client);
  const [state, setState] = useState<DisplaysState>(runner.get);
  useEffect(() => {
    if (!deals) return;
    const off = runner.subscribe(setState);
    setState(runner.get());
    runner.request(deals);
    return off;
  }, [deals, runner]);
  return state;
}

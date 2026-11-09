// One event subscription per event per window (not per hook), and coalesced invalidation.
//
// - `retain(event)` listens to a Rust event once for this client, however many hooks need it;
//   `release` stops listening when the last one is gone.
// - Every event is turned into targets: the map (invalidation.ts) plus the keys whose hooks named the
//   event in `refreshOn` (narrowed to the event's deal for per-deal reads).
// - Targets are collected and flushed once per microtask, so a burst of events delivered together
//   invalidates each key once. A key already being read is not read twice: it gets one trailing read
//   once the running one settles (the running answer may predate the last event). So a burst costs
//   at most one read per key in flight plus one after it, whatever its length.
// - An event that carries the new row of a cached list (invalidation.ts ROW_PATCHES: deal:changed
//   and the deal list) patches the list in the same flush instead of reading it again. Where the
//   patch cannot be exact (a row not listed yet, a list never read or being read), the list is
//   invalidated as before.
import type { Query, QueryClient, QueryKey } from '@tanstack/react-query';
import { hashKey, matchQuery, replaceEqualDeep } from '@tanstack/react-query';
import type { EventName } from '../contract';
import { backend } from '../runtime';
import { MAPPED_EVENTS, eventDealId, rowPatchFor, targetsFor, type Target } from './invalidation';
import { metaDealId } from './keys';

/** A target an event's row can satisfy: the list is patched with `row` instead of read again. */
type Pending = Target & { row?: { id: string } };

type Registration = { key: QueryKey; dealId: string | null; count: number };

export type DataBus = {
  retain(event: EventName): void;
  release(event: EventName): void;
  /** A mounted read that must be read again when `event` fires. Returns the unregister. */
  register(event: EventName, key: QueryKey, dealId: string | null): () => void;
  /** Deliver an event as if Rust sent it (the provider's listeners call this; tests may too). */
  deliver(event: EventName, payload: unknown): void;
  /** Apply the map (invalidation.ts) to delivered events. Off by default: a client applies only the
   *  hooks' own `refreshOn` until a provider that holds the mapped events turns it on (retainMapped). */
  mapped: boolean;
  /** How many invalidations were flushed, and how many event rows were patched into a cached list
   *  instead (for tests and the measurements). */
  readonly stats: { events: number; flushes: number; invalidated: number; trailing: number; patched: number };
  dispose(): void;
};

const buses = new WeakMap<QueryClient, DataBus>();

/** The bus of a client, created on first use. */
export function busOf(client: QueryClient): DataBus {
  let b = buses.get(client);
  if (!b) {
    b = createBus(client);
    buses.set(client, b);
  }
  return b;
}

function matches(q: Query, t: Target): boolean {
  if (!matchQuery({ queryKey: t.key }, q)) return false;
  return t.dealId === undefined || metaDealId(q.meta) === t.dealId;
}

function createBus(client: QueryClient): DataBus {
  const listening = new Map<EventName, { count: number; off: (() => void) | null; dead: boolean }>();
  const registered = new Map<EventName, Map<string, Registration>>();
  const pending: Pending[] = [];
  const trailing = new Set<string>();
  let scheduled = false;
  const stats = { events: 0, flushes: 0, invalidated: 0, trailing: 0, patched: 0 };

  const refresh = (q: Query): void => {
    stats.invalidated += 1;
    void client.invalidateQueries({ queryKey: q.queryKey, exact: true }, { cancelRefetch: false });
  };

  /** Writes `rows` into the cached list at `key` by id; false (nothing written) when that would not be
   *  exactly the list a read would answer: no answer yet, a read under way or owed, or a row the list
   *  does not have (membership is the shell's to say). An unchanged row keeps its object. */
  const patchRows = (key: QueryKey, rows: readonly { id: string }[]): boolean => {
    const q = client.getQueryCache().find({ queryKey: key, exact: true });
    const list = q?.state.data;
    if (!q || !Array.isArray(list) || q.state.fetchStatus === 'fetching' || q.state.isInvalidated || trailing.has(q.queryHash)) return false;
    const at = new Map<unknown, number>();
    list.forEach((r: unknown, i) => at.set((r as { id?: unknown } | null)?.id, i));
    if (!rows.every((r) => at.has(r.id))) return false;
    let next: unknown[] | null = null;
    for (const r of rows) {
      const i = at.get(r.id) as number;
      const cur: unknown = (next ?? list)[i];
      const merged: unknown = replaceEqualDeep(cur, r);
      // A row equal on the wire (an absent field and an undefined one are the same answer) keeps its object.
      if (merged !== cur && JSON.stringify(cur) !== JSON.stringify(r)) {
        next ??= list.slice();
        next[i] = merged;
      }
    }
    if (next) client.setQueryData(key, next);
    stats.patched += rows.length;
    return true;
  };

  const flush = (): void => {
    scheduled = false;
    stats.flushes += 1;
    let targets: Pending[] = pending.splice(0);
    // Rows first: a list the burst's rows patch exactly is not read again; any other is.
    // One row per id per list: the burst's last word on a row wins.
    const rows = new Map<string, { key: QueryKey; rows: Map<string, { id: string }> }>();
    for (const t of targets) {
      if (!t.row) continue;
      const h = hashKey(t.key);
      const g = rows.get(h) ?? { key: t.key, rows: new Map<string, { id: string }>() };
      g.rows.delete(t.row.id);
      g.rows.set(t.row.id, t.row);
      rows.set(h, g);
    }
    if (rows.size) {
      const patched = new Set([...rows].filter(([, g]) => patchRows(g.key, [...g.rows.values()])).map(([h]) => h));
      targets = targets.filter((t) => !(t.row && patched.has(hashKey(t.key))));
    }
    const seen = new Set<string>();
    for (const q of client.getQueryCache().getAll()) {
      if (seen.has(q.queryHash) || !targets.some((t) => matches(q, t))) continue;
      seen.add(q.queryHash);
      if (q.state.fetchStatus === 'fetching') {
        if (!trailing.has(q.queryHash)) stats.trailing += 1;
        trailing.add(q.queryHash);
      } else {
        refresh(q);
      }
    }
  };

  // A read that was running when its event came is read once more after it settles.
  const offCache = client.getQueryCache().subscribe((e) => {
    if (e.type !== 'updated' || !trailing.has(e.query.queryHash)) return;
    if (e.action.type !== 'success' && e.action.type !== 'error') return;
    trailing.delete(e.query.queryHash);
    // After the cache has applied this answer.
    queueMicrotask(() => refresh(e.query));
  });

  const deliver = (event: EventName, payload: unknown): void => {
    stats.events += 1;
    const id = eventDealId(event, payload);
    // The row this event carries satisfies the targets on its list's exact key (map or refreshOn).
    const patch = rowPatchFor(event, payload);
    const patchKey = patch ? hashKey(patch.key) : null;
    const add = (t: Target): void => {
      pending.push(patch && t.dealId === undefined && hashKey(t.key) === patchKey ? { ...t, row: patch.row } : t);
    };
    if (bus.mapped) targetsFor(event, payload).forEach(add);
    for (const r of registered.get(event)?.values() ?? []) {
      // A per-deal read follows only the events about its own deal.
      if (r.dealId !== null && id !== null && r.dealId !== id) continue;
      add({ key: r.key });
    }
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  };

  const retain = (event: EventName): void => {
    const l = listening.get(event);
    if (l) {
      l.count += 1;
      return;
    }
    const entry = { count: 1, off: null as (() => void) | null, dead: false };
    listening.set(event, entry);
    void Promise.resolve()
      .then(() => backend().listen(event, (p) => deliver(event, p)))
      .then(
        (off) => (entry.dead ? off() : (entry.off = off)),
        (e: unknown) => console.error('event subscription failed', event, e),
      );
  };

  const release = (event: EventName): void => {
    const l = listening.get(event);
    if (!l) return;
    l.count -= 1;
    if (l.count > 0) return;
    listening.delete(event);
    l.dead = true;
    l.off?.();
  };

  const bus: DataBus = {
    mapped: false,
    retain,
    release,
    register(event, key, dealId) {
      const hash = hashKey(key);
      const m = registered.get(event) ?? new Map<string, Registration>();
      registered.set(event, m);
      const r = m.get(hash) ?? { key, dealId, count: 0 };
      r.count += 1;
      m.set(hash, r);
      retain(event);
      return () => {
        r.count -= 1;
        if (r.count <= 0) m.delete(hash);
        release(event);
      };
    },
    deliver,
    stats,
    dispose() {
      offCache();
      for (const [event, l] of listening) {
        l.dead = true;
        l.off?.();
        listening.delete(event);
      }
      registered.clear();
      buses.delete(client);
    },
  };
  return bus;
}

/** The events the provider holds for the window's lifetime: everything the map names, with the map
 *  applied to every delivered event while held. */
export function retainMapped(bus: DataBus): () => void {
  bus.mapped = true;
  for (const e of MAPPED_EVENTS) bus.retain(e);
  return () => {
    bus.mapped = false;
    for (const e of MAPPED_EVENTS) bus.release(e);
  };
}

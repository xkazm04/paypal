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
import type { Query, QueryClient, QueryKey } from '@tanstack/react-query';
import { hashKey, matchQuery } from '@tanstack/react-query';
import type { EventName } from '../contract';
import { backend } from '../runtime';
import { MAPPED_EVENTS, eventDealId, targetsFor, type Target } from './invalidation';
import { metaDealId } from './keys';

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
  /** How many invalidations were flushed (for tests and the measurements). */
  readonly stats: { events: number; flushes: number; invalidated: number; trailing: number };
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
  const pending: Target[] = [];
  const trailing = new Set<string>();
  let scheduled = false;
  const stats = { events: 0, flushes: 0, invalidated: 0, trailing: 0 };

  const refresh = (q: Query): void => {
    stats.invalidated += 1;
    void client.invalidateQueries({ queryKey: q.queryKey, exact: true }, { cancelRefetch: false });
  };

  const flush = (): void => {
    scheduled = false;
    stats.flushes += 1;
    const targets = pending.splice(0);
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
    if (bus.mapped) pending.push(...targetsFor(event, payload));
    for (const r of registered.get(event)?.values() ?? []) {
      // A per-deal read follows only the events about its own deal.
      if (r.dealId !== null && id !== null && r.dealId !== id) continue;
      pending.push({ key: r.key });
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

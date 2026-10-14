// One subscription set for the whole Main window: settings, ledger, attention, agent runs and the
// deal_display projection, read through the query layer (lib/data). Events are projections, not
// state: an event marks the reads it affects stale (lib/data/invalidation.ts) and they are read
// again, coalesced.
//
// Two ways to read the World:
//  - narrow selector hooks (useNeeds, useDealLabels, useLocked, useDeals, useSettings, useRuns,
//    useDisplayOf, useWorldHealth, or useWorldSelector for anything else): a component re-renders
//    only when the slice it selected changes;
//  - useWorld(), the whole World at once, kept for the views built on it. It changes identity only
//    when one of its parts changed (each read keeps its answer's identity when the answer is equal),
//    but every useWorld() consumer re-renders on any change. Deprecated: new views select.
import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { AttentionSnapshot } from '@bindings/AttentionSnapshot';
import type { Deal } from '@bindings/Deal';
import type { Module } from '@bindings/Module';
import type { RunSnapshot } from '@bindings/RunSnapshot';
import type { SettingsSnapshot } from '@bindings/SettingsSnapshot';
import type { WalletError } from '../../lib/contract';
import { DataProvider, useHasDataProvider } from '../../lib/data/provider';
import { fallbackDisplay } from '../../lib/display';
import { staleBannerOf, type ReadHealth, type StaleBanner, type StalePart } from '../../shared/boundary/staleBanner';
import { useQuery, type Query } from '../../lib/hooks';
import type { DealDisplay } from '@bindings/DealDisplay';
import { headlineWords, silenceWords } from '../../lib/words';
import { useDisplays } from './displays';
import { moduleOf } from './logic';

export type Display = DealDisplay & { fallback: boolean };

/** What failed among the World's reads. A failed read keeps its last good answer: `stale` says the
 *  window shows such an answer (or shows nothing where a read never answered). The stale banner
 *  (WP2) renders from this; the words are in lib/words.ts. */
export type WorldHealth = {
  settingsError: WalletError | null;
  dealsError: WalletError | null;
  attentionError: WalletError | null;
  runsError: WalletError | null;
  /** The last deal_display pass had a failed read: those deals show the fallback or an older label. */
  displayError: WalletError | null;
  /** Any of the World's list reads failed on its last try. */
  stale: boolean;
};

export type World = {
  settings: Query<SettingsSnapshot>;
  deals: Query<Deal[]>;
  attention: Query<AttentionSnapshot>;
  runs: Query<RunSnapshot[]>;
  /** deal_display per deal, or the honest fallback (short ULID, item_ref) if that read fails. The
   *  same Display object comes back for the same answer, so it can be compared by identity. */
  display: (d: Deal) => Display;
  displayUnavailable: WalletError | null;
  /** True once every deal's display has been read at least once: before it, a label may still arrive. */
  displaysReady: boolean;
  labels: ReadonlyMap<string, string>;
  needs: AttentionItem[];
  needOf: (dealId: string) => AttentionItem | undefined;
  moduleOfDeal: (d: Deal) => Module;
  locked: boolean;
  ready: boolean;
  /** Deal by id, for the selectors. */
  dealById: ReadonlyMap<string, Deal>;
  health: WorldHealth;
  /** Shorthands of health. */
  settingsError: WalletError | null;
  attentionError: WalletError | null;
  runsError: WalletError | null;
  stale: boolean;
};

// ---- the store the selectors read ----------------------------------------------------------------

type Store = { get(): World; subscribe(cb: () => void): () => void; set(w: World): void; notify(): void };

function createStore(initial: World): Store {
  let current = initial;
  const subs = new Set<() => void>();
  return {
    get: () => current,
    subscribe(cb) {
      subs.add(cb);
      return () => { subs.delete(cb); };
    },
    set(w) { current = w; },
    notify() { subs.forEach((f) => f()); },
  };
}

const Ctx = createContext<World | null>(null);
const StoreCtx = createContext<Store | null>(null);

/** The whole World. Deprecated for new views: every consumer re-renders on any World change; use a
 *  selector hook below. */
export function useWorld(): World {
  const w = useContext(Ctx);
  if (!w) throw new Error('useWorld outside WorldProvider');
  return w;
}

/** A slice of the World. The component re-renders only when `isEqual(previous, next)` is false
 *  (identity by default). `select` may be an inline function: it is re-run only when the World or
 *  the function changed, and an equal result keeps the previous one. */
export function useWorldSelector<T>(select: (w: World) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const store = useContext(StoreCtx);
  if (!store) throw new Error('useWorldSelector outside WorldProvider');
  const memo = useRef<{ world: World; select: (w: World) => T; value: T } | null>(null);
  const read = (): T => {
    const world = store.get();
    const m = memo.current;
    if (m && m.world === world && m.select === select) return m.value;
    const next = select(world);
    if (m && isEqual(m.value, next)) {
      memo.current = { world, select, value: m.value };
      return m.value;
    }
    memo.current = { world, select, value: next };
    return next;
  };
  return useSyncExternalStore(store.subscribe, read, read);
}

const selNeeds = (w: World) => w.needs;
const selLabels = (w: World) => w.labels;
const selLocked = (w: World) => w.locked;
const selDeals = (w: World) => w.deals;
const selSettings = (w: World) => w.settings;
const selRuns = (w: World) => w.runs;
const selAttention = (w: World) => w.attention;
const selHealth = (w: World) => w.health;
const selReady = (w: World) => w.ready;

export const useNeeds = (): AttentionItem[] => useWorldSelector(selNeeds);
export const useDealLabels = (): ReadonlyMap<string, string> => useWorldSelector(selLabels);
export const useLocked = (): boolean => useWorldSelector(selLocked);
export const useDeals = (): Query<Deal[]> => useWorldSelector(selDeals);
export const useSettings = (): Query<SettingsSnapshot> => useWorldSelector(selSettings);
export const useRuns = (): Query<RunSnapshot[]> => useWorldSelector(selRuns);
export const useAttention = (): Query<AttentionSnapshot> => useWorldSelector(selAttention);
export const useWorldHealth = (): WorldHealth => useWorldSelector(selHealth);
export const useWorldReady = (): boolean => useWorldSelector(selReady);

/** The display of one deal (its deal_display, or the fallback), or undefined for a deal not listed.
 *  Re-renders only when that deal's display changes. */
export function useDisplayOf(id: string | undefined): Display | undefined {
  const select = useMemo(() => (w: World): Display | undefined => {
    const d = id === undefined ? undefined : w.dealById.get(id);
    return d ? w.display(d) : undefined;
  }, [id]);
  return useWorldSelector(select);
}

/** The attention item of one deal, re-rendering only when it changes. */
export function useNeedOf(id: string | undefined): AttentionItem | undefined {
  const select = useMemo(() => (w: World) => (id === undefined ? undefined : w.needOf(id)), [id]);
  return useWorldSelector(select);
}

/** The World's reads as the stale banner's contract takes them (shared/boundary/staleBanner.ts). */
export function staleReadsOf(w: World): Partial<Record<StalePart, ReadHealth>> {
  return {
    settings: { error: w.settings.error, hasData: w.settings.data !== undefined },
    deals: { error: w.deals.error, hasData: w.deals.data !== undefined },
    attention: { error: w.attention.error, hasData: w.attention.data !== undefined },
    runs: { error: w.runs.error, hasData: w.runs.data !== undefined },
    labels: { error: w.displayUnavailable, hasData: true },
  };
}

const selBanner = (w: World): StaleBanner | null => staleBannerOf(staleReadsOf(w));
const sameBanner = (a: StaleBanner | null, b: StaleBanner | null): boolean =>
  a === b || (!!a && !!b && a.kind === b.kind && a.parts.join('|') === b.parts.join('|'));
/** What the stale banner says now, or null: re-renders only when that changes. */
export const useStaleBanner = (): StaleBanner | null => useWorldSelector(selBanner, sameBanner);

// ---- the provider -------------------------------------------------------------------------------

/** The World of the main window. Mounted under the window's DataProvider (lib/mount.tsx); a tree
 *  mounted without one (a component test) gets a provider of its own that does not retry. */
export function WorldProvider({ children }: { children: ReactNode }) {
  const has = useHasDataProvider();
  if (has) return <WorldState>{children}</WorldState>;
  return (
    <DataProvider retry={false}>
      <WorldState>{children}</WorldState>
    </DataProvider>
  );
}

// Same answer, same Display object: selectors compare by identity.
const shown = new WeakMap<DealDisplay, Display>();
const fallbacks = new WeakMap<Deal, Display>();

function displayFor(map: ReadonlyMap<string, DealDisplay>, d: Deal): Display {
  const x = map.get(d.id);
  if (x) {
    let s = shown.get(x);
    if (!s) { s = { ...x, fallback: false }; shown.set(x, s); }
    return s;
  }
  let f = fallbacks.get(d);
  if (!f) { f = { ...fallbackDisplay(d), fallback: true }; fallbacks.set(d, f); }
  return f;
}

function WorldState({ children }: { children: ReactNode }) {
  const settings = useQuery('get_settings', null, { refreshOn: ['settings:changed'] });
  const deals = useQuery('list_deals', null, { refreshOn: ['deal:changed', 'receipt:created'] });
  const attention = useQuery('attention_list', null, { refreshOn: ['attention:changed', 'deal:changed', 'settings:changed'] });
  const runs = useQuery('agent_runs', null, { refreshOn: ['agent:changed'] });
  // Only the live deals and the deals whose row changed are read again (displays.ts).
  const disp = useDisplays(deals.data);

  // Each part is derived from its own inputs, so an unrelated change keeps its identity.
  const needs = useMemo(
    // Plain-word headlines for every surface of this window (lib/words.ts); ids and amounts are untouched.
    () => (attention.data?.items ?? []).map((n) => ({ ...n, headline: headlineWords(n.headline), on_silence: silenceWords(n.on_silence) })),
    [attention.data],
  );
  const needMap = useMemo(() => new Map(needs.map((n) => [n.deal_id, n])), [needs]);
  const dealById = useMemo(() => new Map((deals.data ?? []).map((d) => [d.id, d])), [deals.data]);
  const display = useMemo(() => (d: Deal): Display => displayFor(disp.map, d), [disp.map]);
  const labels = useMemo(() => new Map((deals.data ?? []).map((d) => [d.id, display(d).label])), [deals.data, display]);
  const needOf = useMemo(() => (id: string) => needMap.get(id), [needMap]);
  const moduleOfDeal = useMemo(() => (d: Deal) => moduleOf(d, needMap.get(d.id)), [needMap]);
  const health = useMemo<WorldHealth>(() => ({
    settingsError: settings.error,
    dealsError: deals.error,
    attentionError: attention.error,
    runsError: runs.error,
    displayError: disp.error,
    stale: !!(settings.error || deals.error || attention.error || runs.error),
  }), [settings.error, deals.error, attention.error, runs.error, disp.error]);

  const world = useMemo<World>(() => ({
    settings, deals, attention, runs,
    display,
    displayUnavailable: disp.error,
    displaysReady: disp.ready,
    labels,
    needs,
    needOf,
    moduleOfDeal,
    locked: !!(attention.data?.locked || settings.data?.locked),
    ready: !!settings.data && !!deals.data && !!attention.data,
    dealById,
    health,
    settingsError: health.settingsError,
    attentionError: health.attentionError,
    runsError: health.runsError,
    stale: health.stale,
  }), [settings, deals, attention, runs, display, disp.error, disp.ready, labels, needs, needOf, moduleOfDeal, dealById, health]);

  // The store holds the World of this render before the children render (so a selector reading it
  // in the same pass sees it), and tells the subscribers after commit (so one that bailed out of
  // this render re-checks its slice).
  const [store] = useState(() => createStore(world));
  store.set(world);
  useLayoutEffect(() => { store.notify(); }, [store, world]);

  return (
    <StoreCtx.Provider value={store}>
      <Ctx.Provider value={world}>{children}</Ctx.Provider>
    </StoreCtx.Provider>
  );
}

// The grid's licence gate (the operator's requirement: a missing or expired key must not harm a table).
// Row grouping is an Enterprise feature of the grid, under a trial key that lives only in the
// operator's untracked .env.local (VITE_AG_LICENSE_KEY). Enterprise is ON only with a key and before
// the trial's end. It is loaded by dynamic import only when ON: an OFF build registers Community only,
// shows no watermark and writes no licence error, and every table works, without the group options.
import { useEffect, useSyncExternalStore } from 'react';
import { ModuleRegistry, type Module } from 'ag-grid-community';

/** The trial ends at 2026-12-09 00:00 UTC. */
export const TRIAL_ENDS_AT = Date.UTC(2026, 11, 9);

/** 'loading' only while the Enterprise chunk is on its way; it ends as one of the other two. */
export type GridTier = 'community' | 'enterprise' | 'loading';

const KEY = import.meta.env.VITE_AG_LICENSE_KEY as string | undefined;

type EnterpriseChunk = { LicenseManager: { setLicenseKey: (key: string) => void }; RowGroupingModule: Module };
export type EnterpriseImporter = () => Promise<EnterpriseChunk>;

// Written on the build's constant, so a build without a key has no such chunk to load.
const importChunk: EnterpriseImporter | null = import.meta.env.VITE_AG_LICENSE_KEY
  ? () => import('ag-grid-enterprise') as unknown as Promise<EnterpriseChunk>
  : null;

/** Whether a key and a clock allow Enterprise (pure). */
export function enterpriseAllowed(key: string | undefined | null, now: number): boolean {
  return !!key?.trim() && now < TRIAL_ENDS_AT;
}

let tier: GridTier = 'community';
let started = false;
const listeners = new Set<() => void>();
const publish = (t: GridTier) => { tier = t; listeners.forEach((l) => l()); };

/** The tier now (Community until something asks for Enterprise and it has loaded). */
export const gridTier = (): GridTier => tier;

/** Loads Enterprise when allowed; never rejects. A failed import stays Community. The arguments are for tests. */
export async function loadEnterprise(key: string | undefined = KEY, now: number = Date.now(), importer: EnterpriseImporter | null = importChunk): Promise<GridTier> {
  if (started) return tier;
  started = true;
  if (!importer || !enterpriseAllowed(key, now)) return tier;
  publish('loading');
  try {
    const chunk = await importer();
    chunk.LicenseManager.setLicenseKey(key as string);
    ModuleRegistry.registerModules([chunk.RowGroupingModule]);
    publish('enterprise');
  } catch {
    // The chunk did not load: every table works on Community, without the group options.
    publish('community');
  }
  return tier;
}

/** Test only: back to the state before anything asked. */
export function resetGridTier(): void { tier = 'community'; started = false; listeners.clear(); }

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The grid's tier; `wanted` asks for Enterprise once (a grid with group options). A grid with no group options keeps 'community'. */
export function useGridTier(wanted: boolean): GridTier {
  const t = useSyncExternalStore(subscribe, gridTier, gridTier);
  useEffect(() => { if (wanted) void loadEnterprise(); }, [wanted]);
  return t;
}

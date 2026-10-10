// One subscription set for the whole Main window: settings, ledger, attention, agent runs and the
// deal_display projection. Events are projections, not state: every event triggers a refetch
// of the snapshot it affects (useQuery subscribes first, then fetches).
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { AttentionSnapshot } from '@bindings/AttentionSnapshot';
import type { Deal } from '@bindings/Deal';
import type { DealEvidence } from '@bindings/DealEvidence';
import type { Module } from '@bindings/Module';
import type { RunSnapshot } from '@bindings/RunSnapshot';
import type { SettingsSnapshot } from '@bindings/SettingsSnapshot';
import { toWalletError, type WalletError } from '../../lib/contract';
import { fallbackDisplay } from '../../lib/display';
import { useQuery, type Query } from '../../lib/hooks';
import type { DealDisplay } from '@bindings/DealDisplay';
import { backend } from '../../lib/runtime';
import { headlineWords, silenceWords } from '../../lib/words';
import { useDisplays } from './displays';
import { moduleOf } from './logic';

export type Display = DealDisplay & { fallback: boolean };

export type World = {
  settings: Query<SettingsSnapshot>;
  deals: Query<Deal[]>;
  attention: Query<AttentionSnapshot>;
  runs: Query<RunSnapshot[]>;
  /** deal_display per deal, or the honest fallback (short ULID, item_ref) if that read fails. */
  display: (d: Deal) => Display;
  displayUnavailable: WalletError | null;
  labels: ReadonlyMap<string, string>;
  needs: AttentionItem[];
  needOf: (dealId: string) => AttentionItem | undefined;
  moduleOfDeal: (d: Deal) => Module;
  locked: boolean;
  ready: boolean;
};

const Ctx = createContext<World | null>(null);

export function useWorld(): World {
  const w = useContext(Ctx);
  if (!w) throw new Error('useWorld outside WorldProvider');
  return w;
}

/** Fetch one read per deal in parallel, keeping per-deal failures (a failed read degrades, never blocks). */
function usePerDeal<T>(cmd: 'deal_display' | 'deal_evidence', deals: Deal[] | undefined, extraKey = ''): { map: Map<string, T>; error: WalletError | null } {
  const [state, setState] = useState<{ map: Map<string, T>; error: WalletError | null }>({ map: new Map(), error: null });
  useEffect(() => {
    if (!deals) return;
    let dead = false;
    void Promise.allSettled(deals.map((d) => backend().invoke(cmd, { deal_id: d.id }))).then((rs) => {
      if (dead) return;
      const map = new Map<string, T>();
      let error: WalletError | null = null;
      rs.forEach((r, i) => {
        const d = deals[i];
        if (!d) return;
        if (r.status === 'fulfilled') map.set(d.id, r.value as T);
        else error = toWalletError(r.reason);
      });
      setState({ map, error });
    });
    return () => { dead = true; };
  }, [cmd, deals, extraKey]);
  return state;
}

/** Evidence for every deal (Book). Refetches with the ledger. */
export function useAllEvidence(deals: Deal[] | undefined, bump: number): { map: Map<string, DealEvidence>; error: WalletError | null } {
  return usePerDeal<DealEvidence>('deal_evidence', deals, String(bump));
}

export function WorldProvider({ children }: { children: ReactNode }) {
  const settings = useQuery('get_settings', null, { refreshOn: ['settings:changed'] });
  const deals = useQuery('list_deals', null, { refreshOn: ['deal:changed', 'receipt:created'] });
  const attention = useQuery('attention_list', null, { refreshOn: ['attention:changed', 'deal:changed', 'settings:changed'] });
  const runs = useQuery('agent_runs', null, { refreshOn: ['agent:changed'] });
  // Only the live deals and the deals whose row changed are read again (displays.ts).
  const disp = useDisplays(deals.data);

  const world = useMemo<World>(() => {
    // Plain-word headlines for every surface of this window (lib/words.ts); ids and amounts are untouched.
    const needs = (attention.data?.items ?? []).map((n) => ({ ...n, headline: headlineWords(n.headline), on_silence: silenceWords(n.on_silence) }));
    const needMap = new Map(needs.map((n) => [n.deal_id, n]));
    const display = (d: Deal): Display => {
      const x = disp.map.get(d.id);
      return x ? { ...x, fallback: false } : { ...fallbackDisplay(d), fallback: true };
    };
    const labels = new Map((deals.data ?? []).map((d) => [d.id, display(d).label]));
    return {
      settings, deals, attention, runs,
      display,
      displayUnavailable: disp.error,
      labels,
      needs,
      needOf: (id) => needMap.get(id),
      moduleOfDeal: (d) => moduleOf(d, needMap.get(d.id)),
      locked: !!(attention.data?.locked || settings.data?.locked),
      ready: !!settings.data && !!deals.data && !!attention.data,
    };
  }, [settings, deals, attention, runs, disp]);

  return <Ctx.Provider value={world}>{children}</Ctx.Provider>;
}

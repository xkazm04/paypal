// spark abstract-first-home round 2: useModuleLists - the six module lists for the side panel.
// Gathers what the console's module pages read (the World's deals, needs, displays and modules, plus
// mandate_list, counterparty_list and rescue_book - all main-window reads, shared through the query
// cache) and hands them to the pure builder (moduleLists.ts). Recomputes when an input changes or the
// minute turns (time-left cells), never on every clock second.
import { useMemo, useSyncExternalStore } from 'react';
import type { Deal } from '@bindings/Deal';
import type { Module } from '@bindings/Module';
import { clockNow, onClockChange } from '../../../../lib/clock';
import { useQuery } from '../../../../lib/hooks';
import { useDeals, useNeeds, useWorldSelector, type World } from '../../world';
import { moduleLists, whoFrom } from './moduleLists';
import type { ModuleList } from './rows';

const NO_DEALS: readonly Deal[] = [];
const selDisplay = (w: World) => w.display;
const selModuleOf = (w: World) => w.moduleOfDeal;

// The minute the lists were cut at: one shared interval, a re-render only when the minute changes
// (or the preview clock jumps).
const minute = {
  subscribe(cb: () => void): () => void {
    const t = setInterval(cb, 15_000);
    const off = onClockChange(cb);
    return () => { clearInterval(t); off(); };
  },
  get: (): number => Math.floor(clockNow() / 60),
};

export function useModuleLists(): Record<Module, ModuleList> {
  const deals = useDeals().data ?? NO_DEALS;
  const needs = useNeeds();
  const display = useWorldSelector(selDisplay);
  const moduleOfDeal = useWorldSelector(selModuleOf);
  const cps = useQuery('counterparty_list', null, { refreshOn: ['deal:changed'] }).data;
  const cp = useMemo(() => whoFrom(cps), [cps]);
  const mandates = useQuery('mandate_list', null, { refreshOn: ['settings:changed', 'deal:changed'] }).data ?? null;
  const rescue = useQuery('rescue_book', null, { refreshOn: ['deal:changed', 'receipt:created', 'attention:changed'] }).data ?? null;
  const min = useSyncExternalStore(minute.subscribe, minute.get, minute.get);
  return useMemo(
    () => moduleLists({ deals, needs, display, moduleOfDeal, who: cp, mandates, rescue, nowSec: Math.max(clockNow(), min * 60) }),
    [deals, needs, display, moduleOfDeal, cp, mandates, rescue, min],
  );
}

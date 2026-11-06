// spark abstract-first-home round 2: useModuleLists - the six module lists for the side panel.
// STUB with the final signature: a generic row per deal from the board model. The rows builder replaces
// the body with each module's own columns (see the round-2 rows brief); consumers must not depend on
// the stub's columns.
import type { Module } from '@bindings/Module';
import { MODULE_KEYS, type Fate } from '../../../../lib/assistant/contract';
import { useBoardModel } from '../../switchboard/useBoardModel';
import type { ModuleList, ModuleRow } from './rows';

const FATE_ORDER: Record<Fate, number> = { needs: 0, moving: 1, stopped: 2, paid: 3 };

export function useModuleLists(): Record<Module, ModuleList> {
  const model = useBoardModel();
  const out = {} as Record<Module, ModuleList>;
  for (const m of MODULE_KEYS) {
    const rows: ModuleRow[] = model.keys
      .filter((k) => k.module === m)
      .map((k) => ({
        id: k.id,
        module: m,
        deal_id: k.id,
        title: k.title,
        cells: [{ text: k.fate, tone: k.fate }],
        sub: k.why,
        fate: k.fate,
        deadline_s: k.deadline_s,
      }))
      .sort((a, b) => (FATE_ORDER[a.fate!] - FATE_ORDER[b.fate!]) || ((a.deadline_s ?? Infinity) - (b.deadline_s ?? Infinity)));
    out[m] = { module: m, columns: ['State'], rows, empty: 'Nothing here yet.' };
  }
  return out;
}

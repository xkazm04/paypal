// STAGE fork (spark abstract-first-home round 2): the navigation state, pure. The side panel is one
// list with a module switcher (All + the six), a title filter and an optional fate filter; the main
// column is either the conversation (open === null) or one item's STAGE (a row, or a panel the
// assistant showed). A reply's ops move this value and one Undo puts it back. No React, no IO.
import type { Module } from '@bindings/Module';
import type { Fate, PanelSpec, UiOp } from '../../../../lib/assistant';
import { MODULE_KEYS } from '../../../../lib/assistant';
import type { ModuleList, ModuleRow } from '../rows/rows';

export type Scope = Module | 'all';

/** What the main column shows instead of the conversation. */
export type Open =
  | { kind: 'row'; module: Module; id: string }
  | { kind: 'panel'; spec: PanelSpec };

export type Nav = {
  scope: Scope;
  query: string;
  fate: Fate | null;
  /** A row the assistant pointed at (focus op): ringed in the list, Enter opens it. `${module}:${id}`. */
  lit: string | null;
  open: Open | null;
};

export const START_NAV: Nav = { scope: 'all', query: '', fate: null, lit: null, open: null };

export const rowKey = (r: Pick<ModuleRow, 'module' | 'id'>): string => `${r.module}:${r.id}`;
export const openKey = (o: Open | null): string | null => (o === null ? null : o.kind === 'row' ? `${o.module}:${o.id}` : `panel:${o.spec.kind}`);

/** Every row of every module, needs first by deadline, then the module's own order. A deal listed in
 *  two modules (the Book lists every deal's money too) shows once, under its own module. */
export function allRows(lists: Record<Module, ModuleList>): ModuleRow[] {
  const out: ModuleRow[] = [];
  const seen = new Set<string>();
  const order = [...MODULE_KEYS.filter((m) => m !== 'book'), ...MODULE_KEYS.filter((m) => m === 'book')];
  for (const m of order) {
    for (const r of lists[m]?.rows ?? []) {
      if (r.deal_id) { if (seen.has(r.deal_id)) continue; seen.add(r.deal_id); }
      out.push(r);
    }
  }
  const needs = out.filter((r) => r.fate === 'needs').sort((a, b) => (a.deadline_s ?? Infinity) - (b.deadline_s ?? Infinity));
  return [...needs, ...out.filter((r) => r.fate !== 'needs')];
}

/** The rows the side panel shows for a scope, title filter and fate filter. */
export function visibleRows(lists: Record<Module, ModuleList>, nav: Pick<Nav, 'scope' | 'query' | 'fate'>): ModuleRow[] {
  const base = nav.scope === 'all' ? allRows(lists) : (lists[nav.scope]?.rows ?? []);
  const q = nav.query.trim().toLowerCase();
  return base.filter((r) => (nav.fate === null || r.fate === nav.fate) && (!q || r.title.toLowerCase().includes(q)));
}

/** The row of a deal, wherever it is listed. */
export function rowOfDeal(lists: Record<Module, ModuleList>, dealId: string): ModuleRow | null {
  for (const m of MODULE_KEYS) {
    const r = lists[m]?.rows.find((x) => x.deal_id === dealId);
    if (r) return r;
  }
  return null;
}

export function findRow(lists: Record<Module, ModuleList>, o: Open | null): ModuleRow | null {
  if (!o || o.kind !== 'row') return null;
  return lists[o.module]?.rows.find((r) => r.id === o.id) ?? null;
}

const openRow = (r: ModuleRow): Open => ({ kind: 'row', module: r.module, id: r.id });

/**
 * A reply's layout ops applied to the navigation: `filter` scopes the list (module and fate),
 * `focus` scopes it and rings the named deal's row, `show` of a deal or decision opens that row's
 * stage, any other `show` opens the panel as the stage. `propose` is the Proposals' business.
 */
export function applyOps(nav: Nav, ops: readonly UiOp[], lists: Record<Module, ModuleList>): Nav {
  let n = nav;
  for (const op of ops) {
    if (op.op === 'filter') n = { ...n, scope: op.module ?? 'all', fate: op.fate, query: '', lit: null };
    else if (op.op === 'focus') {
      const r = op.deal_id ? rowOfDeal(lists, op.deal_id) : null;
      const scope: Scope = op.module ?? r?.module ?? 'all';
      n = { ...n, scope, fate: r ? null : op.fate, query: '', lit: r ? rowKey(r) : null };
    } else if (op.op === 'show') {
      const p = op.panel;
      if (p.kind === 'deal' || p.kind === 'decision') {
        const r = rowOfDeal(lists, p.deal_id);
        n = r ? { ...n, open: openRow(r), lit: null, scope: n.scope === 'all' || n.scope === r.module ? n.scope : r.module } : n;
      } else n = { ...n, open: { kind: 'panel', spec: p } };
    }
  }
  return n;
}

export function sameNav(a: Nav, b: Nav): boolean {
  return a.scope === b.scope && a.query === b.query && a.fate === b.fate && a.lit === b.lit && openKey(a.open) === openKey(b.open)
    && (a.open?.kind !== 'panel' || b.open?.kind !== 'panel' || JSON.stringify(a.open.spec) === JSON.stringify(b.open.spec));
}

/**
 * Prototype-only `?fs_pick=<module|all>:<rowId|index>`: open a row headless (screenshots, tests).
 * An index counts in the scope's visible order; an unknown module or row is ignored.
 */
export function pickFromSearch(search: string, lists: Record<Module, ModuleList>): Nav | null {
  const raw = new URLSearchParams(search).get('fs_pick');
  if (!raw) return null;
  const i = raw.indexOf(':');
  const scopeWord = i < 0 ? raw : raw.slice(0, i);
  const which = i < 0 ? '0' : raw.slice(i + 1);
  const scope: Scope | null = scopeWord === 'all' ? 'all' : (MODULE_KEYS as readonly string[]).includes(scopeWord) ? (scopeWord as Module) : null;
  if (!scope) return null;
  const rows = visibleRows(lists, { scope, query: '', fate: null });
  const r = rows.find((x) => x.id === which) ?? (/^\d+$/.test(which) ? rows[Number(which)] : undefined);
  if (!r) return null;
  return { ...START_NAV, scope, open: openRow(r) };
}

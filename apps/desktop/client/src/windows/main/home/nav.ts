// The home's navigation state, pure (docs/design/abstract-first-home.md). The side panel is one list
// with a module switcher (All + the six), a title filter and an optional fate filter; the main column
// is either the conversation (open === null) or one item's page (a row or a panel). A reply moves only
// the side list (routeReply below); one Undo puts it back.
// No React, no IO.
import type { Module } from '@bindings/Module';
import type { Fate, PanelSpec, UiOp } from '../../../lib/assistant';
import { MODULE_KEYS } from '../../../lib/assistant';
import type { ModuleList, ModuleRow } from './rows/rows';

export type Scope = Module | 'all';

/** What the main column shows instead of the conversation: a row's page or a panel as a page. */
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

export const openRow = (r: Pick<ModuleRow, 'module' | 'id'>): Open => ({ kind: 'row', module: r.module, id: r.id });

/**
 * THE ROUTING RULE (round 3). Main is the owner's: only she moves it, and a reply never yanks it away.
 *
 *  Main changes to a page ONLY when
 *   - she clicks a side row (or Enter on it, or Enter in the filter),
 *   - she clicks a link inside a turn: the first need's "Details", a deal inside an inline panel, or
 *     the "Open <title>" link of a reply that targets one deal,
 *   - the setup guide calls GuideHost.pick (guide/host.ts),
 *  and it returns to the conversation on the Today crumb, Esc, GuideHost.back / say, a setup step
 *  being shown, or the return after an act or the approval window (Home: `returnToToday`).
 *
 *  A reply (to a chip or a typed question) stays IN the conversation:
 *   - every `show` renders inline in that reply's turn (the board's Answer renderers, compact);
 *   - a `show` of a decision or a deal for ONE deal_id also offers `link` = that deal's row page,
 *     which the turn draws as "Open <title>": no automatic navigation;
 *   - `filter` / `focus` still scope the side list and ring a deal's row (one Undo puts them back);
 *   - `propose` is the Proposals' business.
 */
export type Routed = {
  /** The navigation after the reply: only the side list (scope, fate, query, lit) can differ. */
  nav: Nav;
  /** The panels the reply's turn renders inline, in op order, each once. */
  panels: PanelSpec[];
  /** The one deal the reply targets (show decision/deal for a single deal_id), as a page to offer. */
  link: Open | null;
};

export function routeReply(nav: Nav, ops: readonly UiOp[], lists: Record<Module, ModuleList>): Routed {
  let n = nav;
  const panels: PanelSpec[] = [];
  const seen = new Set<string>();
  const dealIds = new Set<string>();
  for (const op of ops) {
    if (op.op === 'filter') n = { ...n, scope: op.module ?? 'all', fate: op.fate, query: '', lit: null };
    else if (op.op === 'focus') {
      const r = op.deal_id ? rowOfDeal(lists, op.deal_id) : null;
      const scope: Scope = op.module ?? r?.module ?? 'all';
      n = { ...n, scope, fate: r ? null : op.fate, query: '', lit: r ? rowKey(r) : null };
    } else if (op.op === 'show') {
      const k = JSON.stringify(op.panel);
      if (!seen.has(k)) { seen.add(k); panels.push(op.panel); }
      if (op.panel.kind === 'deal' || op.panel.kind === 'decision') dealIds.add(op.panel.deal_id);
    }
  }
  const only = dealIds.size === 1 ? rowOfDeal(lists, [...dealIds][0] as string) : null;
  return { nav: { ...n, open: nav.open }, panels, link: only ? openRow(only) : null };
}

/** The side list's part of a reply (filter / focus); main is left as it is. */
export function applyOps(nav: Nav, ops: readonly UiOp[], lists: Record<Module, ModuleList>): Nav {
  return routeReply(nav, ops, lists).nav;
}

export function sameNav(a: Nav, b: Nav): boolean {
  return a.scope === b.scope && a.query === b.query && a.fate === b.fate && a.lit === b.lit && openKey(a.open) === openKey(b.open)
    && (a.open?.kind !== 'panel' || b.open?.kind !== 'panel' || JSON.stringify(a.open.spec) === JSON.stringify(b.open.spec));
}

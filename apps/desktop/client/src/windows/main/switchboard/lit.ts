// What is lit on the board, as one pure value (spark the-proof-table, WP0 contract; WP2 implements).
//
// - Filter and Highlight are the reply's light, as the wire carries it (one module, one fate, one deal);
//   they moved here from Matrix.tsx so the board column and the region share them without the Matrix.
// - A LitSet is what the board actually lights: any set of rows, columns, cells and deals. A reply's
//   light becomes one through litFromArrangement; a figure in the sentence carries its own (figures.ts),
//   and hovering or focusing that figure lights it. That hover state is the board's own, local and never
//   an op: the wire cannot express a set, and the owner's eye does not change the arrangement.
// - The sum line ("2 + 1 + 1 + 1 + 1 = 6 deals lit") and the lit keys are reads of a LitSet over the model.
// Pure: no React, no IO.
import type { Module } from '@bindings/Module';
import { FATES, MODULE_KEYS, type Fate } from '../../../lib/assistant';
import type { Arrangement } from './region';
import type { BoardKey, BoardModel } from './useBoardModel';

export type Filter = { module: Module | null; fate: Fate | null };
export type Highlight = { module: Module | null; fate: Fate | null; deal_id: string | null };
export const NO_FILTER: Filter = { module: null, fate: null };

/** Does a key pass the filter (a dimmed key is still drawn and still clickable). */
export const passes = (f: Filter, module: Module, fate: Fate): boolean => (!f.module || f.module === module) && (!f.fate || f.fate === fate);

/** A figure's or a cell's colour, by meaning (the tokens' fixed colour meaning, tokens.css header). */
export type Tone = 'gold' | 'teal' | 'coral' | 'refuse' | 'ok' | 'market';

/** A fate's tone: needs you is gold, moving teal, stopped refuse, paid ok (tokens.css colour meaning). */
export const FATE_TONE: Record<Fate, Tone> = { needs: 'gold', moving: 'teal', stopped: 'refuse', paid: 'ok' };

export type LitSet = {
  readonly rows: readonly Module[];
  readonly cols: readonly Fate[];
  readonly cells: readonly (readonly [Module, Fate])[];
  readonly deals: readonly string[];
};

export const NO_LIT: LitSet = { rows: [], cols: [], cells: [], deals: [] };

/** The per-module counts of the lit cells, MODULE_KEYS order, zero rows omitted, and their total. Null when nothing is lit. */
export type SumLine = { readonly terms: readonly number[]; readonly total: number } | null;

const isEmpty = (l: LitSet): boolean => l.rows.length === 0 && l.cols.length === 0 && l.cells.length === 0 && l.deals.length === 0;

/** A module and/or a fate as a LitSet: both is the cell, a module alone the row, a fate alone the column. */
export function litOf(module: Module | null, fate: Fate | null): LitSet {
  if (module && fate) return { ...NO_LIT, cells: [[module, fate]] };
  if (module) return { ...NO_LIT, rows: [module] };
  if (fate) return { ...NO_LIT, cols: [fate] };
  return NO_LIT;
}

/** One deal and its cell. */
export const litDeal = (k: Pick<BoardKey, 'id' | 'module' | 'fate'>): LitSet => ({ ...NO_LIT, cells: [[k.module, k.fate]], deals: [k.id] });

/** The highlight alone. A deal the board knows lights the deal and its cell (its module and fate are
 *  only its address); a deal it no longer knows lights what the module and fate name, if anything. */
function litOfHighlight(h: Highlight, model: BoardModel): LitSet {
  const k = h.deal_id ? model.byId.get(h.deal_id) : undefined;
  return k ? litDeal(k) : litOf(h.module, h.fate);
}

/** What a reply's filter and highlight light, as a LitSet over the model.
 *
 *  HOW THE FILTER COMBINES WITH THE HIGHLIGHT (decision, spark the-proof-table WP2):
 *  - highlight only: the highlight (module alone = row, fate alone = column, both = cell, a deal = the
 *    deal and its cell).
 *  - filter only: what the filter leaves undimmed is what the board is showing, so it is lit the same way
 *    (the owner's "Show only Spend" lights the Spend row, and the sum line counts it).
 *  - both: the part of the highlight the filter leaves undimmed. A light never falls on a dimmed key, so
 *    "filter Spend + light Needs you" lights the one cell Spend x Needs you.
 *  - both, and they do not meet (filter Spend, light a Tables deal): the highlight wins as is. A light
 *    never hides anything and a dimmed key is still drawn, and the light is the reply's own, narrower
 *    statement of what it is about; lighting nothing would hide the very thing it named. */
export function litFromArrangement(a: Pick<Arrangement, 'filter' | 'highlight'>, model: BoardModel): LitSet {
  const f = a.filter;
  const fromFilter = litOf(f.module, f.fate);
  const fromHighlight = a.highlight ? litOfHighlight(a.highlight, model) : NO_LIT;
  if (isEmpty(fromHighlight)) return fromFilter;
  if (isEmpty(fromFilter)) return fromHighlight;
  const h = a.highlight!;
  // A known deal: undimmed, it is the part of the highlight the filter leaves; dimmed, the highlight
  // wins as is. Either way the deal and its cell.
  if (h.deal_id && model.byId.has(h.deal_id)) return fromHighlight;
  const m = meet(h.module, f.module);
  const fate = meet(h.fate, f.fate);
  if (m === false || fate === false) return fromHighlight;
  return litOf(m, fate);
}

/** Two coordinates on one axis: the narrower one, or false when both are set and differ. */
function meet<T>(x: T | null, y: T | null): T | null | false {
  if (x !== null && y !== null) return x === y ? x : false;
  return x ?? y;
}

/** Is this cell lit: named as a cell, or its row or its column is lit. */
export function isCellLit(lit: LitSet, module: Module, fate: Fate): boolean {
  return lit.rows.includes(module) || lit.cols.includes(fate) || lit.cells.some(([m, f]) => m === module && f === fate);
}

/** Needs-you keys soonest deadline first (none last), then most recent, then label: the board's order. */
const byUrgency = (a: BoardKey, b: BoardKey): number =>
  (a.deadline_s ?? Infinity) - (b.deadline_s ?? Infinity) || (b.stamp_s ?? 0) - (a.stamp_s ?? 0) || a.label.localeCompare(b.label);

/** The deals a LitSet lights. When it names deals, those deals and only those: the cell lit beside a
 *  named deal is its address, not more deals (one deal lit reads "1", not its cell's count). Otherwise
 *  every key in a lit cell. Deals the board does not know are skipped; each deal counts once. */
function litDeals(lit: LitSet, model: BoardModel): BoardKey[] {
  if (lit.deals.length) {
    const seen = new Set<string>();
    const out: BoardKey[] = [];
    for (const id of lit.deals) {
      const k = model.byId.get(id);
      if (k && !seen.has(id)) { seen.add(id); out.push(k); }
    }
    return out;
  }
  return MODULE_KEYS.flatMap((m) => FATES.flatMap((f) => (isCellLit(lit, m, f) ? model.cells[m][f].keys : [])));
}

/** The sum line: per-module counts of the lit deals in MODULE_KEYS order, zero rows omitted, and the
 *  total. Null when nothing is lit; a lit set over empty cells is `{ terms: [], total: 0 }`. */
export function sumLine(lit: LitSet, model: BoardModel): SumLine {
  if (isEmpty(lit)) return null;
  const per = new Map<Module, number>();
  for (const k of litDeals(lit, model)) per.set(k.module, (per.get(k.module) ?? 0) + 1);
  const terms = MODULE_KEYS.map((m) => per.get(m) ?? 0).filter((n) => n > 0);
  return { terms, total: terms.reduce((s, n) => s + n, 0) };
}

/** The lit deals, soonest first, at most `max` (default 6). */
export function litKeys(lit: LitSet, model: BoardModel, max = 6): BoardKey[] {
  if (isEmpty(lit) || max <= 0) return [];
  return [...litDeals(lit, model)].sort(byUrgency).slice(0, max);
}

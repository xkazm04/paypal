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
import type { Fate } from '../../../lib/assistant';
import type { Arrangement } from './region';
import type { BoardKey, BoardModel } from './useBoardModel';

export type Filter = { module: Module | null; fate: Fate | null };
export type Highlight = { module: Module | null; fate: Fate | null; deal_id: string | null };
export const NO_FILTER: Filter = { module: null, fate: null };

/** Does a key pass the filter (a dimmed key is still drawn and still clickable). */
export const passes = (f: Filter, module: Module, fate: Fate): boolean => (!f.module || f.module === module) && (!f.fate || f.fate === fate);

/** A figure's or a cell's colour, by meaning (the tokens' fixed colour meaning, tokens.css header). */
export type Tone = 'gold' | 'teal' | 'coral' | 'refuse' | 'ok' | 'market';

export type LitSet = {
  readonly rows: readonly Module[];
  readonly cols: readonly Fate[];
  readonly cells: readonly (readonly [Module, Fate])[];
  readonly deals: readonly string[];
};

export const NO_LIT: LitSet = { rows: [], cols: [], cells: [], deals: [] };

/** The per-module counts of the lit cells, MODULE_KEYS order, zero rows omitted, and their total. Null when nothing is lit. */
export type SumLine = { readonly terms: readonly number[]; readonly total: number } | null;

/** What a reply's filter and highlight light, as a LitSet over the model. WP2. */
export function litFromArrangement(_a: Pick<Arrangement, 'filter' | 'highlight'>, _model: BoardModel): LitSet {
  return NO_LIT;
}

/** Is this cell lit: named as a cell, or its row or its column is lit. WP2. */
export function isCellLit(_lit: LitSet, _module: Module, _fate: Fate): boolean {
  return false;
}

/** WP2. */
export function sumLine(_lit: LitSet, _model: BoardModel): SumLine {
  return null;
}

/** The lit deals, soonest first, at most `max` (default 6). WP2. */
export function litKeys(_lit: LitSet, _model: BoardModel, _max = 6): BoardKey[] {
  return [];
}

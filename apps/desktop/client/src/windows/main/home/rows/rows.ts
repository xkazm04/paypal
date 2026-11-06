// spark abstract-first-home round 2: the per-module row contract the side panel lists render.
// One row per item, one line by default; `sub` is an optional second line a variant may hide.
// Every figure in a row comes from the world (deals, mandates, needs), never from the assistant.
import type { Module } from '@bindings/Module';
import type { Fate } from '../../../../lib/assistant/contract';

/** Tone of a cell: the fate palette plus warn (a risk or a refusal) and quiet (no emphasis). */
export type CellTone = Fate | 'warn' | 'quiet';

/** One cell of a row. `num` right-aligns with tabular figures; `tone` colours it from tokens only. */
export type RowCell = { text: string; tone?: CellTone; num?: boolean };

export type ModuleRow = {
  /** Stable key inside the module (a deal id, or `<kind>:<id>` for a non-deal row such as a catalog item). */
  id: string;
  module: Module;
  /** The deal this row is, or null for a non-deal row (a catalog item, a rule). Click effects use it. */
  deal_id: string | null;
  /** The row's name in the owner's words (deal_display title, product, merchant...). */
  title: string;
  /** The module's own key metadata, in the order of ModuleList.columns. */
  cells: RowCell[];
  /** Optional second line; null when the one line says it all. */
  sub: string | null;
  /** Fate on the board, or null for a non-deal row. */
  fate: Fate | null;
  /** Unix seconds of the row's deadline (needs-you rows), else null. Sorting uses it first. */
  deadline_s: number | null;
};

export type ModuleList = {
  module: Module;
  /** Column headers, one per cell (the title column is implicit and first). */
  columns: string[];
  /** Sorted: needs by deadline, then moving, stopped, paid; newest first within a fate. */
  rows: ModuleRow[];
  /** Words for an empty module. */
  empty: string;
};

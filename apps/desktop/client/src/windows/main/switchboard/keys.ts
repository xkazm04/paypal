// The board's one keymap (spark the-proof-table). Every binding the board answers is declared here
// once; the page's key handler (Switchboard.tsx) dispatches the page bindings from this table, the
// board column (BoardColumn.tsx) moves on the arrows with `stepGrid`, and the keys help sheet
// (Earlier.tsx) lists this same table. Enter and Tab are the browser's own (a cell is a native
// button; Tab walks the page) and are declared so the help is the whole truth.
// Pure: no React, no IO.
import { BOARD_KEYS } from '../../../lib/words/board';

export type BoardKeyId = 'ask' | 'clear' | 'help' | 'move' | 'light' | 'tab';
/** page: the board's document handler runs it; grid: the board column runs it; native: the browser. */
export type KeyScope = 'page' | 'grid' | 'native';
export type BoardBinding = { readonly id: BoardKeyId; readonly keys: readonly string[]; readonly shown: string; readonly label: string; readonly scope: KeyScope };

export const BOARD_KEYMAP: readonly BoardBinding[] = [
  { id: 'ask', keys: ['/'], shown: '/', label: BOARD_KEYS.slash, scope: 'page' },
  { id: 'clear', keys: ['Escape'], shown: 'Esc', label: BOARD_KEYS.escape, scope: 'page' },
  { id: 'help', keys: ['?'], shown: '?', label: BOARD_KEYS.help, scope: 'page' },
  { id: 'move', keys: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'], shown: BOARD_KEYS.arrowsShown, label: BOARD_KEYS.arrows, scope: 'grid' },
  { id: 'light', keys: ['Enter'], shown: 'Enter', label: BOARD_KEYS.enter, scope: 'native' },
  { id: 'tab', keys: ['Tab'], shown: 'Tab', label: BOARD_KEYS.tab, scope: 'native' },
];

/** The binding a key press means in a scope, or null. */
export function bindingOf(key: string, scope: KeyScope): BoardKeyId | null {
  return BOARD_KEYMAP.find((b) => b.scope === scope && b.keys.includes(key))?.id ?? null;
}

/** The board column as a grid of stops: row 0 holds the four column heads (columns 1-4), column 0
 *  the six row heads (rows 1-6), and the cells sit at rows 1-6, columns 1-4. The corner (0, 0) is not
 *  a stop. */
export const GRID_ROWS = 7;
export const GRID_COLS = 5;
export type GridPos = readonly [row: number, col: number];

const STEP: Readonly<Record<string, GridPos>> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };

/** Where an arrow goes from a stop: one step that way, skipping the corner; null at the edge. */
export function stepGrid(from: GridPos, key: string): GridPos | null {
  const d = STEP[key];
  if (!d) return null;
  let [r, c] = from;
  for (;;) {
    r += d[0];
    c += d[1];
    if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) return null;
    if (r !== 0 || c !== 0) return [r, c];
  }
}

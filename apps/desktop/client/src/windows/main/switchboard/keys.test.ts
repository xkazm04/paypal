// The board's one keymap: each key means one thing, and the arrows walk the board column's grid.
import { describe, expect, it } from 'vitest';
import { BOARD_KEYMAP, bindingOf, GRID_COLS, GRID_ROWS, stepGrid } from './keys';

describe('the keymap', () => {
  it('no key is bound twice', () => {
    const keys = BOARD_KEYMAP.flatMap((b) => b.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('the page answers `/`, Esc and `?`; the arrows belong to the grid; Enter and Tab are the browser\'s', () => {
    expect([bindingOf('/', 'page'), bindingOf('Escape', 'page'), bindingOf('?', 'page')]).toEqual(['ask', 'clear', 'help']);
    expect(bindingOf('ArrowUp', 'page')).toBeNull();
    expect(bindingOf('ArrowUp', 'grid')).toBe('move');
    expect(BOARD_KEYMAP.filter((b) => b.scope === 'native').map((b) => b.id)).toEqual(['light', 'tab']);
  });
});

describe('stepGrid', () => {
  it('moves one stop and stops at the edges', () => {
    expect(stepGrid([1, 1], 'ArrowRight')).toEqual([1, 2]);
    expect(stepGrid([1, 1], 'ArrowDown')).toEqual([2, 1]);
    expect(stepGrid([GRID_ROWS - 1, GRID_COLS - 1], 'ArrowDown')).toBeNull();
    expect(stepGrid([GRID_ROWS - 1, GRID_COLS - 1], 'ArrowRight')).toBeNull();
  });
  it('heads are stops; the corner is not', () => {
    expect(stepGrid([1, 1], 'ArrowUp')).toEqual([0, 1]);
    expect(stepGrid([1, 1], 'ArrowLeft')).toEqual([1, 0]);
    expect(stepGrid([1, 0], 'ArrowUp')).toBeNull();
    expect(stepGrid([0, 1], 'ArrowLeft')).toBeNull();
  });
  it('ignores other keys', () => { expect(stepGrid([1, 1], 'Enter')).toBeNull(); });
});

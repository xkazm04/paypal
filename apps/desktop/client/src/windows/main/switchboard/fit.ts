// How many keys a switchboard cell can show. Pure, so it is tested without a browser. The board never
// scrolls: a cell that has more keys than room shows as many as fit, then one "+n more" key that filters
// to the whole cell. Heights are the ones switchboard.css gives the keys (kept together on purpose).
import type { BoardKey } from './useBoardModel';

export type Density = 'full' | 'compact';

/** Key heights in px, by density. A needs-you key carries one more line: "If you do nothing". */
export const KEY_H = { full: { needs: 66, other: 46 }, compact: { needs: 52, other: 28 } } as const;
export const KEY_GAP = 4;
export const MORE_H = 24;
/** Cell padding, top and bottom together. */
export const CELL_PAD = 12;
/** Without a measured size (a test, the first paint) a cell shows this many keys. */
export const DEFAULT_VISIBLE = 3;

export const keyHeight = (k: Pick<BoardKey, 'fate'>, d: Density): number => (k.fate === 'needs' ? KEY_H[d].needs : KEY_H[d].other);

/** Height of all keys with the gaps between them. */
export function stackHeight(keys: readonly Pick<BoardKey, 'fate'>[], d: Density): number {
  return keys.reduce((s, k, i) => s + keyHeight(k, d) + (i ? KEY_GAP : 0), 0);
}

/** How many of `keys` fit in `avail` px (the cell's inner height). At least one key is always shown;
 *  when some are left out, room for the "+n more" key is kept. `avail` null = not measured. */
export function visibleCount(keys: readonly Pick<BoardKey, 'fate'>[], avail: number | null, d: Density): number {
  if (!keys.length) return 0;
  if (avail === null) return Math.min(keys.length, DEFAULT_VISIBLE);
  if (stackHeight(keys, d) <= avail) return keys.length;
  let used = 0;
  let n = 0;
  for (const k of keys) {
    const next = used + (n ? KEY_GAP : 0) + keyHeight(k, d);
    if (next + KEY_GAP + MORE_H > avail) break;
    used = next;
    n += 1;
  }
  return Math.max(1, n);
}

/** Full keys when every cell fits at full height, else compact keys. */
export function pickDensity(cells: readonly (readonly Pick<BoardKey, 'fate'>[])[], avail: number | null): Density {
  if (avail === null) return 'full';
  return cells.every((c) => stackHeight(c, 'full') <= avail) ? 'full' : 'compact';
}

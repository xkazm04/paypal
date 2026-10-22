// Find's index and ranking (pure). The index is built once per change of what it lists (the
// needs, the deals and their names), never per keystroke; a search is one substring pass over the
// prebuilt lowercased text, in the order the old Ctrl K palette ranked (its groups in order, the
// items in each group in their own order), capped. A deal's label ("D-0193") is searched but not
// shown: ids stay off the first layers.
import type { Module } from '@bindings/Module';
import type { DemoState } from '../../../lib/preview';
import type { SetupStepKey } from '../../../lib/words';
import type { Route } from '../logic';

export type FindGroup = 'needs' | 'modules' | 'deals' | 'places';
export const FIND_ORDER: readonly FindGroup[] = ['needs', 'modules', 'deals', 'places'];

export type FindTarget =
  | { kind: 'need'; deal: string }
  | { kind: 'module'; module: Module }
  | { kind: 'deal'; deal: string }
  | { kind: 'route'; route: Route }
  | { kind: 'setup'; step: SetupStepKey }
  | { kind: 'quit' }
  /** Demo mode's switcher (DemoSwitch.tsx): a sample world, or null for the live wallet. */
  | { kind: 'demo'; state: DemoState | null };

export type FindItem = {
  key: string;
  group: FindGroup;
  title: string;
  sub: string;
  /** Searched, never shown (a deal's label). */
  also?: string;
  /** A key hint shown at the row's end ("1".."6" for the modules). */
  hint?: string;
  /** A module colour for the row's dot (a CSS value). */
  color?: string;
  target: FindTarget;
};

export type FindIndex = { items: readonly FindItem[]; hay: readonly string[] };

/** Prebuilds the lowercased text of every item, grouped in ranking order (stable within a group). */
export function buildIndex(items: readonly FindItem[]): FindIndex {
  const ordered = FIND_ORDER.flatMap((g) => items.filter((i) => i.group === g));
  return { items: ordered, hay: ordered.map((i) => `${i.title} ${i.sub} ${i.also ?? ''}`.toLowerCase()) };
}

/** The items matching `q`, at most `cap`. An empty query lists a few rows of every group (an even
 *  share each, the spare going to the groups with more, in order), so a long deal tail never hides
 *  the places: Find is how the owner reaches them. */
export function searchIndex(index: FindIndex, q: string, cap = FIND_CAP): FindItem[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return spread(index, cap);
  const out: FindItem[] = [];
  for (let i = 0; i < index.items.length && out.length < cap; i++) {
    const item = index.items[i];
    if (item && (!needle || (index.hay[i] ?? '').includes(needle))) out.push(item);
  }
  return out;
}

function spread(index: FindIndex, cap: number): FindItem[] {
  if (index.items.length <= cap) return [...index.items];
  const groups = FIND_ORDER.map((g) => index.items.filter((i) => i.group === g)).filter((rows) => rows.length);
  const share = Math.floor(cap / Math.max(1, groups.length));
  const take = groups.map((rows) => Math.min(rows.length, share));
  let spare = cap - take.reduce((a, b) => a + b, 0);
  for (let g = 0; g < groups.length && spare > 0; g++) {
    const more = Math.min(spare, (groups[g]?.length ?? 0) - (take[g] ?? 0));
    take[g] = (take[g] ?? 0) + more;
    spare -= more;
  }
  return groups.flatMap((rows, g) => rows.slice(0, take[g] ?? 0));
}

/** How many items match `q` in all (the cap aside): Find's footer names it beside what it shows. */
export function matchCount(index: FindIndex, q: string): number {
  const needle = q.trim().toLowerCase();
  if (!needle) return index.items.length;
  let n = 0;
  for (const h of index.hay) if (h.includes(needle)) n++;
  return n;
}

/** The most rows Find shows at once (the old palette's 40). */
export const FIND_CAP = 40;

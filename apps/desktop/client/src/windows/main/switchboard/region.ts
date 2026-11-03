// The composition region: the part of the board the assistant may change, as one pure value.
// (registry golden path model-composed-workspace: composition-region, arrangement-memory,
// reversible-screen-ops.)
//
// - The region is an ordered list of at most REGION_MAX answer panels, oldest first. A `show` ADDS a
//   panel; a panel equal to one already there (same kind and identity fields, `panelKey`) is not
//   duplicated and does not move: it stays where it is and becomes the focus. Copy, don't move.
// - When the region is full, the oldest UNPINNED panel leaves. The owner may pin at most PIN_MAX
//   panels, so one slot is always free for the next answer and a pin never silences the assistant.
// - Pins are the owner's standing instruction to every later composition: no reply removes a pinned
//   panel, and no reply can pin or unpin (the wire has no such op). Their scope is the board session,
//   the task: Back to the overview (Esc) clears the region and its pins, and nothing is stored.
// - `Arrangement` is everything a reply may change on screen: the region, its focus, the filter and
//   the light. `applyLayout` applies a reply's layout ops to it, `diffArrangement` says what changed,
//   and the board keeps the arrangement from before the last applied reply for its one-step undo.
// Pure: no React, no IO; Switchboard.tsx owns the state and the owner's moves.
import type { Module } from '@bindings/Module';
import type { Fate, PanelSpec, UiOp } from '../../../lib/assistant';
import { REGION_MAX } from '../../../lib/assistant/vocabulary';
import type { Filter, Highlight } from './lit';

export { REGION_MAX };
/** At most this many pinned panels: one slot always stays free for the assistant's next answer. */
export const PIN_MAX = REGION_MAX - 1;

export type RegionPanel = { readonly spec: PanelSpec; readonly pinned: boolean };
export type Region = readonly RegionPanel[];

/** A fixed position on screen for an answer (spark the-proof-table). */
export type Slot = 0 | 1 | 2;

/** The region laid out by slot: index = Slot, null = an empty slot. Length REGION_MAX. A panel keeps
 *  its slot for as long as it stays; a new panel takes the evicted panel's slot, else the lowest free
 *  one. WP0 stub: index order; WP2 implements stable slots. */
export function slotsOf(region: Region): (RegionPanel | null)[] {
  return Array.from({ length: REGION_MAX }, (_, i) => region[i] ?? null);
}

export type Arrangement = {
  readonly region: Region;
  /** The key of the panel this turn (or the owner's last move) is about; null when the region is empty. */
  readonly focus: string | null;
  readonly filter: Filter;
  readonly highlight: Highlight | null;
};

export const EMPTY_ARRANGEMENT: Arrangement = { region: [], focus: null, filter: { module: null, fate: null }, highlight: null };

/** A panel's identity: its kind plus the fields that say what it shows. */
export function panelKey(p: PanelSpec): string {
  switch (p.kind) {
    case 'needs': return `needs:${p.module ?? '*'}`;
    case 'rules': return `rules:${p.module ?? '*'}`;
    case 'decision': return `decision:${p.deal_id}`;
    case 'deal': return `deal:${p.deal_id}`;
    case 'book': return `book:${p.module ?? '*'}:${p.fate ?? '*'}`;
    case 'money':
    case 'rescue':
    case 'safety':
    case 'week':
    case 'setup':
      return p.kind;
  }
}

const has = (r: Region, key: string): boolean => r.some((x) => panelKey(x.spec) === key);
const lastKey = (r: Region): string | null => (r.length ? panelKey(r[r.length - 1]!.spec) : null);
/** The focus stays on its panel while that panel is there; else it falls to the newest panel. */
const keepFocus = (r: Region, focus: string | null): string | null => (focus !== null && has(r, focus) ? focus : lastKey(r));

/** Put a panel in the region by the region's rules (add, or focus the one already there; evict the
 *  oldest unpinned panel when full). Used by the assistant's `show` and the owner's own opens alike. */
export function place(a: Arrangement, spec: PanelSpec): Arrangement {
  const key = panelKey(spec);
  if (has(a.region, key)) return { ...a, focus: key };
  let region: RegionPanel[] = [...a.region, { spec, pinned: false }];
  while (region.length > REGION_MAX) {
    const oldest = region.findIndex((x) => !x.pinned);
    // Unreachable while pins are capped at PIN_MAX; kept so the cap holds even if they were not.
    if (oldest < 0) break;
    region = region.filter((_, i) => i !== oldest);
  }
  return { ...a, region, focus: keepFocus(region, key) };
}

export const pinnedCount = (r: Region): number => r.filter((x) => x.pinned).length;
/** May this panel be pinned now? (An already pinned one may always be unpinned.) */
export const canPin = (r: Region, key: string): boolean => has(r, key) && pinnedCount(r) < PIN_MAX;

/** The owner pins or unpins a panel. Pinning past PIN_MAX is refused (the region is returned as is). */
export function setPinned(a: Arrangement, key: string, pinned: boolean): Arrangement {
  const cur = a.region.find((x) => panelKey(x.spec) === key);
  if (!cur || cur.pinned === pinned) return a;
  if (pinned && pinnedCount(a.region) >= PIN_MAX) return a;
  return { ...a, region: a.region.map((x) => (x === cur ? { ...x, pinned } : x)) };
}

/** The owner closes a panel, pinned or not. */
export function closePanel(a: Arrangement, key: string): Arrangement {
  if (!has(a.region, key)) return a;
  const region = a.region.filter((x) => panelKey(x.spec) !== key);
  return { ...a, region, focus: keepFocus(region, a.focus === key ? null : a.focus) };
}

/** The owner's own focus on a panel already in the region (a click on its title). */
export function focusPanel(a: Arrangement, key: string): Arrangement {
  return has(a.region, key) && a.focus !== key ? { ...a, focus: key } : a;
}

/** Apply a reply's layout ops (show, focus, filter) in order. `propose` is not layout and is ignored
 *  here. A focus on a deal the board does not know is skipped, as before. */
export function applyLayout(a: Arrangement, ops: readonly UiOp[], knownDeal: (id: string) => boolean): Arrangement {
  let next = a;
  for (const op of ops) {
    switch (op.op) {
      case 'show': next = place(next, op.panel); break;
      case 'focus':
        if (op.deal_id !== null && !knownDeal(op.deal_id)) break;
        next = { ...next, highlight: op.module === null && op.fate === null && op.deal_id === null ? null : { module: op.module, fate: op.fate, deal_id: op.deal_id } };
        break;
      case 'filter': next = { ...next, filter: { module: op.module, fate: op.fate } }; break;
      case 'propose': break;
    }
  }
  return next;
}

// ---- what changed --------------------------------------------------------------------------------

const sameFilter = (a: Filter, b: Filter): boolean => a.module === b.module && a.fate === b.fate;
const sameHighlight = (a: Highlight | null, b: Highlight | null): boolean =>
  a === b || (!!a && !!b && a.module === b.module && a.fate === b.fate && a.deal_id === b.deal_id);

/** What a reply changed on screen, before vs after. `kept` lists the panels that stayed, with their pin. */
export type Change = {
  added: PanelSpec[];
  kept: RegionPanel[];
  removed: PanelSpec[];
  /** The new filter when it changed (all-null = cleared); null when it did not change. */
  filter: Filter | null;
  /** 'cleared' when the light went off; the new light when it changed; null when it did not change. */
  highlight: Highlight | 'cleared' | null;
};

export function diffArrangement(before: Arrangement, after: Arrangement): Change {
  const beforeKeys = new Set(before.region.map((x) => panelKey(x.spec)));
  const afterKeys = new Set(after.region.map((x) => panelKey(x.spec)));
  return {
    added: after.region.filter((x) => !beforeKeys.has(panelKey(x.spec))).map((x) => x.spec),
    kept: after.region.filter((x) => beforeKeys.has(panelKey(x.spec))),
    removed: before.region.filter((x) => !afterKeys.has(panelKey(x.spec))).map((x) => x.spec),
    filter: sameFilter(before.filter, after.filter) ? null : after.filter,
    highlight: sameHighlight(before.highlight, after.highlight) ? null : after.highlight ?? 'cleared',
  };
}

/** Did anything the owner can see change? (A focus move onto a panel already there does not count.) */
export const changedAnything = (c: Change): boolean => c.added.length > 0 || c.removed.length > 0 || c.filter !== null || c.highlight !== null;

/** The words a change line is built from; filled by the board (lib/words), kept out of this pure file. */
export type ChangeWords = {
  added: (names: string) => string;
  kept: (names: string) => string;
  removed: (names: string) => string;
  pinned: (name: string) => string;
  list: (names: readonly string[]) => string;
  filtered: (what: string) => string;
  unfiltered: string;
  lit: (what: string) => string;
  unlit: string;
};

export type ChangeNames = {
  panel: (p: PanelSpec) => string;
  /** Plain words for a module and/or fate (and deal), e.g. "Spend, Needs you". */
  scope: (module: Module | null, fate: Fate | null, dealId?: string | null) => string;
};

/** One plain line saying what the reply changed, or null when it changed nothing. */
export function changeLine(c: Change, w: ChangeWords, n: ChangeNames): string | null {
  if (!changedAnything(c)) return null;
  const parts: string[] = [];
  if (c.added.length) parts.push(w.added(w.list(c.added.map(n.panel))));
  // What stayed is said only beside what came or went (a filter change alone names no panel).
  if (c.kept.length && (c.added.length || c.removed.length)) parts.push(w.kept(w.list(c.kept.map((x) => (x.pinned ? w.pinned(n.panel(x.spec)) : n.panel(x.spec))))));
  if (c.removed.length) parts.push(w.removed(w.list(c.removed.map(n.panel))));
  if (c.filter) parts.push(c.filter.module === null && c.filter.fate === null ? w.unfiltered : w.filtered(n.scope(c.filter.module, c.filter.fate)));
  if (c.highlight) parts.push(c.highlight === 'cleared' ? w.unlit : w.lit(n.scope(c.highlight.module, c.highlight.fate, c.highlight.deal_id)));
  return parts.join(' ');
}

// spark abstract-first-home, variant "zoom": the pure half of the semantic zoom. Which depth holds
// what, the one status sentence, the first need, and where an assistant reply lands. No React, no IO.
//
//   depth 0  the headline: one status sentence and the ONE first need (or the current setup step)
//   depth 1  the three standing answers (safe / needs me / if I do nothing), what happened while
//            away, and one answer slot under them
//   depth 2  the six modules, one state each, and one peek slot under them
//
// A reply never types a figure: the status sentence and every count come from the board model.
import type { Module } from '@bindings/Module';
import type { PanelSpec, UiOp } from '../../../../lib/assistant';
import { MODULE_KEYS } from '../../../../lib/assistant';
import { clockLabel } from '../../../../lib/format';
import type { BoardKey, BoardModel } from '../../switchboard/useBoardModel';
import { ZOOM } from './words';

export type Depth = 0 | 1 | 2;
export const DEPTHS: readonly Depth[] = [0, 1, 2];
export const deeper = (d: Depth): Depth => (d >= 2 ? 2 : ((d + 1) as Depth));
export const shallower = (d: Depth): Depth => (d <= 0 ? 0 : ((d - 1) as Depth));

export type StatusTone = 'ok' | 'gold' | 'refuse' | 'dim';
export type Status = { text: string; tone: StatusTone };

/** "18:00" today, else "Fri 18:00" (lib/format clockLabel). */
export function whenWords(at_s: number, now_s: number): string {
  const a = new Date(at_s * 1000);
  const n = new Date(now_s * 1000);
  const sameDay = a.getFullYear() === n.getFullYear() && a.getMonth() === n.getMonth() && a.getDate() === n.getDate();
  return sameDay ? a.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : clockLabel(at_s, now_s);
}

/** The needs-you keys, soonest deadline first (a key with no deadline last). */
export function needsKeys(model: BoardModel): BoardKey[] {
  return MODULE_KEYS.flatMap((m) => model.cells[m].needs.keys).sort((a, b) => (a.deadline_s ?? Infinity) - (b.deadline_s ?? Infinity));
}

/** The one status sentence: is it safe, and does anything need her (and by when). */
export function statusLine(model: BoardModel): Status {
  if (!model.ready) return { text: ZOOM.checking, tone: 'dim' };
  const rec = model.instruments.records;
  const safe = rec === 'intact' ? ZOOM.allSafe : rec === 'broken' ? ZOOM.notSafe : ZOOM.safeUnknown;
  const n = model.colCount.needs;
  if (rec === 'broken') return { text: safe, tone: 'refuse' };
  if (!n) return { text: `${safe} ${ZOOM.needsNone}`, tone: rec === 'intact' ? 'ok' : 'dim' };
  const first = needsKeys(model)[0];
  const now = Math.floor(model.digest.now_ms / 1000);
  const by = first?.deadline_s != null ? ZOOM.by(whenWords(first.deadline_s, now)) : '';
  return { text: `${safe} ${ZOOM.needsSome(n)}${by}.`, tone: 'gold' };
}

/** Where a panel lives on the canvas. The first need's own decision is the headline card. */
export function panelDepth(p: PanelSpec, firstNeedId: string | null, firstRun: boolean): Depth {
  switch (p.kind) {
    case 'setup': return firstRun ? 0 : 1;
    case 'decision':
    case 'deal': return p.deal_id === firstNeedId ? 0 : 1;
    case 'needs':
    case 'safety':
    case 'week':
    case 'money': return 1;
    case 'book':
    case 'rules':
    case 'rescue': return 2;
  }
}

/** The module a depth-2 panel belongs to (its tile lights), or null for the wallet peek. */
export function panelModule(p: PanelSpec): Module | null {
  if (p.kind === 'book' || p.kind === 'rules') return p.module;
  if (p.kind === 'rescue') return 'rescue';
  return null;
}

/** Where a reply lands: the depth to zoom to, the panel to place there (the last `show`), and the
 *  module tile to light (a `focus`/`filter` on a module, or a module panel). Null when the reply
 *  only talks or only proposes. */
export type Landing = { depth: Depth; panel: PanelSpec | null; module: Module | null; needs: boolean };

export function landingOf(ops: readonly UiOp[], firstNeedId: string | null, firstRun: boolean): Landing | null {
  let panel: PanelSpec | null = null;
  let module: Module | null = null;
  let needs = false;
  for (const op of ops) {
    if (op.op === 'show') panel = op.panel;
    else if (op.op === 'focus' || op.op === 'filter') {
      if (op.module) module = op.module;
      if (op.fate === 'needs' && !op.module) needs = true;
      if (op.op === 'focus' && op.deal_id && !op.module && !panel) panel = { kind: op.deal_id === firstNeedId ? 'decision' : 'deal', deal_id: op.deal_id };
    }
  }
  if (panel) {
    const d = panelDepth(panel, firstNeedId, firstRun);
    return { depth: d, panel, module: d === 2 ? panelModule(panel) ?? module : module, needs };
  }
  if (module) return { depth: 2, panel: null, module, needs };
  if (needs) return { depth: 1, panel: { kind: 'needs', module: null }, module: null, needs };
  return null;
}

/** One tile's one state: needs (gold) wins, then moving (teal), else quiet. */
export type TileState = { tone: 'gold' | 'teal' | 'quiet' | 'dim'; count: number | null };
export function tileState(model: BoardModel, m: Module): TileState {
  if (!model.ready) return { tone: 'dim', count: null };
  const c = model.cells[m];
  if (c.needs.count) return { tone: 'gold', count: c.needs.count };
  if (c.moving.count) return { tone: 'teal', count: c.moving.count };
  return { tone: 'quiet', count: 0 };
}

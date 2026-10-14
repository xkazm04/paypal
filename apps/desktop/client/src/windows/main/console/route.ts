// The console's stack of layers, derived from the route alone (never from a history of clicks):
// the decision centre is layer 1; the waiting list, the Rewind, Set up and the six modules are
// layer 2; a module's detail view or a deal is layer 3; a deal opened from a detail view is layer 4.
// The owner's places (rules, connections, settings, the safety record) are layer 2, or one below
// the page they were opened from; the wallet limits and the pairing desk sit under rules and
// connections.
// Esc, the Back button and the crumbs all walk this one chain. Pure: no React, no IO.
import type { Module } from '@bindings/Module';
import { stepBack, type Route } from '../logic';

/** Looks up what the route needs that the route itself does not carry. */
export type ChainCtx = {
  /** The module a deal belongs to (from the ledger), or null when it is not known. */
  dealModule: (deal: string) => Module | null;
  /** True when a module's detail view key is a real page (registered by its module). */
  knownView: (module: Module, view: string) => boolean;
};

const viewIsKnown = (r: Route, ctx: ChainCtx): boolean => {
  if (r.level === 'module' && r.view) return ctx.knownView(r.module, r.view);
  if (r.level === 'deal' && r.from?.view) return ctx.knownView(r.from.module, r.from.view);
  return true;
};

/** The layer under `r`, or null at the centre. */
export function parentOf(r: Route, ctx: ChainCtx): Route | null {
  return stepBack(r, r.level === 'deal' ? ctx.dealModule(r.deal) : null, viewIsKnown(r, ctx));
}

/** The route as a list from the centre down to it (the centre first). Never longer than 4. */
export function chainOf(r: Route, ctx: ChainCtx): Route[] {
  const out: Route[] = [];
  let at: Route | null = r;
  while (at && out.length < 4) {
    out.unshift(at);
    at = parentOf(at, ctx);
  }
  return out;
}

/** How deep the route sits: 1 (the centre) to 4. */
export const depthOf = (r: Route, ctx: ChainCtx): number => chainOf(r, ctx).length;

/** A stable key per layer: where its scroll and focus are remembered, and what resets a boundary. */
export function routeKey(r: Route): string {
  switch (r.level) {
    case 'home': return 'centre';
    case 'module': return r.view ? `m:${r.module}:${r.view}` : `m:${r.module}`;
    case 'deal': return `d:${r.deal}`;
    case 'setup': return 'setup';
    case 'waiting': return 'waiting';
    case 'rewind': return 'rewind';
    case 'place': return r.from ? `p:${r.place}:${r.from}` : `p:${r.place}`;
  }
}

/** Same layer (ignoring a setup step or a waiting filter, which only change what the layer shows). */
export const sameLayer = (a: Route, b: Route): boolean => routeKey(a) === routeKey(b);

/** Which way a move goes, for the transition: deeper, shallower, or across at the same depth. */
export function directionOf(from: Route, to: Route, ctx: ChainCtx): 'into' | 'out' | 'swap' {
  const a = depthOf(from, ctx);
  const b = depthOf(to, ctx);
  return b > a ? 'into' : b < a ? 'out' : 'swap';
}

/** True when `to` is on the chain above `from` (a step back up the stack). */
export function isAncestor(to: Route, from: Route, ctx: ChainCtx): boolean {
  return chainOf(from, ctx).slice(0, -1).some((r) => sameLayer(r, to));
}

/** The module whose tab is lit for a route (a deal lights its own module, or the one it came from). */
export function moduleOfRoute(r: Route, ctx: ChainCtx): Module | null {
  if (r.level === 'module') return r.module;
  if (r.level === 'deal') return r.from?.module ?? ctx.dealModule(r.deal);
  return null;
}

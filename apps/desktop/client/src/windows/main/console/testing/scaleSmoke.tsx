// The scale smoke harness (rebuild WP2.5; test-only, never imported by the app). WP3 builders reuse
// it for their layers:
//
//   vi.mock('../../../../lib/runtime', async () => (await import('../testing/runtime')).runtimeMock);
//   import { expectLayerHealthy, renderLayerAtScale } from '../testing/scaleSmoke';
//
//   it('Spend at scale', async () => {
//     const r = await renderLayerAtScale({ level: 'module', module: 'spend' }, 'large');
//     expectLayerHealthy(r);
//   });
//
// It opens the whole main window (App) on the mock backend's `?scale=small|large` world at the
// route's hash, waits for the layer's heading and for the reads to settle, and reports what a smoke
// test checks: console errors, raw enum names or ids drawn as text, how many list rows are in the
// DOM, the read budget, and every command called (so a test can assert that nothing but reads and
// `approval_open` was sent). jsdom has no layout: the harness gives every element a size so windowed
// lists draw a window of rows (see lib/data/useWindowedRows.ts).
import { Profiler } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import { AUTHORITY } from '@bindings/authority';
import type { Backend, CommandName, EventName, PayloadOf } from '../../../../lib/contract';
import { readBudget, resetReadBudget } from '../../../../lib/data/invoke';
import { mockBackend, resetMockState } from '../../../../mock/backend';
import { App } from '../../App';
import { formatHash, type Route } from '../../logic';
import type { LayerId } from '../layers';
import { setHarnessBackend } from './runtime';

export type Scale = 'small' | 'large';

export type LayerRun = {
  /** The layer element (`.cs-layer`), with `data-layer` = its LayerId. */
  layer: HTMLElement;
  /** Every console.error / unhandled message while it rendered. */
  errors: string[];
  /** Every command sent, with its arguments. */
  calls: { cmd: string; args: unknown }[];
  /** Visible text nodes of the whole window. */
  texts: () => string[];
  /** List rows in the DOM (windowed lists keep this bounded). */
  rows: () => number;
  /** Milliseconds from render to the layer's heading. */
  ms: number;
  budget: typeof readBudget;
  /** React commits of the whole window since render (a Profiler around App; perf counters). */
  commits: () => number;
  /** Sends a wallet event to every listener of the window, as the shell would (in act). */
  fire: <E extends EventName>(e: E, payload: PayloadOf<E>) => Promise<void>;
};

/** Raw enum names, display labels (ids), command names and error codes never belong on screen. */
export const RAW_TEXT = /^[A-Z]{2,}_[A-Z_]+$|\b[A-Z]{3,}_[A-Z]{2,}\b|D-\d{4}|_list\b|_query\b|\bUNAVAILABLE\b|\bAWAITING_APPROVAL\b|\bRECEIPTED\b/;

const ROW_SELECTOR = '[role="listitem"], [role="row"], [role="option"], .le-item, .ui-row';

let sized = false;
/** jsdom has no layout: give elements a viewport-like size so the virtualizer draws rows. */
function sizeElements(): void {
  if (sized) return;
  sized = true;
  const H = 800;
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return H; } });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 1280; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return H; } });
  if (!('ResizeObserver' in window)) {
    class RO { observe() {} unobserve() {} disconnect() {} }
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: RO });
  }
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function scrollTo() {};
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Waits until no read is in flight and no new read started for a beat. */
export async function settle(): Promise<void> {
  let last = -1;
  while (readBudget.total !== last || readBudget.inFlight > 0) {
    last = readBudget.total;
    await act(async () => { await sleep(120); });
  }
}

function visibleTexts(root: ParentNode): string[] {
  const out: string[] = [];
  const w = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const el = n.parentElement;
    if (el && el.closest('[aria-hidden="true"], script, style, .sr-only')) continue;
    const t = n.textContent?.trim();
    if (t) out.push(t);
  }
  return out;
}

/** A route, a raw hash, or a function that picks the route from the world (e.g. its first deal). */
export type LayerTarget = Route | string | ((world: Backend) => Promise<Route>);

/** The world's first deal, as a deal layer's route. */
export const firstDeal = async (w: Backend): Promise<Route> => ({ level: 'deal', deal: (await w.invoke('list_deals', null))[0]?.id ?? 'none' });

/** One route per registered layer, keyed by LayerId: a new layer id does not type-check until it has
 *  a route here, so every suite that walks this table (scale smoke, a11y, perf) covers it. */
export const LAYER_ROUTES: Readonly<Record<LayerId, LayerTarget>> = {
  centre: { level: 'home' },
  waiting: { level: 'waiting' },
  rewind: { level: 'rewind' },
  setup: { level: 'setup', step: 'keys' },
  deal: firstDeal,
  tables: { level: 'module', module: 'tables' },
  spend: { level: 'module', module: 'spend' },
  counter: { level: 'module', module: 'counter' },
  book: { level: 'module', module: 'book' },
  shield: { level: 'module', module: 'shield' },
  rescue: { level: 'module', module: 'rescue' },
  rules: { level: 'place', place: 'rules' },
  limits: { level: 'place', place: 'limits' },
  connections: { level: 'place', place: 'connections' },
  pairing: { level: 'place', place: 'pairing' },
  settings: { level: 'place', place: 'settings' },
  safety: { level: 'place', place: 'safety' },
};

/** LAYER_ROUTES as [layer id, target] rows, for `it.each`. */
export const layerRoutes = (): Array<[LayerId, LayerTarget]> => Object.entries(LAYER_ROUTES) as Array<[LayerId, LayerTarget]>;

/** The error capture of the last run, until the next run starts. */
let releaseErrors: (() => void) | null = null;

/** Renders the main window at `route` (or a raw hash) on the `scale` world (null: Maya's own preview wallet, the fixtures) and waits for its layer. */
export async function renderLayerAtScale(route: LayerTarget, scale: Scale | null, o: { timeout?: number } = {}): Promise<LayerRun> {
  sizeElements();
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  const q = scale ? `?scale=${scale}` : '';
  history.replaceState(null, '', `/index.html${q}`);
  resetMockState();
  const real = mockBackend('main');
  const to = typeof route === 'function' ? await route(real) : route;
  const hash = typeof to === 'string' ? to : formatHash(to);
  history.replaceState(null, '', `/index.html${q}${hash}`);
  resetReadBudget();
  const errors: string[] = [];
  const calls: { cmd: string; args: unknown }[] = [];
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  let commits = 0;
  const wrapped: Backend = {
    kind: real.kind,
    label: real.label,
    invoke: async (cmd, args, opts) => {
      calls.push({ cmd, args });
      // A browser cannot open the approval window here; the hand-off is recorded instead.
      if (cmd === 'approval_open') return null as never;
      return real.invoke(cmd, args, opts);
    },
    listen: async (e, cb) => {
      const set = handlers.get(e) ?? new Set();
      set.add(cb as (p: unknown) => void);
      handlers.set(e, set);
      const off = await real.listen(e, cb);
      return () => { set.delete(cb as (p: unknown) => void); off(); };
    },
  };
  setHarnessBackend(wrapped);
  // Errors are counted for the whole run, not only until the layer is drawn: tests assert
  // `r.errors` after their clicks, events and waves. Quiet while drawing (as before), then also
  // printed, so nothing is hidden; the next run (or a failed one) gives console.error back.
  releaseErrors?.();
  const origError = console.error;
  let drawn = false;
  console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); if (drawn) origError(...a); };
  releaseErrors = () => { console.error = origError; releaseErrors = null; };
  const t0 = performance.now();
  try {
    render(<Profiler id="main" onRender={() => { commits += 1; }}><App /></Profiler>);
    const layer = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.cs-layer');
      const h = el?.querySelector('[data-layer-title], h1');
      if (!el || !h || el.querySelector('.cs-centre.loading, .cs-skel')) throw new Error('layer not drawn yet');
      return el;
    }, { timeout: o.timeout ?? 15_000 });
    const ms = performance.now() - t0;
    await settle();
    drawn = true;
    return {
      layer, errors, calls, ms, budget: readBudget,
      commits: () => commits,
      fire: async (e, payload) => { await act(async () => { for (const cb of handlers.get(e) ?? []) cb(payload); }); },
      texts: () => visibleTexts(document.body),
      rows: () => document.querySelectorAll(ROW_SELECTOR).length,
    };
  } catch (e) {
    releaseErrors?.();
    throw e;
  }
}

/** The smoke checks every layer must pass at scale. */
export function expectLayerHealthy(r: LayerRun, o: { maxRows?: number; maxDisplays?: number; maxMs?: number } = {}): void {
  expect(r.errors, 'no console error').toEqual([]);
  expect(r.texts().filter((t) => RAW_TEXT.test(t)), 'no raw enum name or id on screen').toEqual([]);
  expect(r.rows(), 'list rows in the DOM stay bounded').toBeLessThanOrEqual(o.maxRows ?? 250);
  // The read budget: the world's reads once each, every display at most once, few reads at a time.
  for (const c of ['list_deals', 'attention_list', 'get_settings'] as const) expect(r.budget.byCommand.get(c)?.total ?? 0, `${c} read once`).toBeLessThanOrEqual(1);
  expect(r.budget.byCommand.get('deal_display')?.total ?? 0).toBeLessThanOrEqual(o.maxDisplays ?? 500);
  expect(r.budget.maxInFlight).toBeLessThanOrEqual(16);
  // Nothing but reads and the hand-off to the approval window.
  const acts = r.calls.filter((c) => c.cmd !== 'approval_open' && AUTHORITY[c.cmd as CommandName]?.tier !== 'read');
  expect(acts, 'only reads were sent').toEqual([]);
  // jsdom is slower than the shell; a guard against a runaway, not the shell's timing.
  expect(r.ms).toBeLessThan(o.maxMs ?? 10_000);
}

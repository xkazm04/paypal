// The console at scale, counted (rebuild WP4a perf pass). On the busy merchant (?scale=large: 500
// deals, 195 wallets, 5,000 record steps) every layer is opened cold and its reads, its DOM nodes and
// the window's React commits are counted; then a burst of 20 `deal:changed` events (what a busy
// minute sends) is fired and counted again. Budgets: no layer over 1,500 DOM nodes; a burst is
// coalesced (the ledger read again a handful of times, never a read per event); nothing but reads. The
// browser timings (time to the centre and to each summary, mock at 40 ms per call) are measured with
// Playwright and recorded in docs/build/rebuild/wp4a.md.
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Deal } from '@bindings/Deal';
import { layerRoutes, renderLayerAtScale, settle, type LayerTarget } from './testing/scaleSmoke';
import { staggerOff } from './stagger';

vi.mock('../../../lib/runtime', async () => (await import('./testing/runtime')).runtimeMock);

// Every wave in the first frame, as before the staggered reveal (stagger.tsx; its own tests turn it on).
beforeAll(() => staggerOff());

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

export const NODE_BUDGET = 1_500;

// Every registered layer (LAYER_ROUTES, keyed by LayerId), plus one module view.
const LAYERS: Array<[string, LayerTarget]> = [...layerRoutes(), ['book ledger', { level: 'module', module: 'book', view: 'ledger' }]];

const report: string[] = [];

describe('every layer on the busy merchant, counted', () => {
  it.each(LAYERS)('%s', async (name, route) => {
    const r = await renderLayerAtScale(route, 'large');
    const nodes = r.layer.querySelectorAll('*').length;
    const loadReads = r.budget.total;
    const loadCommits = r.commits();
    const before = r.budget.byCommand.get('list_deals')?.total ?? 0;
    const beforeAll = r.budget.total;
    const commitsBefore = r.commits();
    const deals = (await import('../../../mock/backend')).mockBackend('main');
    const list = (await deals.invoke('list_deals', null)) as Deal[];
    for (const d of list.slice(0, 20)) await r.fire('deal:changed', { deal: d, mode: d.mode });
    await settle();
    const burstLedger = (r.budget.byCommand.get('list_deals')?.total ?? 0) - before;
    const burstReads = r.budget.total - beforeAll;
    const burstCommits = r.commits() - commitsBefore;
    report.push(`${name.padEnd(12)} nodes ${String(nodes).padStart(5)} · load reads ${String(loadReads).padStart(4)} · load commits ${String(loadCommits).padStart(4)} · burst: ledger ${burstLedger}, reads ${burstReads}, commits ${burstCommits}`);
    expect(nodes, 'DOM nodes in the layer').toBeLessThanOrEqual(NODE_BUDGET);
    expect(burstLedger, 'a burst of 20 events is coalesced: far fewer ledger reads than events (timing on a loaded machine decides 2 to 8)').toBeLessThanOrEqual(8);
    expect(burstReads, 'a burst never reads per event per deal').toBeLessThanOrEqual(60);
    expect(r.errors).toEqual([]);
  }, 90_000);

  it('prints the counters', () => {
    // eslint-free report for the note (vitest prints console output with the file)
    console.info(`\n${report.join('\n')}`);
    expect(report.length).toBe(LAYERS.length);
  });
});

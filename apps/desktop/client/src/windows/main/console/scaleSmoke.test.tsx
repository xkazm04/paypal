// The scale smoke: every registered layer of the console, opened on the busy merchant's world
// (?scale=large, 500 deals), draws its heading with no console error, no raw enum name or id on
// screen, a bounded number of list rows, inside the read budget, and sends nothing but reads. WP3
// builders add their own cases with the same harness (console/testing/scaleSmoke.tsx).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { ALL_LAYERS } from './layers.registry';
import { expectLayerHealthy, layerRoutes, renderLayerAtScale } from './testing/scaleSmoke';

vi.mock('../../../lib/runtime', async () => (await import('./testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });


describe('every layer at scale', () => {
  it('walks every registered layer (the routes are keyed by LayerId)', () => {
    expect(layerRoutes().map(([id]) => id).sort()).toEqual(ALL_LAYERS.map((d) => d.id).sort());
  });

  it.each(layerRoutes())('%s', async (id, route) => {
    const r = await renderLayerAtScale(route, 'large');
    expect(r.layer.dataset.layer).toBe(id);
    expectLayerHealthy(r);
  }, 60_000);

  it('the small shop centre', async () => {
    const r = await renderLayerAtScale({ level: 'home' }, 'small');
    expectLayerHealthy(r);
  }, 60_000);
});

describe('the harness', () => {
  it('keeps counting console errors after the layer is drawn (clicks, events, waves)', async () => {
    const r = await renderLayerAtScale({ level: 'home' }, 'small');
    console.error('a late failure');
    expect(r.errors).toContain('a late failure');
  }, 60_000);
});

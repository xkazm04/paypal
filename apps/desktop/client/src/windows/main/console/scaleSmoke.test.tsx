// The scale smoke: every registered layer of the console, opened on the busy merchant's world
// (?scale=large, 500 deals), draws its heading with no console error, no raw enum name or id on
// screen, a bounded number of list rows, inside the read budget, and sends nothing but reads. WP3
// builders add their own cases with the same harness (console/testing/scaleSmoke.tsx).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import type { Route } from '../logic';
import { expectLayerHealthy, renderLayerAtScale } from './testing/scaleSmoke';

vi.mock('../../../lib/runtime', async () => (await import('./testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

const ROUTES: Array<[string, Route]> = [
  ['centre', { level: 'home' }],
  ['waiting', { level: 'waiting' }],
  ['tables', { level: 'module', module: 'tables' }],
  ['spend', { level: 'module', module: 'spend' }],
  ['counter', { level: 'module', module: 'counter' }],
  ['book', { level: 'module', module: 'book' }],
  ['shield', { level: 'module', module: 'shield' }],
  ['rescue', { level: 'module', module: 'rescue' }],
  ['rewind', { level: 'rewind' }],
  ['setup', { level: 'setup', step: 'keys' }],
  ['rules', { level: 'place', place: 'rules' }],
  ['limits', { level: 'place', place: 'limits' }],
  ['connections', { level: 'place', place: 'connections' }],
  ['pairing', { level: 'place', place: 'pairing' }],
  ['settings', { level: 'place', place: 'settings' }],
  ['safety', { level: 'place', place: 'safety' }],
];

describe('every layer at scale', () => {
  it.each(ROUTES)('%s', async (id, route) => {
    const r = await renderLayerAtScale(route, 'large');
    expect(r.layer.dataset.layer).toBe(id === 'centre' ? 'centre' : id);
    expectLayerHealthy(r);
  }, 60_000);

  it('a deal layer', async () => {
    const r = await renderLayerAtScale(async (w) => ({ level: 'deal', deal: (await w.invoke('list_deals', null))[0]?.id ?? 'none' }), 'large');
    expect(r.layer.dataset.layer).toBe('deal');
    expectLayerHealthy(r);
  }, 60_000);

  it('the small shop centre', async () => {
    const r = await renderLayerAtScale({ level: 'home' }, 'small');
    expectLayerHealthy(r);
  }, 60_000);
});

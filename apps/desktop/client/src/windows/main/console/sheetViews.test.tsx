// A deal's and a place's card views are in the route (rebuild WP4a, Director decision 2):
// `#d=<id>&dv=<view>` and `#p=<place>&v=<view>`. A card opens its view (one history entry, the chain
// one deeper, a crumb named after the card), Escape / the top bar's Back / the crumbs / the browser's
// Back close it with the focus back on the card, and a reload opens the view again.
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEAL_CARD, SETTINGS_CARD } from '../../../lib/words';
import { ALL_LAYERS } from './layers.registry';
import { LAYER_ROUTES, layerRoutes, renderLayerAtScale, settle } from './testing/scaleSmoke';

vi.mock('../../../lib/runtime', async () => (await import('./testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

const card = (label: string): HTMLButtonElement => {
  const c = [...document.querySelectorAll<HTMLButtonElement>('.cs-layer button.pf-card')].find((b) => b.querySelector('.sc-label')?.textContent?.startsWith(label));
  if (!c) throw new Error(`no card ${label}`);
  return c;
};
const crumbs = (): string[] => [...document.querySelectorAll('.cs-bar .ui-crumbs > .ui-crumb-wrap')].map((w) => (w.lastElementChild?.textContent ?? '').trim());
const viewOpen = () => document.querySelector<HTMLElement>('.cs-layer .pf-view');
const back = () => document.querySelector<HTMLButtonElement>('.cs-back');

describe('a place card view is a step of the route', () => {
  it('opens into the hash, names its crumb, and Escape closes it with the focus on its card', async () => {
    await renderLayerAtScale({ level: 'place', place: 'settings' }, 'small');
    const layer = document.querySelector('.cs-layer');
    fireEvent.click(card(SETTINGS_CARD.agents));
    await waitFor(() => expect(viewOpen()).toBeTruthy());
    expect(location.hash).toBe('#p=settings&v=agents');
    expect(crumbs().at(-1)).toBe(SETTINGS_CARD.agents);
    // the sheet stayed the same element: the view opened under its cards
    expect(document.querySelector('.cs-layer')).toBe(layer);
    await waitFor(() => expect(document.activeElement?.hasAttribute('data-view-title')).toBe(true));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(viewOpen()).toBeNull());
    expect(location.hash).toBe('#p=settings');
    await waitFor(() => expect(document.activeElement).toBe(card(SETTINGS_CARD.agents)));
    expect(document.querySelector('.cs-layer')?.getAttribute('data-layer')).toBe('settings');
  }, 60_000);

  it('the top bar Back closes the view first, then leaves the place', async () => {
    await renderLayerAtScale({ level: 'place', place: 'settings' }, 'small');
    fireEvent.click(card(SETTINGS_CARD.notify));
    await waitFor(() => expect(viewOpen()).toBeTruthy());
    const b = back();
    if (!b) throw new Error('no back');
    await act(async () => { fireEvent.click(b); });
    await waitFor(() => expect(viewOpen()).toBeNull());
    expect(document.querySelector('.cs-layer')?.getAttribute('data-layer')).toBe('settings');
    await waitFor(() => expect(document.activeElement).toBe(card(SETTINGS_CARD.notify)));
    const b2 = back();
    if (!b2) throw new Error('no back');
    await act(async () => { fireEvent.click(b2); });
    await waitFor(() => expect(document.querySelector('.cs-layer')?.getAttribute('data-layer')).toBe('centre'));
  }, 60_000);

  it('a reload with the view in the hash opens it again', async () => {
    await renderLayerAtScale('#p=settings&v=look', 'small');
    await waitFor(() => expect(viewOpen()?.dataset.view).toBe('look'));
    expect(card(SETTINGS_CARD.appearance).getAttribute('aria-expanded')).toBe('true');
    expect(crumbs().at(-1)).toBe(SETTINGS_CARD.appearance);
  }, 60_000);

  it('an unknown view opens nothing and adds no step to the chain', async () => {
    await renderLayerAtScale('#p=settings&v=nothing-here', 'small');
    expect(viewOpen()).toBeNull();
    expect(crumbs()).toHaveLength(2);
    const b = back();
    if (!b) throw new Error('no back');
    await act(async () => { fireEvent.click(b); });
    await waitFor(() => expect(document.querySelector('.cs-layer')?.getAttribute('data-layer')).toBe('centre'));
  }, 60_000);
});

describe('a deal card view is a step of the route', () => {
  it('opens as &dv=, the browser Back closes it, and Forward opens it again', async () => {
    await renderLayerAtScale(async (w) => ({ level: 'deal', deal: (await w.invoke('list_deals', null))[0]?.id ?? 'none' }), 'small');
    const deep = crumbs().length;
    fireEvent.click(card(DEAL_CARD.who));
    await waitFor(() => expect(viewOpen()).toBeTruthy());
    expect(location.hash).toMatch(/&dv=who$/);
    expect(crumbs()).toHaveLength(deep + 1);
    await act(async () => { history.back(); });
    await waitFor(() => expect(viewOpen()).toBeNull());
    expect(location.hash).not.toContain('dv=');
    expect(document.querySelector('.cs-layer')?.getAttribute('data-layer')).toBe('deal');
    await waitFor(() => expect(document.activeElement).toBe(card(DEAL_CARD.who)));
    await act(async () => { history.forward(); });
    await waitFor(() => expect(viewOpen()?.dataset.view).toBe('who'));
    await settle();
  }, 60_000);

  it('a second card replaces the open view, so one Back closes it', async () => {
    await renderLayerAtScale(async (w) => ({ level: 'deal', deal: (await w.invoke('list_deals', null))[0]?.id ?? 'none' }), 'small');
    fireEvent.click(card(DEAL_CARD.story));
    await waitFor(() => expect(viewOpen()?.dataset.view).toBe('story'));
    fireEvent.click(card(DEAL_CARD.proof));
    await waitFor(() => expect(viewOpen()?.dataset.view).toBe('proof'));
    const b = back();
    if (!b) throw new Error('no back');
    await act(async () => { fireEvent.click(b); });
    await waitFor(() => expect(viewOpen()).toBeNull());
    expect(document.querySelector('.cs-layer')?.getAttribute('data-layer')).toBe('deal');
  }, 60_000);
});

// A deal's and a place's `views` (LayerDef.views, the area file) are a hand-kept list of the card
// views its page draws (PlaceFrame cards with a view). The two must agree: a card whose view is not
// registered pushes `&v=` and opens nothing (the chain steps over it); a registered view no card
// opens is a crumb label for nothing. Ground truth is the page as drawn, not the list.
describe('every sheet layer registers exactly the card views its page draws', () => {
  const SHEETS = layerRoutes().filter(([id]) => { const t = LAYER_ROUTES[id]; return id === 'deal' || (typeof t === 'object' && t.level === 'place'); });
  it('covers the deal and the places', () => {
    expect(SHEETS.map(([id]) => id).sort()).toEqual(['connections', 'deal', 'limits', 'pairing', 'rules', 'safety', 'settings']);
  });
  it.each(SHEETS)('%s', async (id, target) => {
    await renderLayerAtScale(target, 'small');
    const drawn = [...document.querySelectorAll<HTMLElement>('.cs-layer button.pf-card[aria-expanded]')].map((b) => b.dataset.lens ?? '').sort();
    const def = ALL_LAYERS.find((d) => d.id === id);
    expect(drawn).toEqual(Object.keys(def?.views ?? {}).sort());
  }, 60_000);
});

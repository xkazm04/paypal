// W1 (client side): the console keeps its place across a close and reopen. The route lives in the
// URL hash, so a console that is unmounted and mounted again (the window hidden to the tray and
// shown) lands on the same layer, with the same crumb trail, and not on the decision centre.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIND_LABEL } from '../../../lib/words';
import { mockBackend, resetMockState } from '../../../mock/backend';

const h = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../../../lib/runtime', () => ({ backend: () => h.current }));

import { App } from '../App';

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) });
  }
});
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

const layer = () => document.querySelector<HTMLElement>('.cs-layer');
const level = () => layer()?.dataset.level;
const crumbs = () => screen.getByRole('navigation', { name: 'Where you are' }).textContent;
const settled = () => waitFor(() => {
  const el = layer()?.querySelector<HTMLElement>('[data-layer-title]');
  if (!el || el.closest('.cs-centre.loading')) throw new Error('no heading yet');
}, { timeout: 8000 });

/** Mounts the console; the same mock world and the same URL as before when `fresh` is false. */
function mount(fresh: boolean) {
  if (fresh) { history.replaceState(null, '', '/index.html'); resetMockState(); }
  h.current = mockBackend('main');
  return render(<App />);
}

describe('W1: the console returns to the same route after a remount', () => {
  it('a module layer comes back as the same module, with the same crumb trail', async () => {
    const first = mount(true);
    await settled();
    expect(level()).toBe('home');
    fireEvent.click(screen.getByRole('tab', { name: /Spend/ }));
    await waitFor(() => expect(level()).toBe('module'));
    expect(location.hash).toBe('#m=spend');
    const trail = crumbs();
    first.unmount();
    expect(layer()).toBeNull();

    mount(false);
    await settled();
    expect(level()).toBe('module');
    expect(location.hash).toBe('#m=spend');
    expect(crumbs()).toBe(trail);
  }, 30_000);

  it('a deal opened from Find, a layer down, comes back as the same deal', async () => {
    const first = mount(true);
    await settled();
    fireEvent.click(screen.getByRole('tab', { name: /Spend/ }));
    await waitFor(() => expect(level()).toBe('module'));
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = within(await screen.findByRole('dialog', { name: FIND_LABEL })).getByRole('combobox');
    fireEvent.change(input, { target: { value: 'usb-c dock' } });
    const deal = (await screen.findAllByRole('option')).find((o) => o.id.startsWith('cs-find-d-'));
    expect(deal).toBeTruthy();
    fireEvent.click(deal as HTMLElement);
    await waitFor(() => expect(level()).toBe('deal'));
    const hash = location.hash;
    expect(hash).toMatch(/^#d=[^&]+&m=spend$/);
    await settled();
    await waitFor(() => expect(crumbs()).toContain('USB-C dock'), { timeout: 8000 });
    const trail = crumbs();
    first.unmount();

    mount(false);
    await settled();
    expect(level()).toBe('deal');
    expect(location.hash).toBe(hash);
    // The deal's name is read after the layer opens (the hash carries only its slug).
    await waitFor(() => expect(crumbs()).toBe(trail), { timeout: 8000 });
  }, 30_000);
});

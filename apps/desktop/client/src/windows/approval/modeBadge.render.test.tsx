// U2 in the approval window: the title bar carries the deal's mode badge (ModeBadge in ui.tsx's
// WindowBar), over the mock backend's own deals. A sandbox deal reads "Sandbox", a replayed one "Replay".
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../lib/contract';
import { mockBackend, resetMockState } from '../../mock/backend';

const h = vi.hoisted(() => ({ current: null as Backend | null }));
vi.mock('../../lib/runtime', () => ({ backend: () => h.current }));

const { App } = await import('./App');

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) });
  }
});
afterEach(() => { cleanup(); resetMockState(); history.replaceState(null, '', '/'); });

async function open(label: string) {
  history.replaceState(null, '', '/index.html');
  resetMockState();
  const deal = mockBackend('main').world.deal(label)!.deal;
  history.replaceState(null, '', `/approval.html?deal=${deal.id}`);
  h.current = mockBackend('approval');
  render(<App />);
  return deal;
}
const badge = () => document.querySelector<HTMLElement>('.aw-head .badge:not(.mock)');

describe('U2: the approval window carries a mode badge', () => {
  it('a sandbox deal shows "Sandbox" in the title bar', async () => {
    const deal = await open('D-0193');
    expect(deal.mode).toBe('sandbox');
    await waitFor(() => expect(badge()).not.toBeNull(), { timeout: 8000 });
    expect(badge()!.textContent).toBe('Sandbox');
    expect(badge()!.classList.contains('sandbox')).toBe(true);
    expect(screen.getByRole('banner')).toBe(badge()!.closest('header'));
  });

  it('a replayed deal shows "Replay" in the title bar', async () => {
    const deal = await open('D-0188');
    expect(deal.mode).toBe('replay');
    await waitFor(() => expect(badge()?.textContent).toBe('Replay'), { timeout: 8000 });
  });
});

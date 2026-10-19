// Acceptance W10 (STATUS.md), the client half: the Tumbler's breathing is a class (`breathe`) that
// the CSS animates (tumbler.css: `.breathe .puck-art .glow`). This mounts the real Tumbler on the
// mock backend with a gate due within the 2 h rung and checks the class is there, and is gone
// under prefers-reduced-motion: reduce and under do-not-disturb (in the owner's settings).
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../lib/contract';
import { mockBackend, resetMockState } from '../../mock/backend';
import { setHarnessBackend } from '../main/console/testing/runtime';
import { Tumbler } from './Tumbler';

vi.mock('../../lib/runtime', async () => (await import('../main/console/testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); setHarnessBackend(null); vi.unstubAllGlobals(); });

function stubMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'), media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
  window.matchMedia = globalThis.matchMedia;
}

/** The Tumbler on the mock wallet, one gate due in an hour, do-not-disturb as given. */
async function mountTumbler(o: { reduce: boolean; dnd: boolean }): Promise<HTMLElement> {
  stubMotion(o.reduce);
  resetMockState();
  const real = mockBackend('tumbler');
  const wrapped: Backend = {
    ...real,
    invoke: (async (cmd: string, args: unknown, opts: unknown) => {
      const out = await (real.invoke as (c: string, a: unknown, o: unknown) => Promise<unknown>)(cmd, args, opts);
      if (cmd === 'attention_list') {
        const snap = out as { items: { kind: string; deadline: number | null }[] };
        let done = false;
        const items = snap.items.map((i) => (!done && i.kind === 'gate' ? ((done = true), { ...i, deadline: Math.floor(Date.now() / 1000) + 3600 }) : i));
        return { ...snap, items };
      }
      if (cmd === 'get_settings') {
        const s = out as { preferences: object };
        return { ...s, preferences: { ...s.preferences, dnd: o.dnd } };
      }
      return out;
    }) as Backend['invoke'],
  };
  setHarnessBackend(wrapped);
  const { container } = render(<Tumbler />);
  const root = container.querySelector<HTMLElement>('.tum');
  if (!root) throw new Error('no Tumbler root');
  // The gate arrived: the ring is on a live rung (the count is not zero).
  await waitFor(() => expect(root.className).toMatch(/\bu-(soon|now)\b/));
  await waitFor(() => expect(root.className).toMatch(/ring-/));
  return root;
}

describe('the Tumbler breathes only when it may', () => {
  it('breathes with a gate due within 2 h and nothing asking for calm', async () => {
    const root = await mountTumbler({ reduce: false, dnd: false });
    expect(root.classList.contains('breathe')).toBe(true);
    expect(root.classList.contains('reduced')).toBe(false);
  });

  it('does not breathe under prefers-reduced-motion: reduce', async () => {
    const root = await mountTumbler({ reduce: true, dnd: false });
    expect(root.classList.contains('reduced')).toBe(true);
    expect(root.classList.contains('breathe')).toBe(false);
  });

  it('does not breathe under do-not-disturb, and keeps the ring', async () => {
    const root = await mountTumbler({ reduce: false, dnd: true });
    await waitFor(() => expect(root.classList.contains('breathe')).toBe(false));
    expect(root.className).toMatch(/\bring-\w+/);
    expect(root.className).toMatch(/\bu-(soon|now)\b/);
  });
});

// While idle-locked, every hand-off of WP3c's layers carries the lock glyph and the console's locked
// title, and only opens the approval window (which asks for Windows Hello first): the deal's gold
// decision, Agent rules' Change, Settings' unlock.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AUTHORITY } from '@bindings/authority';
import type { Backend, CommandName } from '../../../../../lib/contract';
import { APPROVAL_LOCKED_TITLE, SETTINGS_LOCK } from '../../../../../lib/words';
import { mockBackend, resetMockState } from '../../../../../mock/backend';

const h = vi.hoisted(() => ({ current: null as Backend | null, calls: [] as { cmd: string; args: unknown }[] }));
vi.mock('../../../../../lib/runtime', () => ({ backend: () => h.current }));

import { App } from '../../../App';

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) });
  }
});
afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

function open(url: string) {
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', url);
  resetMockState();
  const real = mockBackend('main');
  h.calls = [];
  h.current = {
    kind: real.kind, label: real.label, listen: real.listen,
    invoke: async (cmd, args, opts) => { h.calls.push({ cmd, args }); return cmd === 'approval_open' ? (null as never) : real.invoke(cmd, args, opts); },
  };
  render(<App />);
}
const layer = () => document.querySelector<HTMLElement>('.cs-layer');
const acts = () => h.calls.filter((c) => AUTHORITY[c.cmd as CommandName]?.tier !== 'read');

describe('locked hand-offs', () => {
  it('the deal’s gold decision', async () => {
    open('/index.html?locked=1#d=D-0193');
    const gold = await waitFor(() => { const b = layer()?.querySelector<HTMLButtonElement>('.dc-opt.gold'); if (!b) throw new Error('no gold'); return b; }, { timeout: 8000 });
    expect(gold.title).toBe(APPROVAL_LOCKED_TITLE);
    expect(gold.querySelector('svg')).not.toBeNull();
    fireEvent.click(gold);
    await waitFor(() => expect(acts()).toEqual([{ cmd: 'approval_open', args: { deal_id: expect.any(String) } }]));
  }, 30_000);

  it('Settings asks to unlock as its call, and Agent rules’ Change carries the lock', async () => {
    open('/index.html?locked=1#p=settings');
    const unlock = await waitFor(() => {
      const b = [...(layer()?.querySelectorAll<HTMLButtonElement>('.pf-call button') ?? [])].find((x) => x.textContent?.includes(SETTINGS_LOCK.unlock));
      if (!b) throw new Error('no unlock');
      return b;
    }, { timeout: 8000 });
    expect(unlock.title).toBe(APPROVAL_LOCKED_TITLE);
    expect(unlock.classList.contains('locked')).toBe(true);
    fireEvent.click(unlock);
    await waitFor(() => expect(acts()).toEqual([{ cmd: 'approval_open', args: { deal_id: null, target: 'unlock' } }]));
    cleanup();
    open('/index.html?locked=1#p=rules');
    const change = await waitFor(() => { const b = layer()?.querySelector<HTMLButtonElement>('.pf-call button.locked'); if (!b) throw new Error('no change'); return b; }, { timeout: 8000 });
    expect(change.title).toBe(APPROVAL_LOCKED_TITLE);
  }, 30_000);
});

// spark abstract-first-home, variant "zoom": a smoke test per state on the browser mock world (jsdom,
// the real hooks, the real App behind `?home=zoom`), plus the pure half (depth.ts). Clock pinned.
import { act, cleanup, fireEvent, render, renderHook, waitFor } from '@testing-library/react';
import { gettingStarted, type StartFacts } from '../../../../lib/firstRun';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../../lib/contract';
import { resetReadBudget } from '../../../../lib/data/invoke';
import { mockBackend, resetMockState } from '../../../../mock/backend';
import { setHarnessBackend } from '../../console/testing/runtime';
import { settle } from '../../console/testing/scaleSmoke';
import { App } from '../../App';
import { resetHomeView } from '../../switchboard/view';
import { landingOf, panelDepth } from './depth';
import { CONFIRM_MS, useSetupFlow } from './Setup';

vi.mock('../../../../lib/runtime', async () => (await import('../../console/testing/runtime')).runtimeMock);

const PIN = new Date('2026-11-06T19:30:00');
let calls: { cmd: string; args: unknown }[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(PIN);
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) });
  }
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  history.replaceState(null, '', '/');
  localStorage.clear();
  resetHomeView();
});

function world(search: string): void {
  localStorage.clear();
  sessionStorage.clear();
  resetHomeView();
  history.replaceState(null, '', `/index.html?home=zoom${search}`);
  resetMockState();
  const real = mockBackend('main');
  calls = [];
  resetReadBudget();
  const wrapped: Backend = {
    kind: real.kind,
    label: real.label,
    invoke: async (cmd, args, opts) => { calls.push({ cmd, args }); if (cmd === 'approval_open') return null as never; return real.invoke(cmd, args, opts); },
    listen: real.listen,
  };
  setHarnessBackend(wrapped);
}

const app = () => document.querySelector<HTMLElement>('[data-front="zoom"]')!;
const key = (k: string) => act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });

describe('zoom front door', () => {
  it('opens on the headline: one status sentence, one need, and zooms by click and by key', async () => {
    world('');
    render(<App />);
    await settle();
    await waitFor(() => expect(app().dataset.ready).toBe('true'));
    expect(document.querySelector('[data-status]')!.textContent).toMatch(/need you/);
    expect(document.querySelectorAll('[data-need]')).toHaveLength(1);
    expect(document.querySelector('[data-tile]')).toBeNull();
    // no away line on a first look (no stored "last seen")
    expect(document.querySelector('[data-more]')!.textContent).not.toMatch(/While you were away/);
    fireEvent.click(document.querySelector('[data-more]')!);
    expect(app().dataset.depth).toBe('1');
    expect(document.querySelectorAll('[data-standing]')).toHaveLength(3);
    key('+');
    expect(app().dataset.depth).toBe('2');
    expect(document.querySelectorAll('[data-tile]')).toHaveLength(6);
    fireEvent.click(document.querySelector('[data-tile="counter"]')!);
    expect(document.querySelector('[data-peek="counter"]')).not.toBeNull();
    key('Escape');
    expect(app().dataset.depth).toBe('1');
    key('Escape');
    expect(app().dataset.depth).toBe('0');
  });

  it('the first need hands off to the approval window and nothing else', async () => {
    world('');
    render(<App />);
    await settle();
    const btn = document.querySelector<HTMLButtonElement>('[data-need] [data-handoff]')!;
    calls = [];
    fireEvent.click(btn);
    await settle();
    const writes = calls.filter((c) => !/_list$|_status$|^get_|_query$|_history$|_record$|^deal_/.test(c.cmd));
    expect(writes.map((c) => c.cmd)).toEqual(['approval_open']);
  });

  it('first run: the current step is the card; keys open the secure window and the card waits', async () => {
    world('&first_run=1');
    render(<App />);
    await settle();
    expect(document.querySelector('[data-status]')!.textContent).toMatch(/set up/);
    const card = document.querySelector<HTMLElement>('[data-setup]')!;
    expect(card.dataset.setup).toBe('paypal');
    fireEvent.click(card.querySelector('button')!);
    await settle();
    expect(calls.find((c) => c.cmd === 'approval_open')?.args).toMatchObject({ target: 'credentials' });
    expect(document.querySelector('[data-waiting="paypal"]')).not.toBeNull();
    // depth 1 on first run lists the four steps
    key('+');
    expect(document.querySelectorAll('.fz-step')).toHaveLength(4);
  });

  it('back after away: the headline carries one away clause', async () => {
    world('&away=1');
    render(<App />);
    await settle();
    await waitFor(() => expect(document.querySelector('[data-more]')!.textContent).toMatch(/While you were away/));
    fireEvent.click(document.querySelector('[data-more]')!);
    expect(document.querySelector('[data-away]')).not.toBeNull();
  });
});

describe('depth.ts', () => {
  it('places each panel at the depth that holds it', () => {
    expect(panelDepth({ kind: 'decision', deal_id: 'a' }, 'a', false)).toBe(0);
    expect(panelDepth({ kind: 'decision', deal_id: 'b' }, 'a', false)).toBe(1);
    expect(panelDepth({ kind: 'safety' }, null, false)).toBe(1);
    expect(panelDepth({ kind: 'book', module: 'counter', fate: null }, null, false)).toBe(2);
    expect(panelDepth({ kind: 'setup' }, null, true)).toBe(0);
  });
  it('a reply lands where its ops point; talk alone lands nowhere', () => {
    expect(landingOf([], null, false)).toBeNull();
    expect(landingOf([{ op: 'focus', module: 'shield', fate: null, deal_id: null }], null, false)).toMatchObject({ depth: 2, module: 'shield' });
    expect(landingOf([{ op: 'filter', module: null, fate: 'needs' }], null, false)).toMatchObject({ depth: 1, panel: { kind: 'needs' } });
    expect(landingOf([{ op: 'show', panel: { kind: 'rescue' } }], null, false)).toMatchObject({ depth: 2, module: 'rescue' });
  });
});

describe('setup flow', () => {
  it('a step whose fact flips shows its confirmation, then the next step takes the card', () => {
    vi.useFakeTimers();
    const facts: StartFacts = { firstRun: true, paypal: false, rulesInForce: 0, houseConnected: false, otherConnections: 0, engine: 'scripted', engineChosen: false };
    const { result, rerender } = renderHook(({ f }) => useSetupFlow(gettingStarted(f)), { initialProps: { f: facts } });
    expect(result.current.step).toBe('paypal');
    rerender({ f: { ...facts, paypal: true } });
    expect(result.current.justDone).toBe('paypal');
    expect(result.current.step).toBe('rules');
    act(() => { vi.advanceTimersByTime(CONFIRM_MS + 10); });
    expect(result.current.justDone).toBeNull();
    // a step done on arrival is never "just done"
    const { result: r2 } = renderHook(() => useSetupFlow(gettingStarted({ ...facts, paypal: true })));
    expect(r2.current.justDone).toBeNull();
  });
});

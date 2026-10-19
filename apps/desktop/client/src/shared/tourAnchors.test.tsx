// The tour's anchors against the real windows: every stop in TOUR_STOPS names a `data-tour` element
// that its window really renders, found by the same lookup the tour uses (findAnchor). Each window
// is rendered as the owner meets it on first run (engine step not done, so the engine stops are
// present). Renaming or deleting a `data-tour` attribute in a window file fails this, where
// lib/tour.test.ts and shared/tour.test.tsx (which draw their own page) would stay green.
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { gettingStarted, type StartFacts } from '../lib/firstRun';
import { TOUR_STOPS, tourStops, type TourWindow } from '../lib/tour';
import { mockBackend, resetMockState } from '../mock/backend';
import { setHarnessBackend } from '../windows/main/console/testing/runtime';
import { App as ApprovalApp } from '../windows/approval/App';
import { App as MainApp } from '../windows/main/App';
import { WelcomeForm } from '../windows/tumbler/forms';
import { findAnchor } from './tour';

vi.mock('../lib/runtime', async () => (await import('../windows/main/console/testing/runtime')).runtimeMock);

const firstRunFacts: StartFacts = { firstRun: true, paypal: false, rulesInForce: 0, houseConnected: false, otherConnections: 0, engine: 'scripted' };
const firstRun = gettingStarted(firstRunFacts);

/** Every `data-tour` value on screen right now, hidden parts included. */
const rendered = (): Set<string> => new Set([...document.querySelectorAll<HTMLElement>('[data-tour]')].map((el) => el.dataset.tour!));

/** Every anchor each window rendered, kept for the reverse check. */
const seen = new Map<TourWindow, Set<string>>();

async function anchorsResolve(win: TourWindow): Promise<void> {
  const stops = tourStops(win, firstRun);
  // First run with the agent app not chosen: the engine stop is in the window's list.
  expect(stops.some((s) => s.anchor === 'step-engine')).toBe(true);
  await waitFor(() => {
    for (const s of stops) if (!findAnchor(s.anchor)) throw new Error(`${s.id}: no [data-tour="${s.anchor}"] on screen in the ${win} window`);
  }, { timeout: 8000 });
  for (const s of stops) expect(findAnchor(s.anchor), s.id).not.toBeNull();
  seen.set(win, rendered());
}

beforeAll(() => {
  // jsdom has no matchMedia; the console asks it for reduced motion.
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) });
  }
});
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); resetMockState(); });
afterEach(() => { cleanup(); setHarnessBackend(null); history.replaceState(null, '', '/'); });
afterAll(() => { history.replaceState(null, '', '/'); });

describe('the tour anchors are on the real windows', () => {
  it('main: the Set up page carries the hub, the promise, the steps and the agent app step; the console carries the lock button', async () => {
    history.replaceState(null, '', '/index.html?first_run=1#s=setup');
    setHarnessBackend(mockBackend('main'));
    render(<MainApp />);
    await anchorsResolve('main');
    expect(findAnchor('approval-way')?.classList.contains('lockbtn')).toBe(true);
  }, 30_000);

  it('tumbler: the welcome carries its promise, its steps and the agent app step', async () => {
    history.replaceState(null, '', '/tumbler.html?first_run=1');
    render(<WelcomeForm mode="sandbox" locked={false} onOk={() => {}} start={firstRun} />);
    await anchorsResolve('tumbler');
  });

  it('approval: the owner configuration carries the answer bar, the steps, the agent app step and the wallet', async () => {
    history.replaceState(null, '', '/approval.html?first_run=1');
    setHarnessBackend(mockBackend('approval'));
    render(<ApprovalApp />);
    await act(async () => { await Promise.resolve(); });
    await anchorsResolve('approval');
  }, 30_000);

  it('no stop points at a string that appears in no window', () => {
    expect([...seen.keys()].sort()).toEqual(['approval', 'main', 'tumbler']);
    const everywhere = new Set([...seen.values()].flatMap((s) => [...s]));
    for (const s of TOUR_STOPS) expect(everywhere.has(s.anchor), `${s.id}: [data-tour="${s.anchor}"]`).toBe(true);
    // And a stop never names an anchor only some other window renders.
    for (const s of TOUR_STOPS) expect(seen.get(s.window)?.has(s.anchor), `${s.id} in ${s.window}`).toBe(true);
  });
});

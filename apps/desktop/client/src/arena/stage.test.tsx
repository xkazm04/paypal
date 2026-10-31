// What the director stages in Break The Table (stage.ts): under the director the place lands the staged
// recorded attacks as a click on each card would, and opens the closing card; anywhere else a staged
// value is ignored. "Connect my agent app" is offered only where live mode can apply. The clock is
// pinned (the sample world is relative to now: Repo law).
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../lib/data/provider';
import { ARENA_FINALE, ARENA_LIVE_MODE } from '../lib/words/arena';
import { mockBackend, resetMockState } from '../mock/backend';
import { setHarnessBackend } from '../windows/main/console/testing/runtime';
import { ATTACK_WORDS } from './model';
import { RECORD } from './record';
import { LIVE_ASK_EVENT } from './liveReach';
import { parseArenaStage, setArenaStage } from './stage';

vi.mock('../lib/runtime', async () => (await import('../windows/main/console/testing/runtime')).runtimeMock);
// live mode stays out of it: these tests are about the staged cards and the control
vi.mock('./live', () => ({ useLive: () => ({ status: 'recorded' }), sendLiveNote: async () => false }));

const { BreakTheTable } = await import('./BreakTheTable');

function mount(host: 'page' | 'console' = 'console') {
  setHarnessBackend(mockBackend('main'));
  render(<DataProvider scope="main"><BreakTheTable host={host} /></DataProvider>);
}
const counter = () => within(screen.getByRole('region', { name: 'What your attacks did' }));
const attacks = () => counter().getAllByText(/^\d+$/)[0]?.textContent;

describe('the director stages Break The Table', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T14:02:04-08:00'));
    localStorage.clear();
    resetMockState();
  });
  afterEach(() => {
    cleanup();
    setHarnessBackend(null);
    setArenaStage(null);
    history.replaceState(null, '', '/');
    vi.useRealTimers();
  });

  it('under the director: what was staged lands at once, a new card lands after, then the closing card', async () => {
    history.replaceState(null, '', '/?take=1');
    setArenaStage({ played: ['past-the-limit'], finale: false });
    mount();
    expect(attacks()).toBe('1');
    expect(screen.getByText(ATTACK_WORDS['past-the-limit']!.held)).toBeTruthy();
    act(() => { setArenaStage({ played: ['past-the-limit', 'pay-me-now'], finale: false }); });
    // the newest card travels to the table first (as a click), then its answer lands
    await act(async () => { await new Promise((r) => setTimeout(r, 700)); });
    expect(attacks()).toBe('2');
    expect(screen.getByText(ATTACK_WORDS['pay-me-now']!.held)).toBeTruthy();
    act(() => { setArenaStage({ played: ['past-the-limit', 'pay-me-now'], finale: true }); });
    expect(screen.getByText(ARENA_FINALE.title(2, RECORD.attacks.length))).toBeTruthy();
    // staged back to nothing: the place starts over
    act(() => { setArenaStage(null); });
    expect(attacks()).toBe('0');
  });

  it('a person’s own arena never replays what a story left behind', () => {
    setArenaStage({ played: ['past-the-limit', 'pay-me-now'], finale: true });
    mount();
    expect(attacks()).toBe('0');
    expect(screen.queryByText(ARENA_FINALE.title(2, RECORD.attacks.length))).toBeNull();
  });

  it('reads only what it can: unknown ids are dropped, a broken value is nothing staged', () => {
    expect(parseArenaStage('{"played":["pay-me-now",3,"nope"],"finale":true}')).toEqual({ played: ['pay-me-now', 'nope'], finale: true });
    expect(parseArenaStage('not json')).toBeNull();
    expect(parseArenaStage(null)).toBeNull();
    history.replaceState(null, '', '/?take=1');
    setArenaStage({ played: ['nope', 'pay-me-now'], finale: false });
    mount();
    expect(attacks()).toBe('1');
  });
});

describe('"Connect my agent app"', () => {
  afterEach(() => { cleanup(); setHarnessBackend(null); history.replaceState(null, '', '/'); });

  it('is offered on a plain page and asks live mode to look once', () => {
    const asked = vi.fn();
    window.addEventListener(LIVE_ASK_EVENT, asked);
    try {
      mount('page');
      fireEvent.click(screen.getByRole('button', { name: ARENA_LIVE_MODE.connect }));
      expect(asked).toHaveBeenCalledTimes(1);
      expect(screen.getByText(ARENA_LIVE_MODE.looking)).toBeTruthy();
    } finally {
      window.removeEventListener(LIVE_ASK_EVENT, asked);
    }
  });

  it('is not offered under the director (live mode never applies there)', () => {
    history.replaceState(null, '', '/?take=film');
    mount('console');
    expect(screen.queryByRole('button', { name: ARENA_LIVE_MODE.connect })).toBeNull();
  });
});

// The arena's safety record panel says whose record it reads: Maya's sample week on the browser mock or a
// desktop demo, the owner's own in the desktop app's live wallet (the console place "Try to break it"
// runs there too). The clock is pinned (the sample world is relative to now: Repo law).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../lib/data/provider';
import { pinDemo } from '../lib/preview';
import { ARENA_SAFETY, arenaSafetyWords } from '../lib/words/arena';
import { mockBackend, resetMockState } from '../mock/backend';
import { setHarnessBackend } from '../windows/main/console/testing/runtime';
import { SafetyPanel, sampleRecord } from './Side';

vi.mock('../lib/runtime', async () => (await import('../windows/main/console/testing/runtime')).runtimeMock);

const w = window as unknown as { __TAURI_INTERNALS__?: unknown };

describe('whose safety record the arena shows', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T14:02:04-08:00'));
    resetMockState();
    setHarnessBackend(mockBackend('main'));
  });
  afterEach(() => {
    cleanup();
    setHarnessBackend(null);
    pinDemo(null);
    delete w.__TAURI_INTERNALS__;
    vi.useRealTimers();
  });

  it('is sample data in a browser and in a desktop demo, the owner’s own in the desktop app’s live wallet', () => {
    expect(sampleRecord()).toBe(true);
    w.__TAURI_INTERNALS__ = {};
    pinDemo({ kind: 'live' });
    expect(sampleRecord()).toBe(false);
    pinDemo({ kind: 'demo', state: { world: 'sample', degrade: false, locked: false }, source: 'stored' });
    expect(sampleRecord()).toBe(true);
  });

  it('labels the sample week as Maya’s on sample data', () => {
    render(<DataProvider scope="main"><SafetyPanel plays={[]} sample /></DataProvider>);
    expect(screen.getByRole('heading', { name: ARENA_SAFETY.heading })).toBeTruthy();
    expect(screen.getByText(ARENA_SAFETY.sub)).toBeTruthy();
  });

  it('says "Your safety record", with no sample-week words, on the live wallet', () => {
    render(<DataProvider scope="main"><SafetyPanel plays={[]} sample={false} /></DataProvider>);
    const own = arenaSafetyWords(false);
    expect(own.heading).toBe('Your safety record');
    expect(screen.getByRole('heading', { name: own.heading })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Maya|sample week|preview/i);
  });
});

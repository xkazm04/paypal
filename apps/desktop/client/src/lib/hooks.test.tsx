import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// useQuery must never show one request's answer under another request's arguments (a deal
// switch), and a slow old answer must not overwrite a newer one.
const pending = new Map<string, (v: unknown) => void>();
const fake = {
  invoke: vi.fn((_cmd: string, args: { deal_id: string }) => new Promise((res) => { pending.set(args.deal_id, res); })),
  listen: vi.fn(async () => () => {}),
};
vi.mock('./runtime', () => ({ backend: () => fake }));

import { nowSnapshot, useEvent, useNow, usePrefersReducedMotion, useQuery } from './hooks';
import { setCalm } from '../design/motion';

afterEach(() => { cleanup(); pending.clear(); });

const run = () => renderHook(({ id }) => useQuery('deal_display' as never, { deal_id: id } as never) as { data: unknown; loading: boolean }, { initialProps: { id: 'A' } });

describe('useQuery', () => {
  it('drops the old answer while the new arguments load', async () => {
    const h = run();
    await act(async () => { pending.get('A')?.({ label: 'deal A' }); });
    await waitFor(() => expect(h.result.current.data).toEqual({ label: 'deal A' }));
    h.rerender({ id: 'B' });
    expect(h.result.current.data).toBeUndefined();
    expect(h.result.current.loading).toBe(true);
    await act(async () => { pending.get('B')?.({ label: 'deal B' }); });
    await waitFor(() => expect(h.result.current.data).toEqual({ label: 'deal B' }));
    expect(h.result.current.loading).toBe(false);
  });

  it('ignores a slow answer for arguments that are no longer asked', async () => {
    const h = run();
    h.rerender({ id: 'B' });
    await act(async () => { pending.get('B')?.({ label: 'deal B' }); });
    await waitFor(() => expect(h.result.current.data).toEqual({ label: 'deal B' }));
    await act(async () => { pending.get('A')?.({ label: 'deal A' }); });
    expect(h.result.current.data).toEqual({ label: 'deal B' });
  });
});

// The in-app calm mode (design/motion.ts, set from The Table's settings and followed by the other
// windows) must calm every JS-timed motion, not only the CSS ones: the hook reads both.
describe('usePrefersReducedMotion', () => {
  const adds = vi.fn();
  const stubQuery = () => vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: adds, removeEventListener: () => undefined }));
  afterEach(() => { setCalm(false); adds.mockClear(); vi.unstubAllGlobals(); });

  it('is calm when the owner turned the in-app calm mode on, with the OS setting off', () => {
    stubQuery();
    const h = renderHook(() => usePrefersReducedMotion());
    expect(h.result.current).toBe(false);
    act(() => setCalm(true));
    expect(h.result.current).toBe(true);
    act(() => setCalm(false));
    expect(h.result.current).toBe(false);
  });

  it('listens to the OS setting once, not again on every render', () => {
    stubQuery();
    const h = renderHook(() => usePrefersReducedMotion());
    h.rerender(); h.rerender(); h.rerender();
    expect(adds).toHaveBeenCalledTimes(1);
  });
});

// A subscription the shell refuses must leave a trace, the way lib/data/bus.ts reports its own,
// instead of an unhandled rejection nobody sees.
describe('useEvent', () => {
  it('reports a refused subscription and keeps the window drawing', async () => {
    const seen = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fake.listen.mockRejectedValueOnce(new Error('event not allowed'));
    renderHook(() => useEvent('deal:changed' as never, () => undefined));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(seen).toHaveBeenCalledWith('event subscription failed', 'deal:changed', expect.any(Error));
    seen.mockRestore();
  });
});

describe('useNow: a stable snapshot within a tick', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('two reads in the same second, and across a second boundary inside one task, are identical; the next task reads the new second', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-10-30T19:30:00.998Z'));
    await Promise.resolve();
    const a = nowSnapshot();
    expect(nowSnapshot()).toBe(a);
    // the second ends between two reads of the same render (the flake): still the same value
    vi.setSystemTime(new Date('2026-10-30T19:30:01.002Z'));
    expect(nowSnapshot()).toBe(a);
    // a later task reads the clock again
    await Promise.resolve();
    expect(nowSnapshot()).toBe(a + 1);
  });

  it('while a countdown is drawn, it moves only on the tick after the second boundary', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-10-30T19:30:00.000Z'));
    await Promise.resolve();
    const h = renderHook(() => useNow());
    const start = h.result.current;
    expect(nowSnapshot()).toBe(start);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(h.result.current).toBe(start);
    expect(nowSnapshot()).toBe(start);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(h.result.current).toBe(start + 1);
    h.unmount();
  });
});

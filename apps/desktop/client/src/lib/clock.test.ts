import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { clockNow, clockOffset, isClockSimulated, onClockChange, resetClockForTests, setClockOffset, simulateClock } from './clock';
import { countdown, nowUnix } from './format';
import { useNow } from './hooks';

afterEach(() => {
  resetClockForTests();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe('the one client clock', () => {
  it('is wall time and ignores offsets until the preview turns simulation on', () => {
    const wall = Math.floor(Date.now() / 1000);
    expect(Math.abs(clockNow() - wall)).toBeLessThanOrEqual(1);
    setClockOffset(3600);
    expect(clockOffset()).toBe(0);
    expect(isClockSimulated()).toBe(false);
  });

  it('is a passthrough inside the desktop shell: simulation refuses there', () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(simulateClock()).toBe(false);
    setClockOffset(4 * 3600);
    expect(clockOffset()).toBe(0);
  });

  it('moves nowUnix and every countdown together in a preview, and notifies on a jump', () => {
    expect(simulateClock()).toBe(true);
    const seen: number[] = [];
    const off = onClockChange(() => seen.push(clockOffset()));
    const deadline = nowUnix() + 4 * 3600;
    setClockOffset(4 * 3600 - 14 * 60);
    expect(countdown(deadline, nowUnix())).toMatch(/^0:1[34]:\d\d$/);
    setClockOffset(4 * 3600 - 14 * 60); // same value: no notification
    setClockOffset(Number.NaN); // ignored
    off();
    setClockOffset(10);
    expect(seen).toEqual([4 * 3600 - 14 * 60]);
  });

  it('re-renders useNow at once when the preview clock jumps', () => {
    simulateClock();
    const { result } = renderHook(() => useNow());
    const before = result.current;
    act(() => setClockOffset(7200));
    expect(result.current - before).toBeGreaterThanOrEqual(7199);
  });

  it('a countdown drawn after a quiet spell reads the time now, not the time the last one left', () => {
    cleanup(); // no countdown on screen
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const first = renderHook(() => useNow());
    expect(first.result.current).toBe(1_800_000_000);
    first.unmount();
    vi.setSystemTime(1_800_000_600_000); // ten minutes with no countdown on screen
    const next = renderHook(() => useNow());
    expect(next.result.current).toBe(1_800_000_600);
    next.unmount();
    vi.useRealTimers();
  });
});

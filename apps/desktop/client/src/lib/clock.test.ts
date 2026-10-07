import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
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
});

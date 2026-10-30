// The Rewind's clock past "now": the playhead may run 72 hours past now (never past a past week's end), play stops on the Now
// line for a beat before it goes on into the forecast, a glide ends where it was told to and any seek cancels it, and with
// reduced motion play steps from event to event, Now included.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HORIZON_SECS } from './future';
import { NOW_HOLD_MS, useRewind } from './clock';

vi.mock('../../../../../lib/hooks', async (orig) => ({ ...(await orig<typeof import('../../../../../lib/hooks')>()), useQuery: () => ({ data: { steps: [], truncated: false }, error: null, loading: false, refetch: async () => {} }) }));
vi.mock('../../../unshown', () => ({ useEndedUnshown: () => ({ unshown: new Set<string>(), unread: new Set<string>(), pending: false }) }));

// Wednesday 2026-10-28 09:00 local: the week runs Monday to Monday, now is 2 days and 9 hours in
const NOW = Math.floor(new Date(2026, 9, 28, 9, 0).getTime() / 1000);
const MON = Math.floor(new Date(2026, 9, 26, 0, 0).getTime() / 1000);

beforeEach(() => { vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] }); });
afterEach(() => { vi.useRealTimers(); });

const run = (reduced = false, stops: number[] = []) => renderHook(({ now }) => useRewind(true, now, reduced, stops), { initialProps: { now: NOW } });

describe('the track past now', () => {
  it('opens at now and may run 72 hours past it', () => {
    const { result } = run();
    expect(result.current.t).toBe(NOW);
    expect(result.current.now).toBe(NOW);
    expect(result.current.limit).toBe(NOW + HORIZON_SECS);
    expect(result.current.ahead).toBe(true);
    // the track reaches the later of the week's end and the forecast's end
    expect(result.current.stop).toBe(Math.max(result.current.end, NOW + HORIZON_SECS));
    act(() => result.current.seek(NOW + 10 * 86400));
    expect(result.current.t).toBe(NOW + HORIZON_SECS);
    act(() => result.current.seek(0));
    expect(result.current.t).toBe(MON);
  });

  it('a past week ends where it always did', () => {
    const { result } = run();
    act(() => result.current.shiftWeek(-1));
    expect(result.current.ahead).toBe(false);
    expect(result.current.limit).toBe(result.current.end);
    expect(result.current.stop).toBe(result.current.end);
    act(() => result.current.seek(result.current.end + 5 * 86400));
    expect(result.current.t).toBe(result.current.end);
  });
});

describe('play and glide', () => {
  it('play stops on Now for a beat, then goes on into the forecast', () => {
    const { result } = run();
    act(() => result.current.seek(MON));
    act(() => result.current.play());
    const at = (ms: number) => { act(() => { vi.advanceTimersByTime(ms); }); return result.current.t; };
    let t = MON;
    let held = 0;
    let last = -1;
    for (let i = 0; i < 400 && t < NOW + HORIZON_SECS; i++) {
      t = at(50);
      if (t === NOW && last === NOW) held += 50;
      last = t;
    }
    // it sat on Now for about the hold, then ran to the end of the forecast and stopped
    expect(held).toBeGreaterThanOrEqual(NOW_HOLD_MS - 200);
    expect(held).toBeLessThanOrEqual(NOW_HOLD_MS + 400);
    expect(result.current.t).toBe(NOW + HORIZON_SECS);
    expect(result.current.playing).toBe(false);
  });

  it('a glide ends where it was told to, and a seek cancels it', () => {
    const { result } = run();
    act(() => result.current.glide(NOW + 20 * 3600, 1000));
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current.t).toBeGreaterThan(NOW);
    expect(result.current.t).toBeLessThan(NOW + 20 * 3600);
    act(() => { vi.advanceTimersByTime(1200); });
    expect(result.current.t).toBe(NOW + 20 * 3600);
    // cancelled midway by the owner moving the playhead
    act(() => result.current.glide(NOW + 60 * 3600, 1000));
    act(() => { vi.advanceTimersByTime(200); });
    act(() => result.current.seek(NOW));
    act(() => { vi.advanceTimersByTime(1500); });
    expect(result.current.t).toBe(NOW);
  });

  it('with reduced motion a glide is a jump, and play steps from event to event, Now included', () => {
    const stops = [NOW + 5 * 3600, NOW + 30 * 3600];
    const { result } = run(true, stops);
    act(() => result.current.glide(NOW + 20 * 3600, 1000));
    expect(result.current.t).toBe(NOW + 20 * 3600);
    act(() => result.current.seek(NOW - 3 * 86400));
    act(() => result.current.play());
    const seen: number[] = [];
    for (let i = 0; i < 40 && result.current.playing; i++) { act(() => { vi.advanceTimersByTime(1200); }); seen.push(result.current.t); }
    expect(seen).toContain(NOW);
    expect(seen).toContain(stops[0]);
    expect(seen).toContain(stops[1]);
    expect(seen.at(-1)).toBe(NOW + HORIZON_SECS);
  });
});

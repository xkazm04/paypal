// useAway must not re-render its host every second. `now` feeds awaySummary only through three things:
// the "since ..." words (a local day), whether a quiet stretch is long enough to be news (a 30 minute
// threshold) and the window's upper bound (read fresh whenever the record changes). So the hook follows
// two derived values, the local day and the long-quiet flag, and renders when one of them changes.
// The one-second clock is the control: the same host on useNow() renders once per tick.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryStep } from '@bindings/HistoryStep';
import { useNow } from '../../../lib/hooks';
import { QUIET_NEWS_AFTER, startOfToday } from './away';
import { useAway } from './useAway';

const data = vi.hoisted(() => ({ value: { steps: [] as HistoryStep[], truncated: false } }));
vi.mock('../../../lib/hooks', async (orig) => ({ ...(await orig<typeof import('../../../lib/hooks')>()), useQuery: () => ({ data: data.value, error: null, refetch: async () => {} }) }));
vi.mock('../unshown', async (orig) => ({ ...(await orig<typeof import('../unshown')>()), useEndedUnshown: () => ({ unshown: new Set<string>(), unread: new Set<string>(), pending: false }) }));

const START = new Date(2026, 10, 6, 9, 30, 0);
let renders = 0;
const Away = () => { renders += 1; useAway({ active: false, enabled: true, needs: 0, deals: [] }); return null; };
const Control = () => { renders += 1; useNow(); return null; };

async function measure(C: () => null, seconds: number): Promise<number> {
  renders = 0;
  render(<C />);
  const mounted = renders;
  for (let i = 0; i < seconds; i += 1) await act(async () => { vi.advanceTimersByTime(1000); });
  const total = renders - mounted;
  cleanup();
  return total;
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });

describe('useAway and the clock', () => {
  it('renders once per tick on the raw clock (control), and not at all while nothing it shows changes', async () => {
    const control = await measure(Control, 60);
    const hook = await measure(Away, 60);
    console.info(`[useAway.clock] renders over 60 simulated seconds: raw useNow control=${control}, useAway host=${hook}`);
    expect(control).toBeGreaterThanOrEqual(59);
    expect(hook).toBeLessThanOrEqual(1);
  });

  it('still renders when its answer changes: local midnight', async () => {
    vi.setSystemTime(new Date(2026, 10, 6, 23, 59, 50));
    renders = 0;
    render(<Away />);
    const mounted = renders;
    expect(startOfToday(Math.floor(Date.now() / 1000))).toBeGreaterThan(0);
    for (let i = 0; i < 20; i += 1) await act(async () => { vi.advanceTimersByTime(1000); });
    expect(renders - mounted).toBe(1);
  });

  it('still renders when the quiet stretch becomes long enough to be news', async () => {
    // last seen at the start of today (nothing stored); the flag flips at start-of-day + 30 minutes
    vi.setSystemTime(new Date(2026, 10, 6, 0, 29, 50));
    renders = 0;
    render(<Away />);
    const mounted = renders;
    for (let i = 0; i < 20; i += 1) await act(async () => { vi.advanceTimersByTime(1000); });
    expect(renders - mounted).toBe(1);
    expect(QUIET_NEWS_AFTER).toBe(1800);
  });
});

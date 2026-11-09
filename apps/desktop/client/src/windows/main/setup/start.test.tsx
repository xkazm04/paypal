// useStart reads the clock through useClock (client perf, spark perfection-ten B1): the console that
// calls it (the whole frame and every unmemoised layer) no longer re-renders on the one-second tick;
// it re-renders only when the count of rules in force changes. Counted through the hook itself: each
// console render calls useStart once. Read-only: nothing here moves money.
import { act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const n = vi.hoisted(() => ({ start: 0 }));
vi.mock('../../../lib/runtime', async () => (await import('../console/testing/runtime')).runtimeMock);
vi.mock('./start', async (orig) => {
  const real = await orig<typeof import('./start')>();
  return { ...real, useStart: () => { n.start += 1; return real.useStart(); } };
});

import { renderLayerAtScale } from '../console/testing/scaleSmoke';

const T0 = Date.UTC(2026, 10, 9, 14, 0, 20);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => { cleanup(); vi.useRealTimers(); history.replaceState(null, '', '/'); });

describe('useStart at idle', () => {
  it('does not re-render the console each second', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const r = await renderLayerAtScale({ level: 'home' }, null);
    expect(n.start, 'the console rendered').toBeGreaterThan(0);
    n.start = 0;
    for (let i = 1; i <= 3; i += 1) {
      vi.setSystemTime(T0 + i * 1000);
      await act(async () => { await sleep(1050); });
    }
    console.info(`\nconsole renders in three idle seconds: ${n.start}`);
    expect(n.start, 'no console render on the tick').toBe(0);
    expect(r.errors).toEqual([]);
  }, 60_000);
});

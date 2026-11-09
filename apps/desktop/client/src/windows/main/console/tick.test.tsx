// The one-second clock, contained (client perf). The decision centre and the footer do not re-render
// whole every second: only the leaves that show a time do, and a leaf that shows minutes ("3 h 12 min
// left", the footer's 14:05) re-renders when the minute turns. With no event at all the time-left
// lines and the "If you do nothing" countdown still move. Renders are counted through a hook each
// part calls once per render: the decision reads its deal's display (useDisplayOf with a waiting
// deal's id), the footer's body listens to tumbler:status, the stack row reads useAway, the clock
// leaves read useClock / useNow. Read-only: nothing here moves money.
import { act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const n = vi.hoisted(() => ({ decision: 0, footer: 0, stack: 0, minute: 0, second: 0, waiting: new Set<string>() }));
vi.mock('../../../lib/runtime', async () => (await import('./testing/runtime')).runtimeMock);
vi.mock('../../../lib/hooks', async (orig) => {
  const real = await orig<typeof import('../../../lib/hooks')>();
  return {
    ...real,
    useEvent: ((e: string, cb: never) => { if (e === 'tumbler:status') n.footer += 1; return real.useEvent(e as never, cb); }) as unknown as typeof real.useEvent,
    useClock: ((s: never) => { n.minute += 1; return real.useClock(s); }) as unknown as typeof real.useClock,
    useNow: () => { n.second += 1; return real.useNow(); },
  };
});
vi.mock('../world', async (orig) => {
  const real = await orig<typeof import('../world')>();
  return { ...real, useDisplayOf: (id: string | undefined) => { if (id !== undefined && n.waiting.has(id)) n.decision += 1; return real.useDisplayOf(id); } };
});
vi.mock('../home/useAway', async (orig) => {
  const real = await orig<typeof import('../home/useAway')>();
  return { ...real, useAway: (o: Parameters<typeof real.useAway>[0]) => { n.stack += 1; return real.useAway(o); } };
});

import { mockBackend } from '../../../mock/backend';
import { renderLayerAtScale } from './testing/scaleSmoke';

const T0 = Date.UTC(2026, 10, 9, 14, 0, 20);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const zero = () => { n.decision = 0; n.footer = 0; n.stack = 0; n.minute = 0; n.second = 0; };

afterEach(() => { cleanup(); vi.useRealTimers(); history.replaceState(null, '', '/'); });

describe('the centre and the footer at idle', () => {
  it('re-render only their clock leaves each second, and the time lines move with no event', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const r = await renderLayerAtScale({ level: 'home' }, null);
    const att = await mockBackend('main').invoke('attention_list', null);
    n.waiting = new Set(att.items.map((i) => i.deal_id));
    const left = () => document.querySelector('.cs-decision .cs-left')?.textContent ?? '';
    const silence = () => document.querySelector('.cs-silence .cs-sil-cd')?.textContent ?? '';
    const clock = () => document.querySelector('.cs-clk')?.textContent ?? '';
    expect(document.querySelector('.cs-decision'), 'a decision is in front').not.toBeNull();
    const before = { left: left(), silence: silence(), clock: clock() };

    // Three idle seconds, inside one minute (14:00:20 -> 14:00:23).
    zero();
    for (let i = 1; i <= 3; i += 1) {
      vi.setSystemTime(T0 + i * 1000);
      await act(async () => { await sleep(1050); });
    }
    const per = (x: number) => (x / 3).toFixed(1);
    console.info(`\nidle renders per second: decision ${per(n.decision)}, footer body ${per(n.footer)}, stack row ${per(n.stack)}, minute leaves ${per(n.minute)}, second leaves ${per(n.second)}`);
    expect(n.decision, 'the decision does not re-render on the tick').toBe(0);
    expect(n.footer, 'the footer does not re-render on the tick').toBe(0);
    expect(clock()).toBe(before.clock);

    // An hour later, still no event: every time line has moved.
    vi.setSystemTime(T0 + 3_600_000 + 3000);
    await act(async () => { await sleep(1050); });
    expect(clock()).not.toBe(before.clock);
    if (before.left && !/time is up/.test(before.left)) expect(left()).not.toBe(before.left);
    if (before.silence) expect(silence()).not.toBe(before.silence);
    expect(n.decision, 'still no whole-decision render').toBe(0);
    expect(r.errors).toEqual([]);
  }, 60_000);
});

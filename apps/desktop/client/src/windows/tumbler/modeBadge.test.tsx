// U2 on the Tumbler: the mode badge is on its forms (Flags in forms.tsx) and on the ticker line.
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../lib/contract';
import { modeWord } from '../../lib/words';
import { mockBackend, resetMockState } from '../../mock/backend';
import { setHarnessBackend } from '../main/console/testing/runtime';
import { Flags, TickerForm } from './forms';
import { Tumbler } from './Tumbler';

vi.mock('../../lib/runtime', async () => (await import('../main/console/testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); setHarnessBackend(null); resetMockState(); });

describe('U2: the Tumbler carries a mode badge', () => {
  it('the live Tumbler on the mock wallet draws the wallet’s mode badge on its stack form', async () => {
    resetMockState();
    const real = mockBackend('tumbler');
    const listeners = new Map<string, Set<(p: unknown) => void>>();
    setHarnessBackend({
      ...real,
      listen: (async (event: string, cb: (p: unknown) => void) => {
        const set = listeners.get(event) ?? new Set();
        set.add(cb);
        listeners.set(event, set);
        return (real.listen as (e: string, c: (p: unknown) => void) => Promise<() => void>)(event, cb);
      }) as Backend['listen'],
    });
    const { container } = render(<Tumbler />);
    await waitFor(() => {
      if (!container.querySelector('.f.stack')) act(() => { for (const cb of listeners.get('tumbler:form') ?? []) cb('stack'); });
      expect(container.querySelector('.f.stack .flags .badge')).not.toBeNull();
    }, { timeout: 8000 });
    expect(container.querySelector('.f.stack .flags .badge')!.textContent).toBe(modeWord(real.world.settings().mode));
  }, 15_000);

  it.each([['sandbox', 'Sandbox'], ['replay', 'Replay'], ['scripted_engine', 'Practice agent']] as const)('Flags draws the %s badge, locked or not', (mode, word) => {
    for (const locked of [false, true]) {
      const { container, unmount } = render(<Flags mode={mode} locked={locked} />);
      expect(container.querySelector('.badge')?.textContent).toBe(word);
      unmount();
    }
  });

  it('Flags draws no badge until the mode is known', () => {
    const { container } = render(<Flags mode={null} locked={false} />);
    expect(container.querySelector('.badge')).toBeNull();
  });

  it('the ticker line carries the itemâ€™s mode badge', () => {
    const ticker = { key: 'k', kind: 'info', l1: ['Paid ', '$5.00', ' to Dan'], l2: 'just now', mode: 'replay' } as unknown as Parameters<typeof TickerForm>[0]['ticker'];
    const { container } = render(<TickerForm ticker={ticker} onOpen={() => {}} />);
    expect(container.querySelector('.l2 .badge')?.textContent).toBe('Replay');
  });
});

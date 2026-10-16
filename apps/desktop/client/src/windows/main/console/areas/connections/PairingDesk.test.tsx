// A copy built with no relay address says so in plain words, not as a passing network fault
// (DECISIONS §42 item 2, "Built in once deployed").
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../../../lib/contract';
import { PAIR } from '../../../../../lib/words/connections';
import { mockBackend, resetMockState } from '../../../../../mock/backend';
import { WorldProvider } from '../../../world';
import { PairingDesk } from './PairingDesk';
import { JOIN_ATTEMPTS, JOIN_RETRY_MS } from './joinRetry';

const hoisted = vi.hoisted(() => ({ current: null as Backend | null }));
vi.mock('../../../../../lib/runtime', () => ({ backend: () => hoisted.current }));

function withoutRelay(): Backend {
  const real = mockBackend('main');
  return {
    kind: real.kind,
    label: real.label,
    listen: (e, cb) => real.listen(e, cb),
    invoke: async (cmd, args, opts) => {
      const r = await real.invoke(cmd, args, opts);
      if (cmd === 'get_settings') return { ...(r as object), relay_available: false, house: 'unavailable' } as typeof r;
      return r;
    },
  };
}

describe('a copy with no relay', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); resetMockState(); });
  afterEach(() => { cleanup(); hoisted.current = null; });

  it('says it is not set up, not Offline', async () => {
    hoisted.current = withoutRelay();
    render(<WorldProvider><PairingDesk mode="house" setMode={() => {}} /></WorldProvider>);
    expect(await screen.findByText(PAIR.offline)).toBeTruthy();
    expect(screen.getByText(PAIR.offlineText)).toBeTruthy();
    expect(screen.queryByText('Offline')).toBeNull();
    expect(document.body.textContent).not.toMatch(/meeting point/i);
  });

  it('keeps the wake and retry words away from the not-set-up state', () => {
    for (const w of [PAIR.offline, PAIR.offlineText, PAIR.noRelayHint, PAIR.houseState.unavailable, PAIR.notInVersion]) {
      expect(w).not.toMatch(/offline|meeting point|waking|try again/i);
    }
    expect(PAIR.offlineText).not.toMatch(/—/);
  });
});

// Commit-then-reveal (DECISIONS §47): the joiner's first pairing_join answers "not available yet"
// until the initiator has polled and revealed. Join mode retries that one answer; nothing else.
const NOT_YET = { code: 'UNAVAILABLE', message: 'Pairing offer is not available yet' };

/** A backend whose pairing_join throws the given errors in order, then lets the mock succeed. */
function joinScript(errors: Array<{ code: string; message: string }>, calls: { n: number }): Backend {
  const real = mockBackend('main');
  return {
    kind: real.kind,
    label: real.label,
    listen: (e, cb) => real.listen(e, cb),
    invoke: async (cmd, args, opts) => {
      if (cmd === 'pairing_join') {
        const err = errors[calls.n];
        calls.n += 1;
        if (err) throw err;
      }
      return real.invoke(cmd, args, opts);
    },
  };
}

async function joinWith(mode: 'join' | 'house') {
  render(<WorldProvider><PairingDesk mode={mode} setMode={() => {}} /></WorldProvider>);
  if (mode === 'join') fireEvent.change(await screen.findByPlaceholderText(PAIR.theirCodePlaceholder), { target: { value: 'ABCD-EFGH' } });
  fireEvent.change(await screen.findByPlaceholderText(PAIR.paidToPlaceholder), { target: { value: 'maya@example.com' } });
  await act(async () => { fireEvent.submit(document.querySelector('form')!); });
}

const settle = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('joining while the initiator has not revealed yet', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); resetMockState(); vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { cleanup(); vi.useRealTimers(); hoisted.current = null; });

  it('retries "not available yet" and shows the words with no error in between', async () => {
    const calls = { n: 0 };
    hoisted.current = joinScript([NOT_YET, NOT_YET], calls);
    await joinWith('join');
    expect(calls.n).toBe(1);
    expect(screen.queryByText(/not available yet/i)).toBeNull();
    expect(screen.getByText(PAIR.joining)).toBeTruthy();
    await settle(JOIN_RETRY_MS);
    expect(calls.n).toBe(2);
    expect(screen.queryByText(/not available yet/i)).toBeNull();
    await settle(JOIN_RETRY_MS);
    expect(calls.n).toBe(3);
    expect(screen.queryByText(/not available yet/i)).toBeNull();
    expect(await screen.findAllByText(/otter/i)).not.toHaveLength(0);
  });

  it('shows the error only after the last attempt, and calls exactly the cap', async () => {
    const calls = { n: 0 };
    hoisted.current = joinScript(Array(20).fill(NOT_YET), calls);
    await joinWith('join');
    for (let i = 1; i < JOIN_ATTEMPTS; i += 1) {
      expect(screen.queryByText(/not available yet/i)).toBeNull();
      await settle(JOIN_RETRY_MS);
    }
    expect(calls.n).toBe(JOIN_ATTEMPTS);
    expect(await screen.findByText(/not available yet/i)).toBeTruthy();
    await settle(JOIN_RETRY_MS * 3);
    expect(calls.n).toBe(JOIN_ATTEMPTS);
  });

  it('does not retry in house mode: its UNAVAILABLE means the HOUSE is waking', async () => {
    const calls = { n: 0 };
    hoisted.current = joinScript(Array(20).fill(NOT_YET), calls);
    const real = hoisted.current;
    const base = real.invoke;
    hoisted.current = { ...real, invoke: async (cmd, args, opts) => (cmd === 'get_settings' ? { ...((await base(cmd, args, opts)) as object), relay_available: true, house: 'ready' } as never : base(cmd, args, opts)) };
    await joinWith('house');
    await settle(JOIN_RETRY_MS * JOIN_ATTEMPTS);
    expect(calls.n).toBe(1);
    expect(await screen.findByText(PAIR.mayWake)).toBeTruthy();
  });

  it('does not retry another error code, nor another message', async () => {
    for (const err of [{ code: 'INVALID', message: 'Pairing offer is not available yet' }, { code: 'UNAVAILABLE', message: 'the relay is unreachable' }]) {
      const calls = { n: 0 };
      hoisted.current = joinScript(Array(20).fill(err), calls);
      await joinWith('join');
      await settle(JOIN_RETRY_MS * JOIN_ATTEMPTS);
      expect(calls.n).toBe(1);
      cleanup();
    }
  });
});

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryStep } from '@bindings/HistoryStep';
import type { Backend } from '../../lib/contract';
import { READ_TIMEOUT_MS } from '../../lib/readEach';
import { endingsToRead, useEndedUnshown } from './unshown';

const hoisted = vi.hoisted(() => ({ current: null as Backend | null }));
vi.mock('../../lib/runtime', () => ({ backend: () => hoisted.current }));

let seq = 0;
function step(deal_id: string, at: number, kind: HistoryStep['kind'], paypal: HistoryStep['paypal'] = { type: 'none' }): HistoryStep {
  seq += 1;
  return { at, deal_id, seq, kind, state_after: null, authority: { type: 'safe_default' }, paypal };
}

describe('endingsToRead', () => {
  it('does not read an expired step whose check is in the steps', () => {
    expect(endingsToRead([step('A', 1, 'checking_with_paypal'), step('A', 2, 'expired')])).toEqual([]);
  });
  it('reads an expired step and a lapsed step with no check in the steps', () => {
    expect(endingsToRead([step('A', 2, 'expired'), step('B', 3, 'lapsed')])).toEqual(['A', 'B']);
  });
  it('does not read a step that is not an ending', () => {
    expect(endingsToRead([step('A', 1, 'captured'), step('B', 2, 'refused')])).toEqual([]);
  });
  it('returns ids sorted and distinct', () => {
    expect(endingsToRead([step('C', 1, 'expired'), step('A', 2, 'lapsed'), step('C', 3, 'lapsed'), step('B', 4, 'expired')])).toEqual(['A', 'B', 'C']);
  });
});

describe('useEndedUnshown', () => {
  const invoke = vi.fn();
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (cmd: string, args: { deal_id: string }) => {
      if (cmd !== 'deal_evidence') throw new Error(`unexpected ${cmd}`);
      if (args.deal_id === 'C') throw new Error('unreadable');
      return { money_check: args.deal_id === 'A' ? { open: true } : null };
    });
    // Safe: the hook calls only deal_evidence, which the stub answers.
    hoisted.current = { invoke } as unknown as Backend;
  });
  const endings = [step('A', 2, 'expired'), step('B', 3, 'lapsed'), step('C', 4, 'expired')];

  it('waits, then holds exactly the deals whose record shows an open check', async () => {
    const { result } = renderHook(() => useEndedUnshown(endings, true));
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect([...result.current.unshown]).toEqual(['A']);
    // C's read failed: its ending is not known, so it is unread rather than left with the calm words.
    expect([...result.current.unread]).toEqual(['C']);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke.mock.calls.every((c) => c[0] === 'deal_evidence')).toBe(true);
  });

  it('counts a read that never answers as unread once its time limit has passed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      invoke.mockImplementation((_cmd: string, args: { deal_id: string }) =>
        args.deal_id === 'B' ? new Promise(() => {}) : Promise.resolve({ money_check: args.deal_id === 'A' ? { open: true } : null }));
      const { result } = renderHook(() => useEndedUnshown(endings, true));
      expect(result.current.pending).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS - 1); });
      expect(result.current.pending).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      // testing-library's waitFor awaits a real setTimeout(0) and advances fake timers only under jest, so real timers come back once the time limit has been crossed.
      vi.useRealTimers();
      await waitFor(() => expect(result.current.pending).toBe(false));
      expect([...result.current.unread]).toEqual(['B']);
      expect([...result.current.unshown]).toEqual(['A']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads nothing when disabled', () => {
    const { result } = renderHook(() => useEndedUnshown(endings, false));
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.unshown.size).toBe(0);
    expect(result.current.pending).toBe(false);
  });

  it('reads nothing when no step is an ending', () => {
    const steps = [step('A', 1, 'captured')];
    const { result } = renderHook(() => useEndedUnshown(steps, true));
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
  });
});

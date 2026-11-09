import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// useMutation's pending and error describe the latest run. A run the owner already replaced (a second
// question asked in Book > Ask while the first is still out, a pairing poll that outlived the next)
// must not end the latest run's loading state or put its own failure under the latest answer.
const settle: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];
const fake = {
  invoke: vi.fn(() => new Promise((resolve, reject) => { settle.push({ resolve, reject }); })),
  listen: vi.fn(async () => () => {}),
};
vi.mock('./runtime', () => ({ backend: () => fake }));

import { useMutation } from './hooks';

afterEach(() => { cleanup(); settle.length = 0; });

describe('useMutation with overlapping runs', () => {
  it('keeps pending and error for the latest run when an older run settles later', async () => {
    const h = renderHook(() => useMutation('book_query'));
    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();
    act(() => { first = h.result.current.run({ query: 'A' } as never); });
    act(() => { second = h.result.current.run({ query: 'B' } as never); });
    expect(h.result.current.pending).toBe(true);

    // The replaced run fails while the latest one is still out.
    await act(async () => { settle[0]?.reject({ code: 'UNAVAILABLE', message: 'first question timed out' }); await first; });
    expect(h.result.current.pending).toBe(true);
    expect(h.result.current.error).toBeNull();

    // The latest run answers: done, and no failure from the replaced run is left on screen.
    await act(async () => { settle[1]?.resolve({ rows: [] }); await second; });
    expect(h.result.current.pending).toBe(false);
    expect(h.result.current.error).toBeNull();
  });

  it('still reports the latest run failing after an older run answered', async () => {
    const h = renderHook(() => useMutation('book_query'));
    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();
    act(() => { first = h.result.current.run({ query: 'A' } as never); });
    act(() => { second = h.result.current.run({ query: 'B' } as never); });
    await act(async () => { settle[0]?.resolve({ rows: [] }); await first; });
    expect(h.result.current.pending).toBe(true);
    await act(async () => { settle[1]?.reject({ code: 'REFUSED', message: 'no' }); await second; });
    expect(h.result.current.pending).toBe(false);
    expect(h.result.current.error?.code).toBe('REFUSED');
  });
});

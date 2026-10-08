// lib/lazy.ts: a part suspends only until its chunk has loaded, then renders synchronously (so
// moving between parts never flashes the placeholder again); preloading loads a chunk once.
import { Suspense } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lazyPart, preloadWhenIdle } from './lazy';

afterEach(() => { cleanup(); vi.useRealTimers(); });

function Hello({ name }: { name: string }) {
  return <p>hello {name}</p>;
}

describe('lazyPart', () => {
  it('shows the placeholder until the chunk arrives, then the part', async () => {
    let resolve: (c: typeof Hello) => void = () => undefined;
    const load = vi.fn(() => new Promise<typeof Hello>((r) => { resolve = r; }));
    const Part = lazyPart(load);
    const v = render(<Suspense fallback={<i>waiting</i>}><Part name="owner" /></Suspense>);
    expect(v.container.textContent).toBe('waiting');
    await act(async () => { resolve(Hello); });
    expect(v.container.textContent).toBe('hello owner');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('once preloaded, renders on the first pass without the placeholder', async () => {
    const load = vi.fn(async () => Hello);
    const Part = lazyPart(load);
    await Part.preload();
    await Part.preload();
    const v = render(<Suspense fallback={<i>waiting</i>}><Part name="again" /></Suspense>);
    expect(v.container.textContent).toBe('hello again');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a failed preload can be retried', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(Hello);
    const Part = lazyPart<{ name: string }>(load);
    await expect(Part.preload()).rejects.toThrow('offline');
    await Part.preload();
    const v = render(<Suspense fallback={<i>waiting</i>}><Part name="retry" /></Suspense>);
    expect(v.container.textContent).toBe('hello retry');
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('preloadWhenIdle', () => {
  it('preloads after the delay, and not at all once cancelled', () => {
    vi.useFakeTimers();
    const a = { preload: vi.fn(async () => undefined) };
    const b = { preload: vi.fn(async () => undefined) };
    preloadWhenIdle([a], 100);
    const cancel = preloadWhenIdle([b], 100);
    cancel();
    expect(a.preload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    vi.runAllTimers();
    expect(a.preload).toHaveBeenCalledTimes(1);
    expect(b.preload).not.toHaveBeenCalled();
  });
});

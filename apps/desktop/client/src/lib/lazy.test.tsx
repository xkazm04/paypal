// lib/lazy.ts: a part suspends only until its chunk has loaded, then renders synchronously (so
// moving between parts never flashes the placeholder again); preloading loads a chunk once.
import { Suspense } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../shared/boundary';
import { lazyPart, preloadWhenIdle } from './lazy';
import { BOUNDARY_RETRY } from './words';

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

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('lazyPart after a failed render', () => {
  it('"Try again" on the boundary loads the chunk again and draws the part', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let online = false;
    const load = vi.fn(async () => { if (!online) throw new Error('offline'); return Hello; });
    const Part = lazyPart<{ name: string }>(load);
    const v = render(<ErrorBoundary layer="panel"><Suspense fallback={<i>waiting</i>}><Part name="back" /></Suspense></ErrorBoundary>);
    await settle();
    expect(screen.getByRole('alert')).toBeTruthy();
    const failedLoads = load.mock.calls.length;
    online = true;
    fireEvent.click(screen.getByRole('button', { name: BOUNDARY_RETRY }));
    await settle();
    expect(v.container.textContent).toBe('hello back');
    expect(load.mock.calls.length).toBe(failedLoads + 1);
    quiet.mockRestore();
  });

  it('a route change that drops the fallback loads the chunk again too', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let online = false;
    const load = vi.fn(async () => { if (!online) throw new Error('offline'); return Hello; });
    const Part = lazyPart<{ name: string }>(load);
    const draw = (k: number) => <ErrorBoundary layer="view" resetKeys={[k]}><Suspense fallback={<i>waiting</i>}><Part name="route" /></Suspense></ErrorBoundary>;
    const v = render(draw(1));
    await settle();
    expect(screen.getByRole('alert')).toBeTruthy();
    online = true;
    v.rerender(draw(2));
    await settle();
    expect(v.container.textContent).toBe('hello route');
    quiet.mockRestore();
  });

  it('while the network stays down each "Try again" costs a bounded number of loads', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = vi.fn(async (): Promise<typeof Hello> => { throw new Error('offline'); });
    const Part = lazyPart<{ name: string }>(load);
    render(<ErrorBoundary layer="panel"><Suspense fallback={<i>waiting</i>}><Part name="x" /></Suspense></ErrorBoundary>);
    await settle();
    const first = load.mock.calls.length;
    expect(first).toBeLessThanOrEqual(3);
    fireEvent.click(screen.getByRole('button', { name: BOUNDARY_RETRY }));
    await settle();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(load.mock.calls.length - first).toBeLessThanOrEqual(3);
    expect(load.mock.calls.length).toBeGreaterThan(first);
    quiet.mockRestore();
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

// readEach: the per-deal reads come back in order, a few at a time, and a read that never answers
// counts as failed after its time limit instead of holding the surface open.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { READ_CONCURRENCY, READ_TIMEOUT_MS, readEach } from './readEach';

describe('readEach', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('keeps the order of the ids, whatever order the reads settle in', async () => {
    const delay: Record<string, number> = { a: 6, b: 1, c: 3 };
    const rs = await readEach(['a', 'b', 'c'], (id) => new Promise<string>((r) => setTimeout(() => r(id.toUpperCase()), delay[id] ?? 0)));
    expect(rs.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual(['A', 'B', 'C']);
  });

  it('never has more than `concurrency` reads out at once', async () => {
    let out = 0;
    let most = 0;
    const read = async (id: string) => {
      out += 1;
      most = Math.max(most, out);
      await new Promise((r) => setTimeout(r, 1));
      out -= 1;
      return id;
    };
    const ids = Array.from({ length: 25 }, (_, i) => `d${i}`);
    const rs = await readEach(ids, read, { concurrency: 3 });
    expect(most).toBe(3);
    expect(rs.every((r) => r.status === 'fulfilled')).toBe(true);
    most = 0;
    await readEach(ids, read);
    expect(most).toBe(READ_CONCURRENCY);
  });

  it('rejects a read that never settles once its time limit has passed', async () => {
    vi.useFakeTimers();
    const p = readEach(['stuck', 'fine'], (id) => (id === 'stuck' ? new Promise<string>(() => {}) : Promise.resolve(id)));
    let done = false;
    void p.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const [stuck, fine] = await p;
    expect(stuck?.status).toBe('rejected');
    expect(stuck?.status === 'rejected' ? String((stuck.reason as Error).message) : '').toMatch(/timed out/);
    expect(fine).toEqual({ status: 'fulfilled', value: 'fine' });
    // The timers of settled reads were cleared: nothing is left waiting.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a rejected read rejected, with its own reason', async () => {
    const boom = new Error('unreadable');
    const rs = await readEach(['x', 'y'], (id) => (id === 'x' ? Promise.reject(boom) : Promise.resolve(id)), { timeoutMs: 50 });
    expect(rs[0]).toEqual({ status: 'rejected', reason: boom });
    expect(rs[1]).toEqual({ status: 'fulfilled', value: 'y' });
  });

  it('counts a read that throws before returning as rejected', async () => {
    const rs = await readEach(['x'], () => { throw new Error('sync'); });
    expect(rs[0]?.status).toBe('rejected');
  });

  it('reads nothing for an empty list', async () => {
    const read = vi.fn(async (id: string) => id);
    expect(await readEach([], read)).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
});

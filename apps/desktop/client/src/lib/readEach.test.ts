// readEach: the per-deal reads come back in order, a few at a time, and a read that never answers
// counts as failed after its time limit instead of holding the surface open.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { READ_CONCURRENCY, READ_TIMEOUT_MS, isAborted, readEach } from './readEach';

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

  it('keeps the slot of a timed-out read until its call settles: never more than `concurrency` unsettled', async () => {
    vi.useFakeTimers();
    // The first calls are held on deferred promises; once `release` is set, later calls answer at once.
    const held: Array<(v: string) => void> = [];
    let release = false;
    let outstanding = 0;
    let most = 0;
    const invoke = vi.fn((id: string) => {
      outstanding += 1;
      most = Math.max(most, outstanding);
      const answer = release
        ? Promise.resolve(id)
        : new Promise<string>((r) => { held.push(r); });
      return answer.finally(() => { outstanding -= 1; });
    });
    const ids = Array.from({ length: 50 }, (_, i) => `d${i}`);
    const p = readEach(ids, invoke);
    // Several timeouts pass; the 8 stuck calls time out but still hold their slots.
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS * 5);
    expect(invoke).toHaveBeenCalledTimes(READ_CONCURRENCY);
    expect(held).toHaveLength(READ_CONCURRENCY);
    expect(most).toBe(READ_CONCURRENCY);
    // Let the pass finish: the late answers arrive (and are dropped), the other reads answer at once.
    release = true;
    held.forEach((r) => r('late'));
    await vi.advanceTimersByTimeAsync(0);
    const rs = await p;
    expect(rs).toHaveLength(50);
    expect(most).toBeLessThanOrEqual(READ_CONCURRENCY);
    rs.slice(0, READ_CONCURRENCY).forEach((r) => {
      expect(r.status).toBe('rejected');
      expect(r.status === 'rejected' ? String((r.reason as Error).message) : '').toMatch(/timed out/);
    });
    rs.slice(READ_CONCURRENCY).forEach((r, i) => {
      expect(r).toEqual({ status: 'fulfilled', value: `d${i + READ_CONCURRENCY}` });
    });
    expect(invoke).toHaveBeenCalledTimes(50);
  });

  it('frees the slot of a timed-out read once its late answer arrives, and drops that answer', async () => {
    vi.useFakeTimers();
    let late!: (v: string) => void;
    const invoke = vi.fn((id: string) => (id === 'slow' ? new Promise<string>((r) => { late = r; }) : Promise.resolve(id)));
    const p = readEach(['slow', 'b', 'c'], invoke, { concurrency: 1 });
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS * 2);
    expect(invoke).toHaveBeenCalledTimes(1);
    late('late');
    const rs = await p;
    expect(rs[0]?.status).toBe('rejected');
    expect(rs[1]).toEqual({ status: 'fulfilled', value: 'b' });
    expect(rs[2]).toEqual({ status: 'fulfilled', value: 'c' });
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

  it('starts no further read once the signal is aborted, and keeps the reads that finished', async () => {
    const ctl = new AbortController();
    const started: string[] = [];
    let out = 0;
    let most = 0;
    const read = async (id: string) => {
      started.push(id);
      out += 1;
      most = Math.max(most, out);
      await new Promise((r) => setTimeout(r, 1));
      out -= 1;
      if (id === 'd3') ctl.abort();
      return id.toUpperCase();
    };
    const ids = Array.from({ length: 20 }, (_, i) => `d${i}`);
    const rs = await readEach(ids, read, { concurrency: 2, signal: ctl.signal });
    expect(most).toBeLessThanOrEqual(2);
    expect(started.length).toBeLessThan(ids.length);
    // Every id that started settled with its value; every other one is rejected as aborted.
    ids.forEach((id, i) => {
      const r = rs[i];
      if (started.includes(id)) expect(r).toEqual({ status: 'fulfilled', value: id.toUpperCase() });
      else expect(r?.status === 'rejected' && isAborted(r.reason)).toBe(true);
    });
    expect(started).toContain('d3');
  });

  it('tells an aborted id apart from a failed read', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const read = vi.fn(async (id: string) => id);
    const rs = await readEach(['a', 'b'], read, { signal: ctl.signal });
    expect(read).not.toHaveBeenCalled();
    expect(rs.every((r) => r.status === 'rejected' && isAborted(r.reason))).toBe(true);
    expect(isAborted(new Error('unreadable'))).toBe(false);
  });
});

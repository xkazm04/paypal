// The Book's evidence reads go through one gate (moved from the old windows/main/evidence.test.ts,
// rebuild WP4a: that file guarded the pre-query-cache reader; the behaviour still owed is that at
// most READ_CONCURRENCY deal_evidence reads are out at once, in the order they were asked, and a
// failed read frees its place). The per-row "only what is drawn is read" bound is book.test.tsx's.
import { describe, expect, it, vi } from 'vitest';
import { READ_CONCURRENCY } from '../../../../../lib/readEach';
import { gate } from './evidence';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('the evidence gate', () => {
  it('keeps at most n reads in flight and starts the rest in the order asked', async () => {
    const g = gate(READ_CONCURRENCY);
    let busy = 0;
    let most = 0;
    const started: number[] = [];
    const releases: Array<() => void> = [];
    const all = Array.from({ length: 50 }, (_, i) => g(() => new Promise<number>((resolve) => {
      busy += 1; most = Math.max(most, busy); started.push(i);
      releases.push(() => { busy -= 1; resolve(i); });
    })));
    await tick();
    expect(started).toEqual(Array.from({ length: READ_CONCURRENCY }, (_, i) => i));
    while (releases.length) {
      releases.shift()?.();
      await tick();
    }
    expect(await Promise.all(all)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(most).toBe(READ_CONCURRENCY);
    expect(started).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it('never starts more than READ_CONCURRENCY calls while the calls never settle, however often it is asked again', async () => {
    const g = gate(READ_CONCURRENCY);
    const invoke = vi.fn(() => new Promise<never>(() => {}));
    const ids = Array.from({ length: 10_000 }, (_, i) => i);
    // The first ask, then 5 refetches of every id: the gate has no timeout, so a stuck call keeps
    // its place and the rest wait behind it.
    for (let round = 0; round < 6; round += 1) {
      ids.forEach(() => { void g(invoke); });
      await tick();
    }
    expect(invoke).toHaveBeenCalledTimes(READ_CONCURRENCY);
  });

  it('frees the place of a failed read and passes the failure on', async () => {
    const g = gate(1);
    const failed = g(() => Promise.reject(new Error('read failed')));
    const next = g(() => Promise.resolve('ok'));
    await expect(failed).rejects.toThrow('read failed');
    await expect(next).resolves.toBe('ok');
  });
});

// A clock for the staggered reveal's tests (test-only, never imported by the app): frames, idle
// slots and timers wait until the test moves time on, so a test sees exactly one wave at a time.
import { act } from '@testing-library/react';
import type { Clock } from '../stagger';

export type ManualClock = {
  clock: Clock;
  marks: string[];
  /** Moves time on by `ms`, running what falls due in order (each in act). */
  advance: (ms: number) => Promise<void>;
  /** Runs everything until nothing is waiting (at most `max` steps). */
  flush: (max?: number) => Promise<void>;
  /** How many callbacks wait. */
  pending: () => number;
  /** Simulated work per `now()` call (ms), to fill a slot. */
  work: (ms: number) => void;
};

export function manualClock(): ManualClock {
  let t = 0;
  let seq = 0;
  let perCall = 0;
  const q = new Map<number, { at: number; fn: () => void }>();
  const marks: string[] = [];
  const push = (at: number, fn: () => void) => { const id = seq++; q.set(id, { at, fn }); return () => { q.delete(id); }; };
  const next = () => [...q.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
  const clock: Clock = {
    now: () => { t += perCall; return t; },
    frame: (fn) => push(t + 16, fn),
    idle: (fn, ms) => push(t + Math.min(ms, 1), fn),
    timer: (fn, ms) => push(t + ms, fn),
    mark: (name) => { marks.push(name); },
  };
  const runDue = async (until: number) => {
    for (let e = next(); e && e[1].at <= until; e = next()) {
      q.delete(e[0]);
      t = Math.max(t, e[1].at);
      const fn = e[1].fn;
      await act(async () => { fn(); });
    }
    t = Math.max(t, until);
  };
  return {
    clock, marks,
    advance: (ms) => runDue(t + ms),
    flush: async (max = 200) => { for (let i = 0; i < max && q.size; i++) { const e = next(); if (!e) break; await runDue(e[1].at); } },
    pending: () => q.size,
    work: (ms) => { perCall = ms; },
  };
}

// Every read of the query layer goes through `readCommand`: a time limit and a read budget around
// the one Backend (lib/runtime.ts). Reads only: mutations keep calling the backend directly
// (lib/hooks.ts useMutation), unchanged, so a money step is never cut short or retried here.
//
// A Tauri invoke cannot be cancelled, so a read that timed out only stops being waited on; its
// answer, if one comes later, is dropped by the query (a newer fetch owns the entry).
import type { ArgsOf, CommandName, InvokeOptions, ResultOf } from '../contract';
import { WalletError, toWalletError } from '../contract';
import { backend } from '../runtime';

/** How long one read may take before it counts as failed (the same limit as lib/readEach.ts). */
export const INVOKE_TIMEOUT_MS = 10_000;

/** The read counter: how many reads went out, how many were out at once, per command. Exposed so
 *  tests (and a dev inspector) can hold the window to a budget. In memory only, no arguments kept. */
export type ReadBudget = {
  total: number;
  inFlight: number;
  maxInFlight: number;
  byCommand: Map<string, { total: number; inFlight: number; maxInFlight: number }>;
};

export const readBudget: ReadBudget = { total: 0, inFlight: 0, maxInFlight: 0, byCommand: new Map() };

export function resetReadBudget(): void {
  readBudget.total = 0;
  readBudget.inFlight = 0;
  readBudget.maxInFlight = 0;
  readBudget.byCommand.clear();
}

function count(cmd: string, delta: 1 | -1): void {
  const c = readBudget.byCommand.get(cmd) ?? { total: 0, inFlight: 0, maxInFlight: 0 };
  if (delta === 1) {
    readBudget.total += 1;
    c.total += 1;
  }
  readBudget.inFlight += delta;
  c.inFlight += delta;
  readBudget.maxInFlight = Math.max(readBudget.maxInFlight, readBudget.inFlight);
  c.maxInFlight = Math.max(c.maxInFlight, c.inFlight);
  readBudget.byCommand.set(cmd, c);
}

/** The error a read that took too long rejects with: an availability state, rendered calmly. */
export function timeoutError(cmd: string, ms: number): WalletError {
  return new WalletError({ code: 'UNAVAILABLE', message: `${cmd} did not answer within ${ms} ms` });
}

/** One read with a time limit. Rejects with a WalletError (UNAVAILABLE after `ms`). */
export function readCommand<K extends CommandName>(
  cmd: K,
  args: ArgsOf<K>,
  opts?: InvokeOptions,
  ms: number = INVOKE_TIMEOUT_MS,
): Promise<ResultOf<K>> {
  count(cmd, 1);
  return new Promise<ResultOf<K>>((resolve, reject) => {
    let done = false;
    const settle = (): boolean => {
      if (done) return false;
      done = true;
      clearTimeout(timer);
      count(cmd, -1);
      return true;
    };
    const timer = setTimeout(() => { if (settle()) reject(timeoutError(cmd, ms)); }, ms);
    // The read goes out now (not a tick later); a backend that throws before it returns a promise
    // is a rejected read, not a crash.
    let out: Promise<ResultOf<K>>;
    try {
      out = backend().invoke(cmd, args, opts);
    } catch (e) {
      out = Promise.reject(e);
    }
    out
      .then(
        (v) => { if (settle()) resolve(v); },
        (e: unknown) => { if (settle()) reject(toWalletError(e)); },
      );
  });
}

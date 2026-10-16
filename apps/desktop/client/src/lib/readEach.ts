// One read per id, a few at a time, each with a time limit: the per-deal fan-outs of the main
// window (deal_evidence, deal_display) go through here so their width and their wait are stated at
// the call site. Read-only: the helper only calls the read it is given and moves nothing. A Tauri
// invoke cannot be cancelled, so a read that timed out only stops being waited on; its answer, if
// one comes later, is dropped.

/** How long one read may take before it counts as failed. */
export const READ_TIMEOUT_MS = 10_000;
/** How many reads are waited on at once. */
export const READ_CONCURRENCY = 8;

/** `read`, with two views of it: `result` is rejected with a timeout error if the read has not
 *  settled after `ms`; `ended` settles only when the underlying read itself has settled (or
 *  threw), which is when its slot is free again. */
function timed<T>(read: (id: string) => Promise<T>, id: string, ms: number): { result: Promise<T>; ended: Promise<void> } {
  let end!: () => void;
  const ended = new Promise<void>((r) => { end = r; });
  const result = new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`read of ${id} timed out after ${ms} ms`)), ms);
    // A read that throws before it returns a promise is a rejected read, not a crash.
    Promise.resolve().then(() => read(id)).then(
      (v) => { clearTimeout(timer); resolve(v); end(); },
      (e: unknown) => { clearTimeout(timer); reject(e); end(); },
    );
  });
  return { result, ended };
}

/** A pool of read slots that outlives one readEach call: pass the same pool to every call of a
 *  caller (every batch, every pass) and a read still stuck from an earlier call keeps its slot, so
 *  the unsettled reads of all those calls together never exceed the pool's size. */
export type ReadPool = {
  /** Resolves with the slot's release once one is free, or null if `signal` aborted while waiting. */
  acquire(signal?: AbortSignal): Promise<(() => void) | null>;
};

/** A pool of `size` slots. */
export function createReadPool(size: number = READ_CONCURRENCY): ReadPool {
  let free = Math.max(1, Math.floor(size));
  const waiting: Array<(release: (() => void) | null) => void> = [];
  const release = (): void => {
    const next = waiting.shift();
    if (next) next(release);
    else free += 1;
  };
  return {
    acquire(signal) {
      if (signal?.aborted) return Promise.resolve(null);
      if (free > 0) { free -= 1; return Promise.resolve(release); }
      return new Promise((resolve) => {
        const give = (r: (() => void) | null) => { signal?.removeEventListener('abort', onAbort); resolve(r); };
        const onAbort = () => {
          const at = waiting.indexOf(give);
          if (at >= 0) waiting.splice(at, 1);
          give(null);
        };
        waiting.push(give);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
  };
}

/** The reason an id settles with when the pass was aborted before its read started. */
export class ReadAborted extends Error {
  constructor(id: string) {
    super(`read of ${id} was not started: the pass was aborted`);
    this.name = 'ReadAborted';
  }
}

/** True for the reason of a read that never started because its pass was aborted, as opposed to a
 *  read that ran and failed. */
export function isAborted(reason: unknown): boolean {
  return reason instanceof ReadAborted;
}

/** Reads every id, at most `concurrency` at once, and settles each read as Promise.allSettled
 *  would, in the order of `ids`. A read still out after `timeoutMs` counts as rejected, but it
 *  keeps its slot until the underlying call settles (a Tauri invoke cannot be cancelled), so the
 *  number of unsettled reads never exceeds `concurrency`, timeouts included. The returned promise
 *  settles once every id has an outcome, not when stuck calls finally end. Once `signal` is
 *  aborted no further read starts (reads already out run to their end); each id that never
 *  started settles rejected with a reason for which isAborted is true. With `pool`, the slots are
 *  the pool's and not this call's own, so reads left out by an earlier call count against the
 *  bound too; a read waiting for a slot of the pool starts no more once `signal` is aborted. */
export function readEach<T>(
  ids: readonly string[],
  read: (id: string) => Promise<T>,
  o: { concurrency?: number; timeoutMs?: number; signal?: AbortSignal; pool?: ReadPool } = {},
): Promise<PromiseSettledResult<T>[]> {
  const width = Math.max(1, Math.floor(o.concurrency ?? READ_CONCURRENCY));
  const ms = o.timeoutMs ?? READ_TIMEOUT_MS;
  const pool = o.pool ?? createReadPool(width);
  const out = new Array<PromiseSettledResult<T>>(ids.length);
  return new Promise((resolve) => {
    let next = 0;
    let have = 0;
    if (ids.length === 0) { resolve(out); return; }
    const settle = (i: number, r: PromiseSettledResult<T>) => {
      out[i] = r;
      have += 1;
      if (have === ids.length) resolve(out);
    };
    const worker = async (): Promise<void> => {
      while (next < ids.length) {
        const i = next;
        next += 1;
        const id = ids[i] as string;
        if (o.signal?.aborted) {
          settle(i, { status: 'rejected', reason: new ReadAborted(id) });
          continue;
        }
        const release = await pool.acquire(o.signal);
        if (!release || o.signal?.aborted) {
          release?.();
          settle(i, { status: 'rejected', reason: new ReadAborted(id) });
          continue;
        }
        const { result, ended } = timed(read, id, ms);
        result.then(
          (value) => settle(i, { status: 'fulfilled', value }),
          (reason: unknown) => settle(i, { status: 'rejected', reason }),
        );
        // The slot is held until the call itself has settled, not until it timed out.
        await ended;
        release();
      }
    };
    for (let k = 0; k < Math.min(width, ids.length); k += 1) void worker();
  });
}

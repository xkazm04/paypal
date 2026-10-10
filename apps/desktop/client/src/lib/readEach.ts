// One read per id, a few at a time, each with a time limit: the per-deal fan-outs of the main
// window (deal_evidence, deal_display) go through here so their width and their wait are stated at
// the call site. Read-only: the helper only calls the read it is given and moves nothing. A Tauri
// invoke cannot be cancelled, so a read that timed out only stops being waited on; its answer, if
// one comes later, is dropped.

/** How long one read may take before it counts as failed. */
export const READ_TIMEOUT_MS = 10_000;
/** How many reads are waited on at once. */
export const READ_CONCURRENCY = 8;

/** `read`, rejected with a timeout error if it has not settled after `ms`. */
function timed<T>(read: (id: string) => Promise<T>, id: string, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`read of ${id} timed out after ${ms} ms`)), ms);
    // A read that throws before it returns a promise is a rejected read, not a crash.
    Promise.resolve().then(() => read(id)).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e: unknown) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** Reads every id, at most `concurrency` at once, and settles each read as Promise.allSettled
 *  would, in the order of `ids`. A read still out after `timeoutMs` counts as rejected. */
export async function readEach<T>(
  ids: readonly string[],
  read: (id: string) => Promise<T>,
  o: { concurrency?: number; timeoutMs?: number } = {},
): Promise<PromiseSettledResult<T>[]> {
  const width = Math.max(1, Math.floor(o.concurrency ?? READ_CONCURRENCY));
  const ms = o.timeoutMs ?? READ_TIMEOUT_MS;
  const out = new Array<PromiseSettledResult<T>>(ids.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < ids.length) {
      const i = next;
      next += 1;
      const id = ids[i] as string;
      out[i] = await timed(read, id, ms).then(
        (value): PromiseSettledResult<T> => ({ status: 'fulfilled', value }),
        (reason: unknown): PromiseSettledResult<T> => ({ status: 'rejected', reason }),
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, ids.length) }, worker));
  return out;
}

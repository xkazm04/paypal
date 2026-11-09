// The deals the owner let lapse in this window, with the deadline the lapse runs to. The wallet keeps
// its own mark (its "let it lapse" preference) but no read carries it back to the client, so the undo
// is offered where the owner just chose "Let it lapse", for as long as this window is open. A mark is
// set only after the wallet answered the lapse and cleared only after it answered the undo.
import { useSyncExternalStore } from 'react';

export type Lapsed = { deadline: number | null };

let marks: ReadonlyMap<string, Lapsed> = new Map();
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

/** The wallet accepted "let it lapse" for this deal. */
export function markLapsed(dealId: string, deadline: number | null): void {
  const next = new Map(marks);
  next.set(dealId, { deadline });
  marks = next;
  notify();
}

/** The wallet accepted the undo (or the mark is no longer wanted). */
export function clearLapsed(dealId: string): void {
  if (!marks.has(dealId)) return;
  const next = new Map(marks);
  next.delete(dealId);
  marks = next;
  notify();
}

/** Tests only: forget every mark. */
export function resetLapsed(): void {
  marks = new Map();
  notify();
}

const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => { subs.delete(cb); };
};

/** This deal's lapse mark, or null when the owner did not let it lapse here. */
export function useLapsed(dealId: string): Lapsed | null {
  return useSyncExternalStore(subscribe, () => marks.get(dealId) ?? null, () => null);
}

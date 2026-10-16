// Owner-to-owner join, since commit-then-reveal (DECISIONS §47): the initiator reveals only after
// its next 3 s poll, so the joiner's first pairing_join normally answers "not available yet".
// That one answer, in join mode only, is retried; every other failure is shown at once.
import type { PairMode } from '../../../setup/pairing';

/** Attempts in all (the first call included), about 3 s apart: the initiator's poll cadence. */
export const JOIN_ATTEMPTS = 5;
export const JOIN_RETRY_MS = 3000;

/** `attempt` is how many calls have been made (the last one failed). House mode never retries: its UNAVAILABLE means the HOUSE is waking. */
export function shouldRetryJoin(mode: PairMode, error: { code: string; message: string } | null, attempt: number): boolean {
  return mode === 'join' && !!error && error.code === 'UNAVAILABLE' && /not available yet/i.test(error.message) && attempt < JOIN_ATTEMPTS;
}

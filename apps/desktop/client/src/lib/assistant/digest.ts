// What the model is told. STUB (WP2): final signature. Contract of the real one: a compact, delimited
// JSON text of DigestInput; deal labels cut to 60 chars and stripped of control characters and
// markup; no counterparty names or notes; sizes capped (200 deals).
import type { DigestInput } from './contract';

export function buildDigest(input: DigestInput): string {
  return JSON.stringify({ now_ms: input.now_ms, first_run: input.first_run });
}

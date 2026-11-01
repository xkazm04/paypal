// The ONE validation door: every reply, from any engine, passes here before the board sees it.
// STUB (WP2 owns this file): final signature, minimal body. Contract of the real one: salvage every
// valid op, drop the rest and COUNT them with reasons, cap `say` (600 chars) and ops (8), reject
// unknown deal ids / modules / fates, never pass a free-text action parameter.
import type { ValidatedReply } from './contract';

export type Known = { dealIds: ReadonlySet<string> };

export function validateReply(_raw: unknown, _known: Known): ValidatedReply {
  return { say: '', ops: [], dropped: { count: 0, reasons: [] }, repaired: false };
}

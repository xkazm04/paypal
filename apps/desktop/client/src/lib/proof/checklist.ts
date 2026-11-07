// The checklist the owner saw, as an owner decision row records it (Rust: table-core checks.rs and
// table-verify v2.rs). The row carries the six lines and their hash: the lines are read strictly, the
// way Rust reads them, and hashed again under the same domain tag, so a checker needs nothing but the
// file. A line the audit door replaced ("[redacted]", an email-shaped payee) cannot be hashed again.
import type { ApprovalCheck } from '@bindings/ApprovalCheck';
import type { ApprovalCheckId } from '@bindings/ApprovalCheckId';
import type { ApprovalCheckStatus } from '@bindings/ApprovalCheckStatus';
import { type Bytes, sha256, utf8 } from './bytes';
import { canonicalBytes } from './jcs';

/** Rust's `APPROVAL_CHECKS_DOMAIN`: the digest of a checklist never equals any other commitment. */
export const APPROVAL_CHECKS_DOMAIN = 'table.approval-checks.v1\0';
/** The audit door's mark for a word it would not keep. */
export const REDACTED = '[redacted]';

const IDS: readonly ApprovalCheckId[] = ['amount', 'payee', 'host', 'invoice', 'shield', 'mandate'];
const STATUSES: readonly ApprovalCheckStatus[] = ['pass', 'fail', 'wait', 'not_applicable'];
const KEYS = ['detail', 'id', 'status', 'text'];

/** The recorded lines, read as Rust's `Vec<ApprovalCheck>` reads them (every key known, every value
 *  of its kind); null when they do not read. */
export function readChecklist(value: unknown): ApprovalCheck[] | null {
  if (!Array.isArray(value)) return null;
  const out: ApprovalCheck[] = [];
  for (const line of value as unknown[]) {
    if (typeof line !== 'object' || line === null || Array.isArray(line)) return null;
    const l = line as Record<string, unknown>;
    if (Object.keys(l).some((k) => !KEYS.includes(k))) return null;
    const { id, status, text, detail } = l;
    if (!IDS.includes(id as ApprovalCheckId) || !STATUSES.includes(status as ApprovalCheckStatus)) return null;
    if (typeof text !== 'string' || typeof detail !== 'string') return null;
    out.push({ id: id as ApprovalCheckId, status: status as ApprovalCheckStatus, text, detail });
  }
  return out;
}

/** Rust's `checks_hash`: SHA-256 over the domain tag and the canonical (JCS) lines. */
export const checksHash = (lines: readonly ApprovalCheck[]): Promise<Bytes> => sha256(utf8(APPROVAL_CHECKS_DOMAIN), canonicalBytes(lines));

/** A line holds a word the audit door replaced, so the lines cannot be hashed again. */
export const unkept = (lines: readonly ApprovalCheck[]): boolean => lines.some((l) => l.text.includes(REDACTED) || l.detail.includes(REDACTED));

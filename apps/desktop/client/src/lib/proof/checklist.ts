// The checklist the owner saw, as an owner decision row records it (Rust: table-core checks.rs and
// table-verify v2.rs). The row carries the six lines and their hash: the lines are read strictly, the
// way Rust reads them, and hashed again under the same domain tag, so a checker needs nothing but the
// file. A line the audit door replaced ("[redacted]", an email-shaped payee) cannot be hashed again.
import type { ApprovalCheck } from '@bindings/ApprovalCheck';
import type { ApprovalCheckId } from '@bindings/ApprovalCheckId';
import type { ApprovalCheckStatus } from '@bindings/ApprovalCheckStatus';
import { type Bytes, byteArray, sha256, utf8 } from './bytes';
import { readDecidedBy } from './bundle';
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

/** Rust's `OWNER_DECISION_DOMAIN`: the owner key's statement over one decision never verifies as any
 *  other statement the owner key signs. */
export const OWNER_DECISION_DOMAIN = 'table.owner-decision.v1\0';
const u8 = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255;
const field = (d: unknown, name: string): unknown => (typeof d === 'object' && d !== null ? (d as Record<string, unknown>)[name] : undefined);
const text = (d: unknown, name: string): string | null => {
  const v = field(d, name);
  return typeof v === 'string' ? v : null;
};

/** The bytes the owner key signs for one decision row (Rust `DecisionStatement::signing_bytes`): the
 *  domain tag and the canonical {deal_id, decision, operation, attempt, terms_hash, checks_hash, at},
 *  `at` being the decision's time. Null when the row lacks a field the statement needs. */
export function decisionStatement(dealId: string, d: unknown): Bytes | null {
  let at: number;
  try {
    const by = readDecidedBy(field(d, 'decided_by'));
    if (by.type !== 'human') return null;
    at = by.at;
  } catch {
    return null;
  }
  const [decision, operation, attempt] = [text(d, 'decision'), text(d, 'operation'), field(d, 'attempt')];
  const [terms, checks] = [byteArray(field(d, 'terms_hash'), 32), byteArray(field(d, 'checks_hash'), 32)];
  if (decision === null || operation === null || !u8(attempt) || terms === null || checks === null) return null;
  const statement = canonicalBytes({ deal_id: dealId, decision, operation, attempt, terms_hash: Array.from(terms), checks_hash: Array.from(checks), at });
  const domain = utf8(OWNER_DECISION_DOMAIN);
  const out = new Uint8Array(domain.length + statement.length);
  out.set(domain);
  out.set(statement, domain.length);
  return out;
}

// Each owner decision in a proof file, read as a receipt: the six lines the owner saw, whether they still
// hash to what was recorded, whether the owner key signed the decision for its one step, and whether the
// lines that were to be checked later passed before money moved. The same reads as the checker's
// `owner_saw` line (checks.ts), per decision, for the Proof page's "Owner's checklist" card. Pure.
import type { ApprovalCheck } from '@bindings/ApprovalCheck';
import { byteArray, same } from './bytes';
import { readDecidedBy } from './bundle';
import { checksHash, decisionStatement, readChecklist, unkept } from './checklist';
import { ed25519Works, verifyStrict } from './ed25519';

/** What the file lets a checker say about the lines: hashed again and equal, changed since, only a hash
 *  (an older file), a line the record does not keep, or lines that do not read. */
export type LinesState = 'again' | 'changed' | 'hash-only' | 'unkept' | 'unreadable';
/** The owner key's signature: it verifies, it does not, there is none, or this browser cannot check it. */
export type SignatureState = 'signed' | 'not-owner' | 'none' | 'unchecked';

export interface DecisionReceipt {
  seq: number;
  /** When the owner decided (unix seconds), or null. */
  at: number | null;
  decision: string | null;
  /** The step it starts (create, authorize, capture, invoice-create, accept, release, hand-off). */
  operation: string | null;
  lines: ApprovalCheck[] | null;
  linesState: LinesState;
  signature: SignatureState;
  /** The lines that read "checked later" here, and how many of them read passed in a later decision of
   *  this file whose lines hash again; `beforeMoney` when every one did before money was taken. */
  later: { waiting: number; passed: number; beforeMoney: boolean };
}

type Row = { seq: number; action: string; detail_json: string };
type Doc = { audit?: unknown; owner_key?: unknown; deal?: { id?: unknown } };

const parse = (row: Row): unknown => {
  try {
    return JSON.parse(row.detail_json);
  } catch {
    return null;
  }
};
const field = (d: unknown, name: string): unknown => (typeof d === 'object' && d !== null ? (d as Record<string, unknown>)[name] : undefined);
const text = (d: unknown, name: string): string | null => {
  const v = field(d, name);
  return typeof v === 'string' ? v : null;
};

/** The money steps that take money: a capture, or the fix's invoice sent. */
const TAKES = ['capture', 'invoice-send'];

export async function decisionReceipts(document: unknown): Promise<DecisionReceipt[]> {
  const doc = document as Doc | null;
  const audit = Array.isArray(doc?.audit) ? (doc.audit as Row[]) : [];
  const dealId = typeof doc?.deal?.id === 'string' ? doc.deal.id : '';
  const ownerKey = byteArray(doc?.owner_key, 32);
  const moneyAt = audit.find((r) => r.action === 'money.authorized' && TAKES.includes(text(parse(r), 'operation') ?? ''))?.seq ?? null;
  const out: DecisionReceipt[] = [];
  const canVerify = await ed25519Works();
  for (const row of audit.filter((r) => r.action === 'owner.decision')) {
    const d = parse(row);
    let at: number | null = null;
    try {
      const by = readDecidedBy(field(d, 'decided_by'));
      if (by.type === 'human') at = by.at;
    } catch {
      at = null;
    }
    const raw = field(d, 'checks');
    const lines = raw === undefined ? null : readChecklist(raw);
    let linesState: LinesState;
    if (raw === undefined) linesState = 'hash-only';
    else if (lines === null) linesState = 'unreadable';
    else if (unkept(lines)) linesState = 'unkept';
    else {
      const recorded = byteArray(field(d, 'checks_hash'), 32);
      linesState = recorded !== null && same(await checksHash(lines), recorded) ? 'again' : 'changed';
    }
    let signature: SignatureState = 'none';
    const sig = field(d, 'signature');
    if (sig !== undefined) {
      const bytes = byteArray(sig);
      const statement = decisionStatement(dealId, d);
      signature = !canVerify ? 'unchecked'
        : ownerKey !== null && bytes !== null && statement !== null && (await verifyStrict(ownerKey, statement, bytes)) ? 'signed' : 'not-owner';
    }
    out.push({ seq: row.seq, at, decision: text(d, 'decision'), operation: text(d, 'operation'), lines, linesState, signature, later: { waiting: 0, passed: 0, beforeMoney: false } });
  }
  // A line checked later passed when a later decision whose lines hash again reads it passed.
  for (const [i, r] of out.entries()) {
    const waiting = r.linesState === 'again' ? (r.lines ?? []).filter((l) => l.status === 'wait') : [];
    const passedAt = waiting.map((l) => out.slice(i + 1).find((o) => o.linesState === 'again' && o.lines?.some((x) => x.id === l.id && x.status === 'pass'))?.seq ?? null);
    const passed = passedAt.filter((s) => s !== null).length;
    r.later = {
      waiting: waiting.length,
      passed,
      beforeMoney: waiting.length > 0 && passed === waiting.length && moneyAt !== null && passedAt.every((s) => s !== null && s < moneyAt),
    };
  }
  return out;
}

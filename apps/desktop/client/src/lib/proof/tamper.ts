// The ways a person might break a proof file, each as a few JSON edits. They are the edits the
// wallet's own tests make (crates/table-client/src/sample_proof.rs): parity.test.ts holds this
// list equal to Rust's, edit for edit, and Rust names which checks each one must turn red.
// An edit that leads nowhere in a given file (a file with no such record) is not offered for it.
import { decimal, type Money } from './bundle';
import { applyEdits, type Edit, readAt } from './edits';
import { toHex } from './bytes';
import { canonical } from './jcs';
// The `forged decision` edits, made where the file's own agent key was at hand: the practice deal's by
// the proofs recorder, the house haggle's by the haggle recorder (sample_proof.rs `forged_decision`).
// A browser cannot seal a file again, so a file without an entry here is not offered this tamper.
import forgedPractice from './sample/forged.json';
import forgedHouse from './sample/d-0205.forged.json';

const FORGED: Readonly<Record<string, Edit[]>> = { ...(forgedPractice as Record<string, Edit[]>), ...(forgedHouse as Record<string, Edit[]>) };
const headHex = (doc: Doc): string => {
  const head = readAt(doc, '/evidence_head');
  if (!Array.isArray(head)) throw new Error('no evidence head');
  return toHex(Uint8Array.from(head as number[]));
};
/** One owner decision row's detail, changed by `edit` and written back canonically (sample_proof.rs `decision_edit`). */
const decisionEdit = (doc: Doc, n: number, edit: (d: Record<string, unknown>) => void): Edit[] => {
  const path = `/audit/${nth(doc, 'owner.decision', n)}/detail_json`;
  const detail = JSON.parse(text(doc, path)) as Record<string, unknown>;
  edit(detail);
  return [{ op: 'set', path, value: canonical(detail) }];
};

export type TamperId =
  | 'price' | 'paypal-amount' | 'payee' | 'receipt' | 'audit-line' | 'audit-gap' | 'signature' | 'refund' | 'rules' | 'relabel' | 'owner-key'
  | 'shield-release' | 'market-price' | 'group-winner' | 'group-agreed' | 'request-id' | 'transcript-head' | 'checklist'
  | 'forged-decision' | 'decision-signature' | 'decision-step';

type Doc = unknown;
const rows = (doc: Doc): Array<{ action: string; at: number }> => {
  const audit = readAt(doc, '/audit');
  return Array.isArray(audit) ? audit.map((r, i) => ({ action: String((r as { action?: unknown }).action), at: i })) : [];
};
const nth = (doc: Doc, action: string, n: number): number => {
  const found = rows(doc).filter((r) => r.action === action)[n];
  if (!found) throw new Error(`no ${action} row`);
  return found.at;
};
const num = (doc: Doc, path: string): number => {
  const v = readAt(doc, path);
  if (typeof v !== 'number') throw new Error(`no number at ${path}`);
  return v;
};
const text = (doc: Doc, path: string): string => {
  const v = readAt(doc, path);
  if (typeof v !== 'string') throw new Error(`no text at ${path}`);
  return v;
};
const currencyOf = (doc: Doc): string => text(doc, '/deal/terms/unit_price/currency');
/** The deal's total in minor units: price times quantity. */
const total = (doc: Doc): number => num(doc, '/deal/terms/unit_price/minor') * num(doc, '/deal/terms/qty');

export const TAMPERS: ReadonlyArray<{ id: TamperId; edits: (doc: Doc) => Edit[] }> = [
  { id: 'price', edits: (d) => [{ op: 'set', path: '/deal/terms/unit_price/minor', value: Math.floor(num(d, '/deal/terms/unit_price/minor') / 5) * 7 }] },
  {
    id: 'paypal-amount',
    edits: (d) => [{ op: 'set', path: '/paypal_calls/0/binding/purchase_units/0/amount/value', value: decimal({ minor: Math.floor(total(d) / 10), currency: currencyOf(d) } satisfies Money) }],
  },
  {
    id: 'payee',
    edits: (d) => {
      text(d, '/closed_mandates/0/mandate/payee');
      return [{ op: 'set', path: '/closed_mandates/0/mandate/payee', value: 'someone-else' }];
    },
  },
  { id: 'receipt', edits: (d) => [{ op: 'set', path: '/receipts/0/amount_minor', value: Math.floor(total(d) / 10) }] },
  {
    id: 'audit-line',
    edits: (d) => {
      const at = nth(d, 'deadline.set', 0);
      const path = `/audit/${at}/detail_json`;
      const detail = text(d, path);
      const due = (JSON.parse(detail) as { due_at: number }).due_at;
      return [{ op: 'set', path, value: detail.replace(String(due), String(due + 54 * 86_400)) }];
    },
  },
  { id: 'audit-gap', edits: (d) => [{ op: 'remove', path: `/audit/${nth(d, 'owner.decision', 1)}` }] },
  {
    id: 'signature',
    edits: (d) => {
      const raw = text(d, '/transcript/2/raw');
      const cut = raw.lastIndexOf('.');
      const first = raw.charAt(cut + 1) === 'A' ? 'B' : 'A';
      return [{ op: 'set', path: '/transcript/2/raw', value: `${raw.slice(0, cut + 1)}${first}${raw.slice(cut + 2)}` }];
    },
  },
  {
    id: 'refund',
    edits: (d) => {
      const calls = readAt(d, '/paypal_calls');
      const at = Array.isArray(calls) ? calls.findIndex((c) => String((c as { path?: unknown }).path).endsWith('/capture')) : -1;
      if (at < 0) throw new Error('no capture call');
      const capture = readAt(d, '/deal/paypal/capture');
      return [{ op: 'set', path: `/paypal_calls/${at}/path`, value: `/v2/payments/captures/${typeof capture === 'string' ? capture : 'CAPTURE'}/refund` }];
    },
  },
  {
    id: 'rules',
    edits: (d) => {
      const clauses = readAt(d, '/mandate/payload/clauses');
      const band = Array.isArray(clauses) ? clauses.findIndex((c) => (c as { type?: unknown }).type === 'band') : -1;
      if (band < 0) throw new Error('no band clause');
      const path = `/mandate/payload/clauses/${band}/ceiling/minor`;
      return [{ op: 'set', path, value: num(d, path) * 2 }];
    },
  },
  { id: 'relabel', edits: () => [{ op: 'set', path: '/format', value: 'table.proof.v1' }] },
  { id: 'transcript-head', edits: () => [{ op: 'set', path: '/deal/transcript_head', value: Array.from({ length: 32 }, () => 0) }] },
  // the records only a busier deal has
  { id: 'shield-release', edits: (d) => [{ op: 'remove', path: `/audit/${nth(d, 'shield.released', 0)}` }] },
  {
    id: 'market-price',
    edits: (d) => {
      num(d, '/deal/market/certificate/comparables/0/minor');
      return [{ op: 'set', path: '/deal/market/certificate/comparables/0/minor', value: 5_000 }];
    },
  },
  { id: 'group-winner', edits: (d) => [{ op: 'set', path: '/group/winner', value: text(d, '/group/tables/1/deal_id') }] },
  {
    id: 'group-agreed',
    edits: (d) => {
      text(d, '/group/tables/1/state');
      return [{ op: 'set', path: '/group/tables/1/state', value: 'RECEIPTED' }];
    },
  },
  {
    id: 'request-id',
    edits: (d) => {
      // only a payment that was checked again with PayPal has a request to send twice
      if (!rows(d).some((r) => ['money.resolved', 'money.resent', 'money.parked'].includes(r.action))) throw new Error('no second look at PayPal');
      const ops = readAt(d, '/operations');
      const at = Array.isArray(ops) ? ops.findIndex((o) => (o as { operation?: unknown }).operation === 'capture') : -1;
      if (at < 0) throw new Error('no capture step');
      return [{ op: 'set', path: `/operations/${at}/request_id`, value: 'a-second-request-id' }];
    },
  },
  { id: 'owner-key', edits: (d) => [{ op: 'set', path: '/owner_key', value: readAt(d, '/counterparty/owner_key') }] },
  {
    // One line of the checklist recorded with the owner's first decision reads as passed when it did not
    // (sample_proof.rs `checklist_flip`): the first line that was not a pass; on a list of passes, the first
    // line reads failed instead.
    id: 'checklist',
    edits: (d) => {
      const path = `/audit/${nth(d, 'owner.decision', 0)}/detail_json`;
      const detail = JSON.parse(text(d, path)) as { checks?: unknown };
      const lines = detail.checks;
      if (!Array.isArray(lines) || lines.length === 0) throw new Error('no recorded checklist');
      const at = lines.findIndex((l) => (l as { status?: unknown }).status !== 'pass');
      const line = lines[at < 0 ? 0 : at] as { status?: unknown };
      line.status = at < 0 ? 'fail' : 'pass';
      return [{ op: 'set', path, value: canonical(detail) }];
    },
  },
  {
    // An owner decision the owner never made, added and sealed again with the agent's own key.
    id: 'forged-decision',
    edits: (d) => {
      const edits = FORGED[headHex(d)];
      if (!edits) throw new Error('no forgery made for this file');
      return structuredClone(edits);
    },
  },
  {
    // One byte of the owner key's signature on the second decision.
    id: 'decision-signature',
    edits: (d) => decisionEdit(d, 1, (detail) => {
      const signature = detail.signature;
      if (!Array.isArray(signature) || typeof signature[0] !== 'number') throw new Error('no signature');
      signature[0] = signature[0] ^ 1;
    }),
  },
  // The first decision said to start the capture.
  { id: 'decision-step', edits: (d) => decisionEdit(d, 0, (detail) => { detail.operation = 'capture'; }) },
];

/** The edits for one tamper on this file, or null when the file has nothing there to change. */
export function editsFor(id: TamperId, doc: Doc): Edit[] | null {
  const tamper = TAMPERS.find((t) => t.id === id);
  if (!tamper) return null;
  try {
    const edits = tamper.edits(doc);
    // Prove the edits land before offering them.
    applyEdits(structuredClone(doc), edits);
    return edits;
  } catch {
    return null;
  }
}

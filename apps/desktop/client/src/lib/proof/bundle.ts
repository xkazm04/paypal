// A proof file as the checker reads it. `readBundle` is as strict about shape as the wallet's own reader
// (every field named, no field the wallet does not write), because a file that does not read is "not a
// proof file", never a green line. Hashes, keys and signatures are written by the wallet as JSON arrays
// of byte values; they come out here as bytes.
import { type Bytes } from './bytes';
import { type House, readHouse } from './house';
import { type MarketRef, readMarketRef } from './market';
import { CURRENCIES, type Money, readMoney } from './money';
import { bytes, flag, label, list, maybe, oneOf, rec, type Rec, refuse, text, ulid, whole } from './read';

export { NOT_A_PROOF, Refused, MAX_SAFE } from './read';
export { decimal, exponentOf, type Money, readMoney, sameMoney, showMoney } from './money';

// ---- the deal ------------------------------------------------------------------------------------

export type Delivery =
  | { type: 'digital_now' }
  | { type: 'ship_then_capture'; days: number }
  | { type: 'pickup_local' }
  | { type: 'service_on_date'; unix_day: number };
export function readDelivery(value: unknown): Delivery {
  const type = oneOf((value as Rec | null)?.type, ['digital_now', 'ship_then_capture', 'pickup_local', 'service_on_date'] as const);
  if (type === 'ship_then_capture') return { type, days: whole(rec(value, ['type', 'days']).days, 0, 255) };
  if (type === 'service_on_date') return { type, unix_day: whole(rec(value, ['type', 'unix_day']).unix_day, -(2 ** 31), 2 ** 31 - 1) };
  rec(value, ['type']);
  return { type };
}
export interface Terms {
  item_ref: string;
  qty: number;
  unit_price: Money;
  currency: string;
  delivery: Delivery;
}
const readTerms = (value: unknown): Terms => {
  const r = rec(value, ['item_ref', 'qty', 'unit_price', 'currency', 'delivery']);
  return {
    item_ref: label(r.item_ref),
    qty: whole(r.qty, 0, 2 ** 32 - 1),
    unit_price: readMoney(r.unit_price),
    currency: oneOf(r.currency, CURRENCIES),
    delivery: readDelivery(r.delivery),
  };
};

export type DecidedBy =
  | { type: 'policy'; clause: number }
  | { type: 'human'; at: number }
  | { type: 'seller_mandate'; mandate_hash: Bytes }
  | { type: 'house_mandate'; mandate_hash: Bytes }
  | { type: 'safe_default'; deadline: number };
export function readDecidedBy(value: unknown): DecidedBy {
  const type = oneOf((value as Rec | null)?.type, ['policy', 'human', 'seller_mandate', 'house_mandate', 'safe_default'] as const);
  switch (type) {
    case 'policy':
      return { type, clause: whole(rec(value, ['type', 'clause']).clause, 0, 255) };
    case 'human':
      return { type, at: whole(rec(value, ['type', 'at']).at) };
    case 'safe_default':
      return { type, deadline: whole(rec(value, ['type', 'deadline']).deadline) };
    default:
      return { type, mandate_hash: bytes(rec(value, ['type', 'mandate_hash']).mandate_hash, 32) };
  }
}
/** `decided_by` as the wallet writes it into a row, for comparing two of them. */
export function decidedJson(by: DecidedBy): Rec {
  switch (by.type) {
    case 'policy':
      return { type: by.type, clause: by.clause };
    case 'human':
      return { type: by.type, at: by.at };
    case 'safe_default':
      return { type: by.type, deadline: by.deadline };
    default:
      return { type: by.type, mandate_hash: Array.from(by.mandate_hash) };
  }
}

const KINDS = ['purchase', 'haggle', 'shop_order', 'rescue', 'invoice'] as const;
const SIDES = ['buyer', 'seller'] as const;
const MODES = ['sandbox', 'replay', 'scripted_engine'] as const;
const STATES = [
  'PAIRING', 'LISTED', 'NEGOTIATING', 'AGREED', 'SETTLING', 'AWAITING_APPROVAL', 'APPROVED', 'AUTHORIZED', 'CAPTURED', 'RECEIPTED',
  'RECONCILED', 'WITHDRAWN', 'EXPIRED', 'REFUSED', 'MISMATCH', 'FAILED', 'VOIDED', 'AUTO_VOIDED', 'REFUNDED', 'DISPUTED', 'UNCONFIRMED',
] as const;
export type DealKind = (typeof KINDS)[number];
export type Side = (typeof SIDES)[number];
export type Mode = (typeof MODES)[number];
export type DealState = (typeof STATES)[number];
export interface Deal {
  id: string;
  kind: DealKind;
  side: Side;
  counterparty: string;
  terms: Terms;
  /** `terms` as the file writes it: what the terms hash is taken over. */
  termsJson: unknown;
  state: DealState;
  mandate_id: string;
  mandate_version: number;
  transcript_head: Bytes;
  mode: Mode;
  /** The deal's latest market record; null when it has none. */
  market: MarketRef | null;
}
const readDeal = (value: unknown): Deal => {
  const r = rec(
    value,
    ['id', 'kind', 'side', 'counterparty', 'terms', 'state', 'mandate_id', 'mandate_version', 'transcript_head', 'paypal', 'mode'],
    ['created_at', 'updated_at', 'market', 'shield', 'decided_by', 'shield_rule', 'shield_release'],
  );
  rec(r.paypal, [], ['order', 'authorization', 'capture', 'subscription']);
  if (r.created_at !== undefined) whole(r.created_at);
  if (r.updated_at !== undefined) whole(r.updated_at);
  maybe(r.decided_by, readDecidedBy);
  return {
    id: ulid(r.id),
    kind: oneOf(r.kind, KINDS),
    side: oneOf(r.side, SIDES),
    counterparty: label(r.counterparty),
    terms: readTerms(r.terms),
    termsJson: r.terms,
    state: oneOf(r.state, STATES),
    mandate_id: ulid(r.mandate_id),
    mandate_version: whole(r.mandate_version, 0, 2 ** 32 - 1),
    transcript_head: bytes(r.transcript_head, 32),
    mode: oneOf(r.mode, MODES),
    market: r.market === undefined || r.market === null ? null : (readMarketRef(r.market) ?? refuse()),
  };
};

// ---- the owner's rules ---------------------------------------------------------------------------

/** One clause of the owner's rules. Only the parts the checks read are typed; the whole payload is
 *  hashed and signed as written. */
export type Clause = { type: string; [field: string]: unknown };
export interface Payload {
  id: string;
  version: number;
  agent_key: Bytes;
  clauses: Clause[];
  not_before: number;
  expires: number;
  /** The payload as the file writes it: what the owner signed and what the mandate hash is over. */
  json: unknown;
}
const CLAUSES = ['roles', 'counterparties', 'per_deal', 'band', 'velocity', 'human_present_over', 'payees', 'lever', 'market_watch'] as const;
const readPayload = (value: unknown): Payload => {
  const r = rec(value, ['id', 'version', 'agent_key', 'clauses', 'not_before', 'expires']);
  const clauses = list(r.clauses).map((c): Clause => {
    const type = oneOf((c as Rec | null)?.type, CLAUSES);
    if (typeof c !== 'object' || c === null) return refuse();
    return { ...(c as Rec), type };
  });
  return {
    id: ulid(r.id),
    version: whole(r.version, 0, 2 ** 32 - 1),
    agent_key: bytes(r.agent_key, 32),
    clauses,
    not_before: whole(r.not_before),
    expires: whole(r.expires),
    json: value,
  };
};

// ---- the rest of the file ------------------------------------------------------------------------

export interface Closed {
  deal_id: string;
  open_mandate_hash: Bytes;
  terms_hash: Bytes;
  amount: Money;
  payee: string;
  invoice_id: string;
  decided_by: DecidedBy;
  agent_sig: Bytes;
  /** The closed mandate as the file writes it. */
  json: Rec;
}
const readClosed = (value: unknown): Closed => {
  const r = rec(value, ['deal_id', 'open_mandate_hash', 'terms_hash', 'amount', 'payee', 'invoice_id', 'decided_by', 'agent_sig']);
  return {
    deal_id: ulid(r.deal_id),
    open_mandate_hash: bytes(r.open_mandate_hash, 32),
    terms_hash: bytes(r.terms_hash, 32),
    amount: readMoney(r.amount),
    payee: label(r.payee),
    invoice_id: text(r.invoice_id),
    decided_by: readDecidedBy(r.decided_by),
    agent_sig: bytes(r.agent_sig),
    json: r,
  };
};
export interface Operation {
  attempt: number;
  operation: string;
  decided_by: DecidedBy;
  status: string;
  request_id: string | null;
}
export interface Call {
  method: string;
  path: string;
  status: number | null;
  body: unknown;
  binding: unknown;
  at: number;
  request_id: string | null;
}
export interface Receipt {
  raw: string;
  capture_id: string | null;
  amount_minor: number | null;
  transcript_head: Bytes;
}
export interface AuditRow {
  seq: number;
  at: number;
  actor: string;
  action: string;
  detail_json: string;
  prev_hash: Bytes;
  hash: Bytes;
}
export interface GroupTable {
  deal_id: string;
  state: DealState;
  rows: AuditRow[];
}
/** The shop-around group this deal was one table of. */
export interface Group {
  id: string;
  opened_at: number;
  winner: string | null;
  tables: GroupTable[];
}
const readRow = (a: unknown): AuditRow => {
  const x = rec(a, ['seq', 'at', 'actor', 'action', 'detail_json', 'prev_hash', 'hash']);
  return {
    seq: whole(x.seq),
    at: whole(x.at),
    actor: text(x.actor),
    action: text(x.action),
    detail_json: text(x.detail_json),
    prev_hash: bytes(x.prev_hash, 32),
    hash: bytes(x.hash, 32),
  };
};
const readGroup = (value: unknown): Group => {
  const r = rec(value, ['id', 'opened_at', 'tables'], ['winner']);
  return {
    id: ulid(r.id),
    opened_at: whole(r.opened_at),
    winner: maybe(r.winner, ulid),
    tables: list(r.tables).map((t) => {
      const x = rec(t, ['deal_id', 'state', 'rows']);
      return { deal_id: ulid(x.deal_id), state: oneOf(x.state, STATES), rows: list(x.rows).map(readRow) };
    }),
  };
};

export interface Bundle {
  /** The file as parsed: the evidence head is taken over it. */
  json: Rec;
  format: string;
  exported_at: number;
  deal: Deal;
  owner_key: Bytes;
  mandate: { payload: Payload; owner_sig: Bytes };
  counterparty: { agent_key: Bytes; owner_key: Bytes };
  transcript: Array<{ inbound: boolean; raw: string; received_at: number }>;
  closed_mandates: Array<{ attempt: number; mandate: Closed }>;
  operations: Operation[];
  paypal_calls: Call[];
  receipts: Receipt[];
  audit: AuditRow[];
  audit_head: { seq: number; hash: Bytes };
  authority_manifest: Bytes | null;
  group: Group | null;
  house: House | null;
  evidence_head: Bytes;
  evidence_sig: Bytes;
}

export function readBundle(value: unknown): Bundle {
  const r = rec(
    value,
    ['format', 'exported_at', 'deal', 'owner_key', 'mandate', 'counterparty', 'transcript', 'closed_mandates', 'operations', 'paypal_calls', 'receipts', 'audit', 'audit_head', 'evidence_head', 'evidence_sig'],
    ['authority_manifest', 'group', 'house'],
  );
  const mandate = rec(r.mandate, ['payload', 'owner_sig']);
  const counterparty = rec(r.counterparty, ['agent_key', 'owner_key']);
  const head = rec(r.audit_head, ['seq', 'hash']);
  return {
    json: r,
    format: text(r.format),
    exported_at: whole(r.exported_at),
    deal: readDeal(r.deal),
    owner_key: bytes(r.owner_key, 32),
    mandate: { payload: readPayload(mandate.payload), owner_sig: bytes(mandate.owner_sig) },
    counterparty: { agent_key: bytes(counterparty.agent_key, 32), owner_key: bytes(counterparty.owner_key, 32) },
    transcript: list(r.transcript).map((e) => {
      const x = rec(e, ['inbound', 'raw', 'received_at']);
      return { inbound: flag(x.inbound), raw: text(x.raw), received_at: whole(x.received_at) };
    }),
    closed_mandates: list(r.closed_mandates).map((c) => {
      const x = rec(c, ['attempt', 'mandate']);
      return { attempt: whole(x.attempt, 0, 255), mandate: readClosed(x.mandate) };
    }),
    operations: list(r.operations).map((o) => {
      const x = rec(o, ['attempt', 'operation', 'decided_by', 'status'], ['request_id']);
      return {
        attempt: whole(x.attempt, 0, 255),
        operation: text(x.operation),
        decided_by: readDecidedBy(x.decided_by),
        status: text(x.status),
        request_id: maybe(x.request_id, text),
      };
    }),
    paypal_calls: list(r.paypal_calls).map((c) => {
      const x = rec(c, ['method', 'path', 'body', 'at'], ['status', 'binding', 'request_id']);
      return {
        method: text(x.method),
        path: text(x.path),
        status: maybe(x.status, (s) => whole(s)),
        body: x.body,
        binding: x.binding ?? null,
        at: whole(x.at),
        request_id: maybe(x.request_id, text),
      };
    }),
    receipts: list(r.receipts).map((c) => {
      const x = rec(c, ['raw', 'transcript_head'], ['capture_id', 'amount_minor']);
      return {
        raw: text(x.raw),
        capture_id: maybe(x.capture_id, text),
        amount_minor: maybe(x.amount_minor, (n) => whole(n)),
        transcript_head: bytes(x.transcript_head, 32),
      };
    }),
    audit: list(r.audit).map(readRow),
    audit_head: { seq: whole(head.seq), hash: bytes(head.hash, 32) },
    authority_manifest: maybe(r.authority_manifest, (m) => bytes(m, 32)),
    group: maybe(r.group, readGroup),
    house: maybe(r.house, readHouse),
    evidence_head: bytes(r.evidence_head, 32),
    evidence_sig: bytes(r.evidence_sig),
  };
}

// The money-authority rule of the wallet, as the offline verifier reads it (table-verify's
// authority.rs): who may start each money step and how a stored PayPal call is classified. One
// reading, shared by the "authority" and "countersign" checks.
import { type Bundle, type DecidedBy, decidedJson, type AuditRow, type Operation, type Money, type Terms } from './bundle';
import { canonical } from './jcs';
import { same, type Bytes } from './bytes';
import { payloadHash, clauseOf } from './mandate';

import { Why } from './why';

export { Why };
type Rec = Record<string, unknown>;

export type MoneyOp = 'create' | 'authorize' | 'capture' | 'void' | 'invoice-create' | 'invoice-send';
const OPS: readonly MoneyOp[] = ['create', 'authorize', 'capture', 'void', 'invoice-create', 'invoice-send'];
const OWNER_DECISION: Record<MoneyOp, string> = {
  create: 'deal_countersign',
  authorize: 'deal_countersign',
  capture: 'deal_capture',
  void: 'deal_void',
  'invoice-create': 'rescue_approve',
  'invoice-send': 'rescue_approve',
};
const opNamed = (name: string): MoneyOp | null => OPS.find((op) => op === name) ?? null;

/** What a stored PayPal call is: a read, a named money step, or a money-shaped call nobody named. */
export function moneyKind(method: string, path: string): string | null {
  if (method === 'GET') return null;
  if (method !== 'POST') return 'unclassified';
  const query = path.includes('?');
  const segments = (query ? path.slice(0, path.indexOf('?')) : path).replace(/^\/+|\/+$/g, '').split('/');
  const [a, b, c, d, e] = segments;
  const n = segments.length;
  let named: MoneyOp | null = null;
  if (n === 3 && a === 'v1' && b === 'oauth2' && c === 'token') return null;
  if (n === 3 && a === 'v2' && b === 'invoicing' && c === 'search-invoices') return null;
  if (n === 3 && a === 'v2' && b === 'checkout' && c === 'orders') named = 'create';
  else if (n === 5 && a === 'v2' && b === 'checkout' && c === 'orders' && e === 'authorize') named = 'authorize';
  else if (n === 5 && a === 'v2' && b === 'payments' && c === 'authorizations' && e === 'capture') named = 'capture';
  else if (n === 5 && a === 'v2' && b === 'payments' && c === 'authorizations' && e === 'void') named = 'void';
  else if (n === 3 && a === 'v2' && b === 'invoicing' && c === 'invoices') named = 'invoice-create';
  else if (n === 5 && a === 'v2' && b === 'invoicing' && c === 'invoices' && e === 'send') named = 'invoice-send';
  void d;
  if (named === null || query) return 'unclassified';
  return named;
}

/** Whether a stored call of step `kind` has an operation behind it, under the request id it went out with. */
export function callHasOperation(b: Bundle, kind: string, requestId: string | null): boolean {
  return b.operations.some((op) => op.operation === kind && (requestId === null || op.request_id === requestId));
}
export const decisionFits = (decision: string | null, operation: string): boolean => {
  const op = opNamed(operation);
  return decision !== null && op !== null && OWNER_DECISION[op] === decision;
};

/** An audit row's parsed detail; null when it does not parse. */
export function detailOf(row: AuditRow): unknown {
  try {
    return JSON.parse(row.detail_json);
  } catch {
    return null;
  }
}
export const field = (d: unknown, name: string): unknown => (typeof d === 'object' && d !== null ? (d as Rec)[name] : undefined);
export const textField = (d: unknown, name: string): string | null => {
  const v = field(d, name);
  return typeof v === 'string' ? v : null;
};
export const sameDecided = (a: DecidedBy, b: DecidedBy): boolean => canonical(decidedJson(a)) === canonical(decidedJson(b));

export type Reader = 'verifier' | 'safety';

/** Everything a rule needs besides the file: the mandate hash, worked out once. */
export interface Rules {
  bundle: Bundle;
  mandateHash: Bytes | null;
}
export async function rulesFor(bundle: Bundle): Promise<Rules> {
  return { bundle, mandateHash: await payloadHash(bundle.mandate.payload) };
}

/** Whether `op` is lawful for this deal, judged only from the deal's own evidence. */
export function judge(r: Rules, op: Operation, reader: Reader): string {
  const b = r.bundle;
  const reserved = b.audit.find((row) => {
    if (row.action !== 'money.authorized') return false;
    const d = detailOf(row);
    return (textField(d, 'request_id') ?? null) === op.request_id && textField(d, 'operation') === op.operation;
  });
  const firstFormat = reader === 'verifier' && b.format === 'table.proof.v1';
  if (reserved) return rule(r, op.operation, op.decided_by, reserved.seq, !firstFormat);
  if (firstFormat) return rule(r, op.operation, op.decided_by, null, false);
  throw new Why('no money.authorized row records its authority');
}

/** The three authorities the wallet allows: the owner in the approval window, a rule the owner signed,
 *  or a safe default (only a void). `reserved` is the seq of the step's `money.authorized` row: only
 *  earlier rows count; with none, every row of the deal does. */
export function rule(r: Rules, name: string, by: DecidedBy, reserved: number | null, ownerRow: boolean): string {
  const b = r.bundle;
  const deal = b.deal;
  const payload = b.mandate.payload;
  const earlier = (test: (row: AuditRow, d: unknown) => boolean): boolean =>
    b.audit.filter((row) => reserved === null || row.seq < reserved).some((row) => test(row, detailOf(row)));
  if (name.startsWith('invoice-') && (deal.kind !== 'rescue' || by.type !== 'human')) {
    throw new Why('an invoice goes out only on the owner\'s decision on a rescue deal');
  }
  const moneyStep = name === 'create' || name === 'authorize' || name === 'capture';
  switch (by.type) {
    case 'safe_default':
      if (name === 'void') return 'safe default (void)';
      throw new Why(`a safe default decided a ${name}; it may only void`);
    case 'policy': {
      if (by.clause !== 6) throw new Why(`clause ${by.clause} decided a ${name}; only clause 6 countersigns`);
      const limit = (clauseOf(payload, 'human_present_over') as Rec | undefined)?.amount as Money | undefined;
      let under = false;
      try {
        const amount = termsAmount(deal.terms);
        under = limit !== undefined && limit.currency === amount.currency && amount.minor <= limit.minor;
      } catch {
        under = false;
      }
      if (!moneyStep) throw new Why(`the clause-6 rule decided a ${name}`);
      if (deal.kind !== 'haggle') throw new Why(`the clause-6 rule decided a ${name} on a ${debugKind(deal.kind)} deal`);
      if (!under) throw new Why(`the clause-6 rule decided a ${name} above the human-present threshold`);
      return 'owner-signed rule: clause 6, under the human-present threshold';
    }
    case 'human': {
      if (ownerRow) {
        const decided = canonical(decidedJson(by));
        const saw = earlier((row, d) => row.action === 'owner.decision' && canonical(field(d, 'decided_by') ?? null) === decided && decisionFits(textField(d, 'decision'), name));
        if (!saw) throw new Why(`an owner ${name} with no owner decision in the approval window before it`);
      }
      if (opNamed(name) === null) throw new Why(`an owner ${name}: not a money step the wallet sends`);
      if (by.at >= payload.not_before && by.at <= b.exported_at) return 'owner decision in the approval window (recorded by the wallet)';
      throw new Why('owner decision time is outside the mandate\'s validity');
    }
    default: {
      const house = by.type === 'house_mandate';
      if (deal.side !== 'seller') throw new Why(`a seller's mandate decided a ${name} on the buyer side`);
      if (r.mandateHash === null || !same(r.mandateHash, by.mandate_hash)) throw new Why(`the mandate behind a ${name} is not this deal's signed mandate`);
      if (house && deal.kind !== 'haggle') throw new Why(`the house mandate decided a ${name} off a haggle`);
      const approved = (): boolean => earlier((row, d) => row.action === 'deal.transition' && field(d, 'to') === 'APPROVED');
      if (name === 'create' && house) return 'release-pinned house mandate (pin itself not in the bundle)';
      if (name === 'authorize' || name === 'capture') {
        if (approved()) return house ? 'release-pinned house mandate (buyer approved on PayPal)' : 'owner-signed seller mandate (buyer approved on PayPal)';
        throw new Why(`a seller's mandate decided a ${name} before the buyer approved the order at PayPal`);
      }
      throw new Why(`a seller's mandate decided a ${name}`);
    }
  }
}
const debugKind = (kind: string): string => kind.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');

// ---- terms --------------------------------------------------------------------------------------

/** `Terms::amount`: the deal's total, or why the terms are not valid, in the wallet's own words. */
export function termsAmount(terms: Terms): Money {
  const d = terms.delivery;
  if (terms.qty === 0 || terms.unit_price.minor === 0 || terms.currency !== terms.unit_price.currency) throw new Why('invalid closed terms');
  if (d.type === 'ship_then_capture' && (d.days === 0 || d.days > 3)) throw new Why('invalid closed terms');
  const minor = BigInt(terms.unit_price.minor) * BigInt(terms.qty);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Why('amount exceeds the exact JSON integer range');
  return { minor: Number(minor), currency: terms.unit_price.currency };
}

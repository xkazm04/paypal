// The sixteen checks of the offline verifier (table-verify's lib.rs and v2.rs), in the same order,
// under the same ids and with the same lines, so the report this makes for a file is the report the
// wallet makes for it. Each check runs even when an earlier one failed.
//
// Where a record needs arithmetic this page does not carry yet (a shop-around group, the house
// seller's signed record, market prices worked out again), the line reads "not checked" and says
// so. It never reads as passed.
import { type Bytes, byteArray, same, sha256, toHex, ZERO32 } from './bytes';
import { type AuditRow, type Bundle, type DecidedBy, readDecidedBy, sameMoney, showMoney, decimal } from './bundle';
import { canonical, canonicalBytes } from './jcs';
import { isPublicKey, verifyStrict } from './ed25519';
import { verifyEnvelope, signedBody, ProtocolError } from './envelope';
import { clauseOf, invalidPayload } from './mandate';
import {
  callHasOperation, decisionFits, detailOf, field, judge, moneyKind, rule, rulesFor, sameDecided, termsAmount, textField, Why,
  type Rules,
} from './authority';

type Rec = Record<string, unknown>;

export interface CheckLine {
  id: string;
  ok: boolean;
  /** False when the file lacks the record the check compares: `ok` is false too. */
  checked: boolean;
  /** False when the deal has nothing of the kind the check is about: no claim either way. */
  applies: boolean;
  detail: string;
}

/** A check that did not pass; `checked` / `applies` say whether it was made at all. */
class Miss extends Error {
  constructor(message: string, readonly checked = true, readonly applies = true) {
    super(message);
  }
}
const absent = (detail: string): Miss => new Miss(detail, false, false);
/** Not made, though it should have been: the file lacks the record, or this page cannot make it. */
const unmade = (detail: string): Miss => new Miss(detail, false, true);

const short = (hash: Bytes): string => toHex(hash).slice(0, 12);
const isHash = (value: unknown): boolean => byteArray(value, 32) !== null;
const decidedIn = (d: unknown, name: string): DecidedBy | null => {
  try {
    return readDecidedBy(field(d, name));
  } catch {
    return null;
  }
};
const rowsOf = (b: Bundle, ...actions: string[]): AuditRow[] => b.audit.filter((r) => actions.includes(r.action));

/** Everything the checks share, worked out once per file. */
interface Run {
  b: Bundle;
  rules: Rules;
  /** False when this browser cannot verify Ed25519 at all. */
  signatures: boolean;
}

function agentKey(run: Run): Bytes {
  const key = run.b.mandate.payload.agent_key;
  if (!isPublicKey(key)) throw new Why('agent key in the mandate is not a valid Ed25519 key');
  return key;
}
const needSignatures = (run: Run): void => {
  if (!run.signatures) throw unmade('not checked: this browser cannot check Ed25519 signatures');
};

// ---- format, mandate -----------------------------------------------------------------------------

const V1 = 'table.proof.v1';
const V2 = 'table.proof.v2';
function hasV2Fields(b: Bundle): boolean {
  return b.authority_manifest !== null || b.group !== null || b.house !== null || b.operations.some((o) => o.request_id !== null) || b.paypal_calls.some((c) => c.request_id !== null);
}
async function format({ b }: Run): Promise<string> {
  if (b.format === V1 && hasV2Fields(b)) throw new Why('a first-format file carries records only the second format has');
  if (b.format === V1) return `${V1} (the first proof format)`;
  if (b.format === V2 && b.authority_manifest === null) throw new Why('the file does not name the permissions it was saved under');
  if (b.format === V2) return V2;
  throw new Why(`unknown format ${JSON.stringify(b.format)}`);
}

async function mandate(run: Run): Promise<string> {
  const { b } = run;
  needSignatures(run);
  if (!isPublicKey(b.owner_key)) throw new Why('owner key is not a valid Ed25519 key');
  const payload = b.mandate.payload;
  if (payload.id !== b.deal.mandate_id || payload.version !== b.deal.mandate_version) throw new Why('the mandate is not the one the deal names');
  const signed = invalidPayload(payload) === null && (await verifyStrict(b.owner_key, canonicalBytes(payload.json), b.mandate.owner_sig));
  if (!signed) throw new Why('owner signature over the mandate does not verify');
  return `mandate ${payload.id} v${payload.version}`;
}

// ---- transcript ----------------------------------------------------------------------------------

async function transcript(run: Run): Promise<string> {
  const { b } = run;
  const deal = b.deal;
  needSignatures(run);
  const own = agentKey(run);
  const peer = b.counterparty.agent_key;
  if (!isPublicKey(peer)) throw new Why('counterparty agent key is not a valid Ed25519 key');
  const ownId = toHex(await sha256(own));
  const peerId = toHex(await sha256(peer));
  if (peerId !== deal.counterparty) throw new Why('counterparty key does not match the deal');
  let previous: Bytes = ZERO32;
  let [nextIn, nextOut, inbound, outbound] = [1, 1, 0, 0];
  const nonces = new Set<string>();
  // (seq, hash, received, counter) of the last proposal, as the ledger tracks it.
  let proposal: { seq: number; hash: Bytes; received: boolean; counter: boolean } | null = null;
  for (const [index, entry] of b.transcript.entries()) {
    let verified;
    try {
      verified = await verifyEnvelope(entry.raw, entry.inbound ? peer : own, {
        deal_id: deal.id,
        audience: entry.inbound ? ownId : peerId,
        nextSenderSeq: entry.inbound ? nextIn : nextOut,
        previous,
        now: entry.received_at,
        nonces,
      });
    } catch (e) {
      if (e instanceof ProtocolError) throw new Why(`message ${index + 1}: ${e.message}`);
      throw e;
    }
    const { envelope, hash } = verified;
    const body = envelope.body;
    if (body.type === 'ACCEPT' && body.owner_accept) {
      const proof = body.owner_accept;
      const pinned = entry.inbound ? b.counterparty.owner_key : b.owner_key;
      if (!same(proof.owner_key, pinned) || !proposal || proposal.seq !== proof.offer_seq || !same(proposal.hash, proof.counter_hash) || proposal.received !== !entry.inbound || !proposal.counter) {
        throw new Why(`message ${index + 1}: owner accept is not bound to the pinned owner and last counter`);
      }
    }
    if (body.type === 'OFFER' || body.type === 'COUNTER') proposal = { seq: envelope.seq, hash, received: entry.inbound, counter: body.type === 'COUNTER' };
    previous = hash;
    nonces.add(`${envelope.iss}:${toHex(envelope.nonce)}`);
    if (entry.inbound) {
      nextIn += 1;
      inbound += 1;
    } else {
      nextOut += 1;
      outbound += 1;
    }
  }
  if (!same(previous, deal.transcript_head)) throw new Why('transcript does not end at the deal\'s transcript head');
  return `agent signed ${outbound} outbound, peer signed ${inbound} inbound; head ${short(previous)}`;
}

// ---- countersign, authority, PayPal order --------------------------------------------------------

async function closed(run: Run): Promise<string> {
  const { b, rules } = run;
  const deal = b.deal;
  const hasOperation = (attempt: number): boolean => b.closed_mandates.some((c) => c.attempt === attempt);
  // The wallet countersigns an attempt before it creates or authorizes it and refuses a capture
  // without one: a money step in with no countersign for its attempt was not the wallet's.
  const orphan = b.operations.find((op) => ['create', 'authorize', 'capture'].includes(op.operation) && !hasOperation(op.attempt));
  if (orphan) throw new Why(`attempt ${orphan.attempt}: a ${orphan.operation} with no countersign for its attempt`);
  if (b.closed_mandates.length === 0) return 'no countersign in this deal';
  needSignatures(run);
  const own = agentKey(run);
  const open = rules.mandateHash ?? (() => { throw new Why('mandate payload does not validate'); })();
  const amount = termsAmount(deal.terms);
  const terms = await sha256(canonicalBytes(deal.termsJson));
  // Clause 7 governs every countersign on either side: the wallet refuses a payee outside it.
  const payees = (clauseOf(b.mandate.payload, 'payees') as Rec | undefined)?.payees as unknown[] | undefined;
  for (const record of b.closed_mandates) {
    const c = record.mandate;
    const { agent_sig: _signature, ...unsigned } = c.json;
    void _signature;
    const signing = canonicalBytes(unsigned);
    if (record.attempt < 1 || record.attempt > 3) throw new Why('settlement attempts must be 1 through 3');
    const expectedInvoice = `${deal.id}-${record.attempt}`;
    if (c.deal_id !== deal.id || !same(c.open_mandate_hash, open) || !same(c.terms_hash, terms) || !sameMoney(c.amount, amount) || c.invoice_id !== expectedInvoice) {
      throw new Why(`attempt ${record.attempt}: closed mandate does not bind this deal's mandate, terms and amount`);
    }
    if (!(await verifyStrict(own, signing, c.agent_sig))) throw new Why(`attempt ${record.attempt}: agent signature over the closed mandate does not verify`);
    if (payees && !payees.includes(c.payee)) throw new Why(`attempt ${record.attempt}: countersigned payee is not in the owner-signed payee list`);
    try {
      rule(rules, 'create', c.decided_by, null, false);
    } catch (e) {
      if (e instanceof Why) throw new Why(`attempt ${record.attempt}: ${e.message}`);
      throw e;
    }
  }
  const payee = payees ? 'payee is in the owner-signed payee list' : 'payee signed by the agent; the mandate names no payee list';
  return `${b.closed_mandates.length} countersign(s) bind terms ${short(terms)} and ${showMoney(amount)}; ${payee}`;
}

async function authority({ b, rules }: Run): Promise<string> {
  const verdicts: string[] = [];
  for (const op of b.operations) {
    try {
      verdicts.push(`${op.operation}: ${judge(rules, op, 'verifier')}`);
    } catch (e) {
      if (e instanceof Why) throw new Why(`${op.operation} (attempt ${op.attempt}): ${e.message}`);
      throw e;
    }
  }
  for (const call of b.paypal_calls) {
    const kind = moneyKind(call.method, call.path);
    if (kind === null) continue;
    if (kind === 'unclassified') throw new Why(`money-shaped ${call.method} ${call.path} has no known operation`);
    if (!callHasOperation(b, kind, call.request_id)) throw new Why(`POST ${call.path} (${kind}) has no recorded authority`);
  }
  return verdicts.length === 0 ? 'no money operation in this deal' : verdicts.join('; ');
}

/** The calls PayPal answers with an order, so the wallet projects a binding from every 2xx answer. */
function answersWithOrder(method: string, path: string): boolean {
  const s = path.replace(/^\/+|\/+$/g, '').split('/');
  const head = s[0] === 'v2' && s[1] === 'checkout' && s[2] === 'orders';
  return (
    (method === 'POST' && head && s.length === 3) ||
    (method === 'POST' && head && s.length === 5 && s[4] === 'authorize') ||
    (method === 'GET' && head && s.length === 4)
  );
}
const asText = (v: unknown): string | null => (typeof v === 'string' ? v : null);
async function bindings({ b }: Run): Promise<string> {
  const deal = b.deal;
  const amount = termsAmount(deal.terms);
  const terms = toHex(await sha256(canonicalBytes(deal.termsJson)));
  let checked = 0;
  for (const call of b.paypal_calls) {
    const units = field(call.binding, 'purchase_units');
    if (!Array.isArray(units) || units.length === 0) {
      // An order PayPal answered with no stored binding proves nothing, so the bundle is never
      // verified; a file saved before the wallet stored bindings has none, so the line reads
      // "not checked": the comparison could not be made, which is not a mismatch.
      const answered = call.status !== null && call.status >= 200 && call.status < 300;
      if (!answered || !answersWithOrder(call.method, call.path)) continue;
      throw unmade(`not checked: ${call.method} ${call.path}: PayPal answered with an order, but the file holds no order record to compare (a wallet older than the order record saved it)`);
    }
    for (const unit of units) {
      const custom = asText(field(unit, 'custom_id'));
      const invoice = asText(field(unit, 'invoice_id'));
      const payee = asText(field(unit, 'payee_merchant_id'));
      // Every order call PayPal answered with purchase units carries all four facts; a missing one is not "unchecked".
      if (custom === null || invoice === null || payee === null) throw new Why(`${call.path}: the order record lacks custom_id, invoice id or payee, so it proves nothing`);
      if (custom !== terms) throw new Why(`${call.path}: custom_id is not this deal's terms hash`);
      if (!b.closed_mandates.some((c) => c.mandate.invoice_id === invoice)) throw new Why(`${call.path}: invoice id matches no countersign`);
      if (!b.closed_mandates.some((c) => c.mandate.payee === payee)) throw new Why(`${call.path}: PayPal payee is not the countersigned payee`);
      const value = asText(field(field(unit, 'amount'), 'value'));
      const currency = asText(field(field(unit, 'amount'), 'currency_code'));
      if (value === null || currency === null) throw new Why(`${call.path}: the order record lacks the amount`);
      if (value !== decimal(amount) || currency !== amount.currency) throw new Why(`${call.path}: PayPal amount is not the signed amount`);
      checked += 1;
    }
  }
  return checked === 0
    ? 'no PayPal order in this deal, so no order binding to compare'
    : `${checked} PayPal order record(s): custom_id = terms hash, invoice id, payee merchant id and amount compared and matching`;
}

// ---- the record ----------------------------------------------------------------------------------

/** One audit row's detail, after checking it is canonical and that the row's hash covers it, the
 *  row's other fields and `deal`. */
async function rowDetail(row: AuditRow, deal: string): Promise<unknown> {
  let detail: unknown;
  try {
    detail = JSON.parse(row.detail_json);
  } catch {
    throw new Why(`row ${row.seq}: detail`);
  }
  if (canonical(detail) !== row.detail_json) throw new Why(`row ${row.seq}: detail is not canonical`);
  // The ledger's preimage: {seq, at, actor, action, deal_id, detail_json}, chained.
  const preimage = canonicalBytes({ seq: row.seq, at: row.at, actor: row.actor, action: row.action, deal_id: deal, detail_json: detail });
  if (!same(await sha256(row.prev_hash, preimage), row.hash)) throw new Why(`row ${row.seq}: hash does not match its contents`);
  return detail;
}
async function audit({ b }: Run): Promise<string> {
  let last: { seq: number; hash: Bytes } | null = null;
  for (const row of b.audit) {
    await rowDetail(row, b.deal.id);
    if (last) {
      if (row.seq <= last.seq) throw new Why(`row ${row.seq}: out of order`);
      if (row.seq === last.seq + 1 && !same(row.prev_hash, last.hash)) throw new Why(`row ${row.seq}: not chained to row ${last.seq}`);
    }
    last = { seq: row.seq, hash: row.hash };
  }
  const head = b.audit_head;
  if (last && (last.seq > head.seq || (last.seq === head.seq && !same(last.hash, head.hash)))) throw new Why('audit rows run past the exported chain head');
  return `${b.audit.length} deal rows hash-consistent; chain head #${head.seq} ${short(head.hash)}`;
}

async function receipts({ b }: Run): Promise<string> {
  const agreed = termsAmount(b.deal.terms);
  const answered = b.paypal_calls
    .filter((c) => moneyKind(c.method, c.path) === 'capture' && c.status !== null && c.status >= 200 && c.status < 300)
    .flatMap((c) => {
      const id = field(c.body, 'id');
      return typeof id === 'string' ? [id] : [];
    });
  for (const receipt of b.receipts) {
    if (!b.transcript.some((e) => e.raw === receipt.raw)) throw new Why('receipt is not part of the signed transcript');
    const signed = signedBody(receipt.raw);
    if (!signed || signed.body.type !== 'RECEIPT') throw new Why('receipt is not a signed receipt message');
    const { capture_id: captureId, amount, transcript_head: head } = signed.body;
    if (!sameMoney(amount, agreed)) throw new Why(`receipt states ${showMoney(amount)} but the signed terms agreed ${showMoney(agreed)}`);
    if (receipt.amount_minor !== amount.minor || receipt.capture_id !== captureId || !same(receipt.transcript_head, head)) throw new Why('receipt fields differ from the signed receipt');
    if (answered.length > 0 && !answered.includes(captureId)) throw new Why('receipt capture id is not the one PayPal answered');
  }
  return b.receipts.length === 0 ? 'no receipt yet' : `${b.receipts.length} receipt(s) inside the signed transcript, for the agreed amount`;
}

async function evidence(run: Run): Promise<string> {
  const { b } = run;
  needSignatures(run);
  const own = agentKey(run);
  const { evidence_head: _head, evidence_sig: _sig, ...rest } = b.json;
  void _head;
  void _sig;
  // The wallet writes an absent optional record by leaving the key out.
  for (const key of ['authority_manifest', 'group', 'house']) if (rest[key] === null) delete rest[key];
  const head = await sha256(canonicalBytes([b.format, rest]));
  if (!same(head, b.evidence_head)) throw new Why('bundle contents differ from the signed evidence head');
  if (!(await verifyStrict(own, head, b.evidence_sig))) throw new Why('evidence head is not signed by the deal\'s agent key');
  return `evidence head ${short(head)} signed by the deal's agent`;
}

// ---- the second format's checks ------------------------------------------------------------------

const older = (b: Bundle): Miss | null => (b.format === V1 ? absent('not checked: a file in the first proof format does not carry this record') : null);

async function ownerSaw({ b }: Run): Promise<string> {
  const o = older(b);
  if (o) throw o;
  const owner = (by: DecidedBy): boolean => by.type === 'human';
  const steps: Array<{ row: AuditRow; op: string; by: DecidedBy }> = [];
  for (const row of rowsOf(b, 'money.authorized')) {
    const d = detailOf(row);
    const op = textField(d, 'operation');
    const by = decidedIn(d, 'decided_by');
    if (op !== null && by !== null && owner(by) && op !== 'void') steps.push({ row, op, by });
  }
  const decided = b.operations.filter((op) => owner(op.decided_by) && op.operation !== 'void');
  if (steps.length === 0 && decided.length === 0) throw absent('not checked: no money step in this deal was the owner\'s decision');
  for (const op of decided) {
    if (!steps.some((s) => s.op === op.operation && sameDecided(s.by, op.decided_by))) {
      throw new Why(`the owner's ${op.operation} step (attempt ${op.attempt}) has no record in the deal's rows`);
    }
  }
  for (const { row, op, by } of steps) {
    const saw = rowsOf(b, 'owner.decision')
      .filter((r) => r.seq < row.seq)
      .map(detailOf)
      .some((d) => {
        const decidedBy = decidedIn(d, 'decided_by');
        return decidedBy !== null && sameDecided(decidedBy, by) && decisionFits(textField(d, 'decision'), op) && isHash(field(d, 'checks_hash'));
      });
    if (!saw) throw new Why(`the owner's ${op} step (record #${row.seq}) has no earlier record of the checklist the owner saw`);
  }
  return `${steps.length} owner decision(s), each recorded with the hash of the checklist the owner saw, before its money step`;
}

async function oneRequest({ b }: Run): Promise<string> {
  const o = older(b);
  if (o) throw o;
  const checks = rowsOf(b, 'money.resolved', 'money.resent', 'money.parked');
  if (checks.length === 0) throw absent('not checked: no money step in this deal needed a second look at PayPal');
  const reserved = rowsOf(b, 'money.authorized').flatMap((row) => {
    const d = detailOf(row);
    const op = textField(d, 'operation');
    const id = textField(d, 'request_id');
    return op !== null && id !== null ? [{ seq: row.seq, kind: op, id }] : [];
  });
  const kinds: string[] = [];
  for (const row of checks) {
    const d = detailOf(row);
    const op = textField(d, 'operation');
    const id = textField(d, 'request_id');
    if (op === null || id === null) throw new Why(`record #${row.seq}: no step or request id`);
    const first = [...reserved].reverse().find((r) => r.seq < row.seq && r.kind === op);
    if (!first || first.id !== id) throw new Why(`the ${op} step was checked again (record #${row.seq}) under a request id it was not first sent with`);
    if (!kinds.includes(op)) kinds.push(op);
  }
  const ids = (kind: string): string[] => reserved.filter((r) => r.kind === kind).map((r) => r.id);
  let calls = 0;
  for (const call of b.paypal_calls) {
    const kind = moneyKind(call.method, call.path);
    if (kind === null || !kinds.includes(kind)) continue;
    if (call.request_id === null) throw new Why(`${call.path}: the file does not say which request id it went under`);
    if (!ids(kind).includes(call.request_id)) throw new Why(`${call.path}: sent to PayPal under a second request id`);
    calls += 1;
  }
  for (const op of b.operations) {
    if (kinds.includes(op.operation) && (op.request_id === null || !ids(op.operation).includes(op.request_id))) {
      throw new Why(`the ${op.operation} step (attempt ${op.attempt}) is recorded under a request id its rows never name`);
    }
  }
  const resent = checks.filter((r) => r.action === 'money.resent').length;
  return `${kinds.length} step(s) checked again with PayPal, each under the one request id it was first sent with (${resent} re-send(s), ${calls} PayPal call(s))`;
}

async function group({ b }: Run): Promise<string> {
  const o = older(b);
  if (o) throw o;
  const own = rowsOf(b, 'group.opened', 'group.won', 'group.withdrawn');
  if (b.group === null) {
    if (own.length === 0) throw absent('not checked: this deal was not one table of a shop-around group');
    throw new Why('the deal\'s rows name a shop-around group the file leaves out');
  }
  throw unmade('not checked: this page does not check shop-around groups yet');
}

const HOLD = ['HOLD', 'BLOCK'];
const ORDER = ['CLEAR', 'ASK', 'HOLD', 'BLOCK'];
async function shield(run: Run): Promise<string> {
  const { b } = run;
  const o = older(b);
  if (o) throw o;
  if (rowsOf(b, 'shield.raised', 'shield.released', 'shield.refused').length === 0) {
    throw absent('not checked: the safety check never held or refused a step in this deal');
  }
  const terms = toHex(await sha256(canonicalBytes(b.deal.termsJson)));
  const hashHex = (v: unknown): string | null => {
    const bytes = byteArray(v, 32);
    return bytes ? toHex(bytes) : null;
  };
  let verdict: { v: string; rule: string | null; held: string | null } | null = null;
  let release: { at: string; rules: string[] } | null = null;
  let [holds, refused, releasedSteps] = [0, 0, 0];
  for (const row of b.audit) {
    const d = detailOf(row);
    switch (row.action) {
      case 'shield.checked':
      case 'shield.raised': {
        const v = textField(d, 'verdict');
        if (v === null || !ORDER.includes(v)) throw new Why(`record #${row.seq}: no verdict`);
        if (HOLD.includes(v)) holds += 1;
        verdict = { v, rule: textField(d, 'rule'), held: hashHex(field(d, 'terms_hash')) };
        break;
      }
      case 'shield.released': {
        const at = hashHex(field(d, 'terms_hash'));
        const rules = field(d, 'rules');
        if (at === null || !Array.isArray(rules)) throw new Why(`record #${row.seq}: a release without its terms`);
        release = { at, rules: rules as string[] };
        break;
      }
      case 'shield.refused':
        refused += 1;
        break;
      case 'money.authorized': {
        const op = textField(d, 'operation') ?? 'money';
        if (op === 'void') break;
        if (!verdict || !HOLD.includes(verdict.v) || (verdict.held !== null && verdict.held !== terms)) break;
        if (verdict.v === 'BLOCK') throw new Why(`the ${op} step (record #${row.seq}) went ahead while the safety check blocked the deal`);
        const covered = verdict.rule !== null && release !== null && release.at === terms && release.rules.includes(verdict.rule);
        if (!covered) {
          throw new Why(`the ${op} step (record #${row.seq}) went ahead while the safety check held the deal${verdict.held !== null ? ' on these terms' : ''}, with no release by the owner for these terms`);
        }
        releasedSteps += 1;
        break;
      }
      default:
    }
  }
  return `${holds} hold(s) or block(s), ${refused} refused step(s); ${releasedSteps} money step(s) after a hold, each under the owner's release for these terms`;
}

async function houseRecord({ b }: Run): Promise<string> {
  const o = older(b);
  if (o) throw o;
  const kept = rowsOf(b, 'house.head_kept');
  if (b.house === null) {
    if (kept.length === 0) throw absent('not checked: this deal kept no copy of the house seller\'s signed record');
    throw new Why('the deal kept the house\'s record, but the file leaves it out');
  }
  throw unmade('not checked: this page does not check the house seller\'s signed record yet');
}

async function market({ b }: Run): Promise<string> {
  const o = older(b);
  if (o) throw o;
  const unsupported = unmade('not checked: this page does not work market prices out again yet');
  if (b.deal.market !== null) throw unsupported;
  // The deal's agreement row names the market record the deal was agreed on, if there was one.
  const agreement = b.audit.map((r) => ({ action: r.action, d: detailOf(r) })).find(({ action, d }) => action === 'deal.transition' && field(d, 'to') === 'AGREED');
  if (!agreement) throw absent('not checked: the deal is not agreed yet');
  const commitment = field(agreement.d, 'market');
  const kind = field(commitment, 'format');
  if (kind === 'table.market.v1') throw absent('not checked: the deal was agreed on an older market record, which kept no prices to compute again');
  if (kind === 'table.market.v2') throw unsupported;
  throw absent('not checked: the deal had no market price when it was agreed');
}

async function permissions({ b }: Run): Promise<string> {
  const o = older(b);
  if (o) throw o;
  if (b.authority_manifest === null) throw new Why('the file does not name the permissions it was saved under');
  return `permissions fingerprint ${toHex(b.authority_manifest)}`;
}

// ---- the report ----------------------------------------------------------------------------------

type CheckFn = (run: Run) => Promise<string>;
export const CHECKS: ReadonlyArray<readonly [string, CheckFn]> = [
  ['format', format],
  ['mandate', mandate],
  ['transcript', transcript],
  ['countersign', closed],
  ['authority', authority],
  ['paypal_order', bindings],
  ['audit', audit],
  ['receipt', receipts],
  ['owner_saw', ownerSaw],
  ['one_request', oneRequest],
  ['group', group],
  ['shield', shield],
  ['house_record', houseRecord],
  ['market', market],
  ['permissions', permissions],
  ['evidence', evidence],
];
/** The ids of the checks, in report order. */
export const CHECK_IDS: readonly string[] = CHECKS.map(([id]) => id);

/** One check, made: a line that passed, or why it did not. A check that could not run to the end
 *  (a bug here, or a file this page cannot make sense of) is never green. */
export async function runCheck(id: string, run: Run): Promise<CheckLine> {
  const fn = CHECKS.find(([name]) => name === id)?.[1];
  if (!fn) throw new Error(`no check named ${id}`);
  try {
    return { id, ok: true, checked: true, applies: true, detail: await fn(run) };
  } catch (e) {
    if (e instanceof Why) return { id, ok: false, checked: true, applies: true, detail: e.message };
    if (e instanceof Miss) return { id, ok: false, checked: e.checked, applies: e.applies, detail: e.message };
    return { id, ok: false, checked: false, applies: true, detail: 'not checked: this page ran into a problem making this check' };
  }
}

export async function makeRun(bundle: Bundle, signatures: boolean): Promise<Run> {
  return { b: bundle, rules: await rulesFor(bundle), signatures };
}
export type { Run };

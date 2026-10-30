// The agents' signed messages (compact JWS, EdDSA): the same rules the wallet applies to every
// message it accepts, so a message in a proof file is judged exactly as it was when it arrived.
import { type Bytes, byteArray, fromBase64Url, same, sha256, toHex, utf8, ZERO32 } from './bytes';
import { type Money, MAX_SAFE, readDelivery, readMoney, type Delivery } from './bundle';
import { canonical, canonicalBytes } from './jcs';
import { verifyStrict } from './ed25519';

/** Why a message was refused, in the wallet's own words. */
export const PROTOCOL_ERRORS = {
  shape: 'invalid compact JWS shape, size or encoding',
  schema: 'unknown/noncanonical JSON or invalid envelope schema',
  signature: 'bad signature or signing key',
  binding: 'unexpected sender, audience or deal',
  time: 'expired, future-dated or invalid lifetime',
  nonce: 'nonce reused',
  sequence: 'sequence gap or exhausted sequence',
  previous: 'transcript head mismatch',
  body: 'invalid message body',
} as const;
export class ProtocolError extends Error {
  constructor(readonly kind: keyof typeof PROTOCOL_ERRORS) {
    super(PROTOCOL_ERRORS[kind]);
  }
}
const fail = (kind: keyof typeof PROTOCOL_ERRORS): never => {
  throw new ProtocolError(kind);
};

const MAX_JWS_BYTES = 16 * 1024;
type Rec = Record<string, unknown>;

export interface OwnerAccept {
  deal_id: string;
  offer_seq: number;
  terms_hash: Bytes;
  counter_hash: Bytes;
  owner_key: Bytes;
  signature: Bytes;
}
export type Body =
  | { type: 'HELLO'; owner_key: Bytes; agent_key: Bytes; mandate_commitment: Bytes; owner_sig_over_commitment: Bytes }
  | { type: 'LISTING'; delivery: Delivery }
  | { type: 'OFFER' | 'COUNTER'; price: Money; delivery: Delivery }
  | { type: 'ACCEPT'; offer_seq: number; terms_hash: Bytes; owner_accept: OwnerAccept | null }
  | { type: 'SETTLE'; amount: Money; attempt: number }
  | { type: 'APPROVED' }
  | { type: 'RECEIPT'; capture_id: string; amount: Money; transcript_head: Bytes }
  | { type: 'WITHDRAW' | 'NOTE' };
export interface Envelope {
  v: number;
  typ: string;
  deal_id: string;
  seq: number;
  prev: Bytes;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  nonce: Bytes;
  body: Body;
}

function keys(value: unknown, required: string[], optional: string[] = []): Rec {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail('schema');
  const r = value as Rec;
  for (const k of required) if (!(k in r)) return fail('schema');
  for (const k of Object.keys(r)) if (!required.includes(k) && !optional.includes(k)) return fail('schema');
  return r;
}
const str = (v: unknown): string => (typeof v === 'string' ? v : fail('schema'));
const int = (v: unknown, min = -MAX_SAFE, max = MAX_SAFE): number => (typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max ? v : fail('schema'));
const raw = (v: unknown, length?: number): Bytes => byteArray(v, length) ?? fail('schema');
const wrap = <T>(read: () => T): T => {
  try {
    return read();
  } catch {
    return fail('schema');
  }
};

function readBody(value: unknown): Body {
  const type = (value as Rec | null)?.type;
  switch (type) {
    case 'HELLO': {
      const r = keys(value, ['type', 'owner_key', 'agent_key', 'mandate_commitment', 'owner_sig_over_commitment', 'display_name']);
      return { type, owner_key: raw(r.owner_key, 32), agent_key: raw(r.agent_key, 32), mandate_commitment: raw(r.mandate_commitment, 32), owner_sig_over_commitment: raw(r.owner_sig_over_commitment) };
    }
    case 'LISTING': {
      const r = keys(value, ['type', 'item_ref', 'ask', 'delivery'], ['qty']);
      wrap(() => readMoney(r.ask));
      return { type, delivery: wrap(() => readDelivery(r.delivery)) };
    }
    case 'OFFER':
    case 'COUNTER': {
      const r = keys(value, ['type', 'price', 'delivery']);
      return { type, price: wrap(() => readMoney(r.price)), delivery: wrap(() => readDelivery(r.delivery)) };
    }
    case 'ACCEPT': {
      const r = keys(value, ['type', 'offer_seq', 'terms_hash'], ['owner_accept']);
      let owner: OwnerAccept | null = null;
      if (r.owner_accept !== undefined && r.owner_accept !== null) {
        const o = keys(r.owner_accept, ['deal_id', 'offer_seq', 'terms_hash', 'counter_hash', 'owner_key', 'signature']);
        owner = { deal_id: str(o.deal_id), offer_seq: int(o.offer_seq, 0, 2 ** 32 - 1), terms_hash: raw(o.terms_hash, 32), counter_hash: raw(o.counter_hash, 32), owner_key: raw(o.owner_key, 32), signature: raw(o.signature) };
      }
      return { type, offer_seq: int(r.offer_seq, 0, 2 ** 32 - 1), terms_hash: raw(r.terms_hash, 32), owner_accept: owner };
    }
    case 'SETTLE': {
      const r = keys(value, ['type', 'order_id', 'approve_url', 'amount', 'invoice_id', 'intent', 'attempt']);
      return { type, amount: wrap(() => readMoney(r.amount)), attempt: int(r.attempt, 0, 255) };
    }
    case 'APPROVED':
      keys(value, ['type', 'order_id']);
      return { type };
    case 'RECEIPT': {
      const r = keys(value, ['type', 'capture_id', 'amount', 'status', 'transcript_head']);
      return { type, capture_id: str(r.capture_id), amount: wrap(() => readMoney(r.amount)), transcript_head: raw(r.transcript_head, 32) };
    }
    case 'WITHDRAW':
      keys(value, ['type', 'reason']);
      return { type };
    case 'NOTE':
      keys(value, ['type', 'text']);
      return { type };
    default:
      return fail('schema');
  }
}
function readEnvelope(value: unknown): Envelope {
  const r = keys(value, ['v', 'typ', 'deal_id', 'seq', 'prev', 'iss', 'aud', 'iat', 'exp', 'nonce', 'body']);
  return {
    v: int(r.v, 0, 255),
    typ: str(r.typ),
    deal_id: str(r.deal_id),
    seq: int(r.seq, 0, 2 ** 32 - 1),
    prev: raw(r.prev, 32),
    iss: str(r.iss),
    aud: str(r.aud),
    iat: int(r.iat),
    exp: int(r.exp),
    nonce: raw(r.nonce, 16),
    body: readBody(r.body),
  };
}

/** A message's signed body, read without judging its signature (the transcript check owns that);
 *  null when it is not a message at all. */
export function signedBody(jws: string): Envelope | null {
  const payload = jws.split('.')[1];
  const bytes = payload === undefined ? null : fromBase64Url(payload);
  if (!bytes) return null;
  try {
    return readEnvelope(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

export interface VerifyContext {
  deal_id: string;
  audience: string;
  nextSenderSeq: number;
  previous: Bytes;
  now: number;
  nonces: ReadonlySet<string>;
}
export interface Verified {
  envelope: Envelope;
  hash: Bytes;
}

const ownerAcceptBytes = (a: OwnerAccept): Uint8Array =>
  canonicalBytes(['table.owner.accept.v1', a.deal_id, a.offer_seq, Array.from(a.terms_hash), Array.from(a.counter_hash), Array.from(a.owner_key)]);
async function ownerAcceptHolds(a: OwnerAccept): Promise<boolean> {
  return verifyStrict(a.owner_key, ownerAcceptBytes(a), a.signature);
}

/** The wallet's `verify`: shape, signature, binding, lifetime, sequence, chain and nonce. */
export async function verifyEnvelope(jws: string, sender: Bytes, context: VerifyContext): Promise<Verified> {
  if (jws.length === 0 || jws.length > MAX_JWS_BYTES || !/^[\x00-\x7f]*$/.test(jws)) fail('shape');
  const parts = jws.split('.');
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) fail('shape');
  const [p0, p1, p2] = parts as [string, string, string];
  const protectedBytes = fromBase64Url(p0) ?? fail('shape');
  const payloadBytes = fromBase64Url(p1) ?? fail('shape');
  const signature = fromBase64Url(p2) ?? fail('shape');
  let headerJson: unknown;
  let payloadJson: unknown;
  try {
    headerJson = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(protectedBytes));
    payloadJson = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes));
  } catch {
    return fail('schema');
  }
  const header = keys(headerJson, ['alg', 'kid']);
  str(header.alg);
  str(header.kid);
  const envelope = readEnvelope(payloadJson);
  if (!same(protectedBytes, utf8(canonical(headerJson))) || !same(payloadBytes, utf8(canonical(payloadJson)))) fail('schema');
  if (header.alg !== 'EdDSA') fail('signature');
  if (!(await verifyStrict(sender, utf8(`${p0}.${p1}`), signature))) fail('signature');
  const senderId = toHex(await sha256(sender));
  if (envelope.v !== 1 || header.kid !== envelope.iss || envelope.iss !== senderId || envelope.aud !== context.audience || envelope.deal_id !== context.deal_id) fail('binding');
  if (envelope.typ !== envelope.body.type) fail('body');
  const ttl = envelope.exp - envelope.iat;
  const maxTtl = envelope.typ === 'OFFER' || envelope.typ === 'COUNTER' ? 600 : 86400;
  if (envelope.iat < 0 || envelope.exp > MAX_SAFE || envelope.iat > context.now || envelope.exp <= context.now || ttl <= 0 || ttl > maxTtl) fail('time');
  if (envelope.seq === 0 || envelope.seq !== context.nextSenderSeq) fail('sequence');
  if (!same(envelope.prev, context.previous)) fail('previous');
  if (context.nonces.has(`${envelope.iss}:${toHex(envelope.nonce)}`)) fail('nonce');
  await validateBody(envelope.body, sender);
  const body = envelope.body;
  if (body.type === 'ACCEPT' && body.owner_accept) {
    const proof = body.owner_accept;
    if (proof.deal_id !== envelope.deal_id || proof.offer_seq !== body.offer_seq || !same(proof.terms_hash, body.terms_hash)) fail('binding');
    if (!(await ownerAcceptHolds(proof))) fail('signature');
  }
  return { envelope, hash: await sha256(utf8(jws)) };
}

async function validateBody(body: Body, sender: Bytes): Promise<void> {
  switch (body.type) {
    case 'HELLO':
      if (!same(body.agent_key, sender)) fail('body');
      if (!(await verifyStrict(body.owner_key, body.mandate_commitment, body.owner_sig_over_commitment))) fail('signature');
      break;
    case 'LISTING':
    case 'OFFER':
    case 'COUNTER':
      if (body.delivery.type === 'ship_then_capture' && (body.delivery.days === 0 || body.delivery.days > 3)) fail('body');
      break;
    case 'ACCEPT':
      if (body.offer_seq === 0) fail('body');
      break;
    case 'SETTLE':
      if (body.attempt < 1 || body.attempt > 3) fail('body');
      break;
    default:
  }
}

export { ZERO32 };

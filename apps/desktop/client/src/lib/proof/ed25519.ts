// Ed25519 verification through the browser's own WebCrypto, held to the same strictness as the
// wallet's verifier (`verify_strict` in ed25519-dalek): a malleated signature (S not below the group
// order) and a public key or signature point of small order are refused, which WebCrypto alone
// would let through. The arithmetic here only decodes points and multiplies by eight; the signature
// itself is checked by the browser.
import { type Bytes } from './bytes';

const P = 2n ** 255n - 19n;
const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const mod = (a: bigint): bigint => ((a % P) + P) % P;
function power(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let b = mod(base);
  for (let e = exponent; e > 0n; e >>= 1n) {
    if (e & 1n) result = mod(result * b);
    b = mod(b * b);
  }
  return result;
}
const invert = (a: bigint): bigint => power(a, P - 2n);
const D = mod(-121665n * invert(121666n));
const SQRT_M1 = power(2n, (P - 1n) / 4n);

type Point = readonly [bigint, bigint];
const littleEndian = (bytes: Bytes): bigint => {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i] ?? 0);
  return n;
};

/** The curve point a 32-byte encoding names, or null when it names none. */
function decompress(bytes: Bytes): Point | null {
  if (bytes.length !== 32) return null;
  const sign = (bytes[31] ?? 0) >> 7;
  const copy = Uint8Array.from(bytes);
  copy[31] = (copy[31] ?? 0) & 0x7f;
  const y = mod(littleEndian(copy));
  const u = mod(y * y - 1n);
  const v = mod(D * y * y + 1n);
  let x = mod(u * power(v, 3n) * power(u * power(v, 7n), (P - 5n) / 8n));
  const check = mod(v * x * x);
  if (check === mod(-u)) x = mod(x * SQRT_M1);
  else if (check !== u) return null;
  if (Number(x & 1n) !== sign) x = mod(-x);
  return [x, y];
}
function add(a: Point, b: Point): Point {
  const k = mod(D * a[0] * b[0] * a[1] * b[1]);
  return [
    mod((a[0] * b[1] + b[0] * a[1]) * invert(1n + k)),
    mod((a[1] * b[1] + a[0] * b[0]) * invert(1n - k)),
  ];
}
/** True for the eight points whose order divides eight (the identity among them). */
function smallOrder(point: Point): boolean {
  let p = point;
  for (let i = 0; i < 3; i++) p = add(p, p);
  return p[0] === 0n && p[1] === 1n;
}

/** Whether 32 bytes are a public key the wallet would accept: a point on the curve. */
export function isPublicKey(key: Bytes): boolean {
  return decompress(key) !== null;
}

async function browserVerify(key: Bytes, message: Bytes, signature: Bytes): Promise<boolean> {
  try {
    const imported = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, imported, signature as BufferSource, message as BufferSource);
  } catch {
    return false;
  }
}

/** `verify_strict`: true only for a canonical signature, by a key and with a nonce point that are not
 *  of small order, that the browser's Ed25519 accepts. */
export async function verifyStrict(key: Bytes, message: Bytes, signature: Bytes): Promise<boolean> {
  if (key.length !== 32 || signature.length !== 64) return false;
  if (littleEndian(signature.subarray(32)) >= L) return false;
  const a = decompress(key);
  const r = decompress(signature.subarray(0, 32));
  if (!a || !r || smallOrder(a) || smallOrder(r)) return false;
  return browserVerify(key, message, signature);
}

// RFC 8032, section 7.1, test 1: a known signature over the empty message.
const KEY = '\xd7\x5a\x98\x01\x82\xb1\x0a\xb7\xd5\x4b\xfe\xd3\xc9\x64\x07\x3a\x0e\xe1\x72\xf3\xda\xa6\x23\x25\xaf\x02\x1a\x68\xf7\x07\x51\x1a';
const SIGNATURE =
  'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b';
let supported: Promise<boolean> | null = null;
/** Whether this browser verifies Ed25519 correctly: it accepts a known signature and refuses the
 *  same signature with one bit changed. Older browsers lack Ed25519 and the checker then says so
 *  instead of guessing. */
export function ed25519Works(): Promise<boolean> {
  supported ??= (async () => {
    try {
      const key = Uint8Array.from(KEY, (c) => c.charCodeAt(0));
      const signature = Uint8Array.from(SIGNATURE.match(/../g) ?? [], (h) => parseInt(h, 16));
      const bad = Uint8Array.from(signature);
      bad[0] = (bad[0] ?? 0) ^ 1;
      const nothing = new Uint8Array(0);
      return (await browserVerify(key, nothing, signature)) && !(await browserVerify(key, nothing, bad));
    } catch {
      return false;
    }
  })();
  return supported;
}

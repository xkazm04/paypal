// Bytes, hex, base64url and SHA-256 for the proof checker. Everything here runs on what the browser
// already has (TextEncoder and WebCrypto): no dependency, no WASM.
export type Bytes = Uint8Array;

const encoder = new TextEncoder();
export const utf8 = (text: string): Bytes => encoder.encode(text);

export function toHex(bytes: Bytes): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** A JSON array of integers 0..255 (how the wallet writes a key, a hash or a signature) as bytes;
 *  null when it is anything else, or not `length` long. */
export function byteArray(value: unknown, length?: number): Bytes | null {
  if (!Array.isArray(value) || (length !== undefined && value.length !== length)) return null;
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const n: unknown = value[i];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 255) return null;
    out[i] = n;
  }
  return out;
}

const URL_SAFE = /^[A-Za-z0-9_-]*$/;
/** Unpadded base64url, strictly: no padding, no other characters, no stray trailing bits. */
export function fromBase64Url(text: string): Bytes | null {
  if (!URL_SAFE.test(text) || text.length % 4 === 1) return null;
  const standard = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, '='));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return toBase64Url(out) === text ? out : null;
}
export function toBase64Url(bytes: Bytes): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function same(a: Bytes, b: Bytes): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function sha256(...parts: Bytes[]): Promise<Bytes> {
  const whole = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    whole.set(p, at);
    at += p.length;
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', whole));
}

export const ZERO32: Bytes = new Uint8Array(32);

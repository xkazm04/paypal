// A proof file as text a person can read and change. The wallet writes every key, hash and signature
// as a JSON array of byte values, one number to a line, which makes a screen of nothing but digits.
// Here such an array reads as one hex string ("hex:6a75…") and goes back to bytes when the text is
// read again. Nothing else is changed, so the file the checker reads is the file the wallet wrote.
import { toHex } from './bytes';
import type { Json } from './jcs';

const HEX = /^hex:((?:[0-9a-f]{2})+)$/;
const isBytes = (v: unknown): v is number[] => Array.isArray(v) && v.length >= 8 && v.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255);

/** The file as the editor shows it. */
export function toView(document: unknown): string {
  return JSON.stringify(document, (_key, value: unknown) => (isBytes(value) ? `hex:${toHex(Uint8Array.from(value))}` : value), 2);
}
/** Text from the editor back to the file's JSON; throws a SyntaxError when it is not JSON. */
export function fromView(text: string): Json {
  return JSON.parse(text, (_key, value: unknown) => {
    const hex = typeof value === 'string' ? HEX.exec(value)?.[1] : undefined;
    return hex ? (hex.match(/../g) ?? []).map((h) => parseInt(h, 16)) : value;
  }) as Json;
}
/** The file as the wallet writes it (what "Save this file" saves). */
export const toFile = (document: unknown): string => JSON.stringify(document, null, 2);

/** Where to put the cursor in the editor's text for each thing a person might change. */
export type Place = 'price' | 'payee' | 'paypal' | 'line' | 'signature';
export function placesIn(view: string): Record<Place, [number, number] | null> {
  const at = (pattern: RegExp, group = 1): [number, number] | null => {
    const m = pattern.exec(view);
    if (!m || m.index === undefined) return null;
    const text = m[group] ?? '';
    const start = m.index + m[0].lastIndexOf(text);
    return [start, start + text.length];
  };
  // The third message's signature: its first character is the one the tamper changes.
  let signature: [number, number] | null = null;
  const raws = [...view.matchAll(/"raw":\s*"([^"]+)"/g)];
  const third = raws[2];
  if (third?.index !== undefined) {
    const jws = third[1] ?? '';
    const start = third.index + third[0].lastIndexOf(jws) + jws.lastIndexOf('.') + 1;
    signature = [start, start + 8];
  }
  return {
    price: at(/"unit_price":\s*\{\s*"minor":\s*(\d+)/),
    payee: at(/"payee":\s*"([^"]*)"/),
    paypal: at(/"binding":\s*\{\s*"purchase_units":\s*\[\s*\{\s*"amount":\s*\{\s*"currency_code":\s*"[A-Z]+",\s*"value":\s*"([\d.]+)"/),
    line: at(/due_at\\":(\d+)/),
    signature,
  };
}

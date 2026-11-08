// spark abstract-first-home round 4: the shape check of a pasted PayPal sandbox key, before
// Save is offered. It is the wallet's own rule (table-runtime configuration.rs credentials(): trimmed,
// not empty, at most 1024 characters, no control character) plus what every PayPal REST key looks
// like (base64url letters, digits, - and _, tens of characters). Shape only: the wallet checks again.
import { KEY_PROBLEM } from './words';

export const KEY_MIN = 20;
export const KEY_MAX = 1024;

/** What a pasted value becomes: surrounding spaces and line breaks dropped (the wallet trims too). */
export const cleanKey = (v: string): string => v.trim();

/** Why this value cannot be a key, or null when it looks like one (or is still empty). */
export function keyProblem(v: string): string | null {
  const t = cleanKey(v);
  if (!t) return null;
  if (/\s/.test(t) || /\p{Cc}/u.test(t)) return KEY_PROBLEM.inner;
  if (t.length > KEY_MAX) return KEY_PROBLEM.long;
  if (!/^[A-Za-z0-9_-]+$/.test(t)) return KEY_PROBLEM.chars;
  if (t.length < KEY_MIN) return KEY_PROBLEM.short;
  return null;
}

/** Both keys look right and differ: Save may be offered. */
export function keysReady(id: string, secret: string): boolean {
  const a = cleanKey(id);
  const b = cleanKey(secret);
  return !!a && !!b && keyProblem(a) === null && keyProblem(b) === null && a !== b;
}

/** The pair's own problem (the same value twice), once both look like keys. */
export function pairProblem(id: string, secret: string): string | null {
  const a = cleanKey(id);
  const b = cleanKey(secret);
  return a && b && a === b ? KEY_PROBLEM.same : null;
}

/** Both keys pasted at once (copied together from PayPal's page): split on the whitespace between
 *  them when there are exactly two key-shaped parts; null otherwise (an ordinary paste). */
export function splitPair(pasted: string): { id: string; secret: string } | null {
  const parts = pasted.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const [id, secret] = parts as [string, string];
  return keyProblem(id) === null && keyProblem(secret) === null && id !== secret ? { id, secret } : null;
}

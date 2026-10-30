// The strict reading of a proof file's JSON, in small pieces shared by the readers (bundle, money,
// market): every field named, no field the wallet does not write. A file that does not read is "not a
// proof file", never a green line.
import { type Bytes, byteArray } from './bytes';

export class Refused extends Error {}
/** The words for a file that is not a proof file (the wallet's own, verbatim). */
export const NOT_A_PROOF = 'This file is not a proof file saved by this wallet, so there is nothing to check.';
export const refuse = (): never => {
  throw new Refused(NOT_A_PROOF);
};

export type Rec = Record<string, unknown>;
export const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export function rec(value: unknown, keys: readonly string[], optional: readonly string[] = []): Rec {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return refuse();
  const object = value as Rec;
  for (const key of keys) if (!(key in object)) return refuse();
  for (const key of Object.keys(object)) if (!keys.includes(key) && !optional.includes(key)) return refuse();
  return object;
}
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : refuse());
export const text = (value: unknown): string => (typeof value === 'string' ? value : refuse());
export const flag = (value: unknown): boolean => (typeof value === 'boolean' ? value : refuse());
export const whole = (value: unknown, min = -MAX_SAFE, max = MAX_SAFE): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : refuse();
export const bytes = (value: unknown, length?: number): Bytes => byteArray(value, length) ?? refuse();
export const maybe = <T>(value: unknown, read: (v: unknown) => T): T | null => (value === undefined || value === null ? null : read(value));
export const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T => (allowed.includes(value as T) ? (value as T) : refuse());
export const ulid = (value: unknown): string => (typeof value === 'string' && /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(value) ? value : refuse());
export const label = (value: unknown): string => (typeof value === 'string' && /^[A-Za-z0-9\-_.:@+]{1,128}$/.test(value) ? value : refuse());

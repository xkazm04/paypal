// RFC 8785 canonical JSON, the bytes the wallet signs and hashes (serde_jcs on the Rust side).
// Keys sort by UTF-16 code unit, numbers print as ECMAScript prints them, strings escape only what
// JSON requires. JavaScript's own `JSON.stringify` does the number and string parts exactly.
import { type Bytes, utf8 } from './bytes';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function canonical(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error('not JSON');
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
      const object = value as Record<string, unknown>;
      return `{${Object.keys(object)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
        .join(',')}}`;
    }
    default:
      throw new Error('not JSON');
  }
}

export const canonicalBytes = (value: unknown): Bytes => utf8(canonical(value));

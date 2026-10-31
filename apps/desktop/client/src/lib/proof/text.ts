// What the wallet's reader (serde_json, reading the file's bytes into typed records) refuses in the
// file's TEXT, before any field is looked at, and that `JSON.parse` lets through because it keeps only
// the last copy of a key, one number for `2` and `2.0`, and any escape it is given:
//   - a key written twice in one object (the Rust reader says "duplicate field"),
//   - a number written with a point, an exponent or as `-0` (it reads that as a float, and the wallet's
//     integers are never floats),
//   - containers nested 128 deep (the reader's own recursion limit).
// The PayPal call's `body` and `binding` are free-form JSON on both sides (floats, repeated keys
// allowed there; the last copy wins in both readers), so the first two rules leave them alone.
// (A lone half of a surrogate pair in an escape is not on the list: the reader takes it as U+FFFD.)
// Assumes `JSON.parse` has already accepted the text, so the syntax is well-formed.

/** serde_json stops at this many open containers (its recursion limit, counted the way it counts). */
const DEPTH = 128;

interface Frame {
  array: boolean;
  /** Keys seen so far; null where repeats are allowed. */
  keys: Set<string> | null;
  /** The key (or, in an array, the index) of the value being read. */
  at: string | number;
  lenient: boolean;
  expectKey: boolean;
}

const SPACE = new Set([' ', '\t', '\n', '\r']);

/** Where the string token that starts at `start` (its opening quote) ends. */
function endOfString(text: string, start: number): number {
  let i = start + 1;
  while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
  return i + 1;
}

/** Whether the wallet's reader would refuse this (already parsed) JSON text for how it is written. */
export function writtenWrong(text: string): boolean {
  const stack: Frame[] = [];
  const top = (): Frame | undefined => stack[stack.length - 1];
  // The value about to start sits where? Free-form if it is a PayPal call's body or binding.
  const lenientHere = (): boolean => {
    const parent = top();
    if (!parent) return false;
    if (parent.lenient) return true;
    return stack.length === 3 && stack[0]!.at === 'paypal_calls' && stack[1]!.array && (stack[2]!.at === 'body' || stack[2]!.at === 'binding');
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (SPACE.has(c)) {
      i += 1;
    } else if (c === '{' || c === '[') {
      const lenient = lenientHere();
      stack.push({ array: c === '[', keys: c === '{' && !lenient ? new Set() : null, at: c === '[' ? 0 : '', lenient, expectKey: c === '{' });
      if (stack.length >= DEPTH) return true;
      i += 1;
    } else if (c === '}' || c === ']') {
      stack.pop();
      i += 1;
    } else if (c === ',') {
      const f = top()!;
      if (f.array) f.at = (f.at as number) + 1;
      else f.expectKey = true;
      i += 1;
    } else if (c === ':') {
      i += 1;
    } else if (c === '"') {
      const end = endOfString(text, i);
      const f = top();
      if (f && !f.array && f.expectKey) {
        const key = JSON.parse(text.slice(i, end)) as string;
        if (f.keys) {
          if (f.keys.has(key)) return true;
          f.keys.add(key);
        }
        f.at = key;
        f.expectKey = false;
      }
      i = end;
    } else {
      // A number, true, false or null: it ends at the next delimiter.
      let end = i;
      while (end < text.length && !SPACE.has(text[end]!) && text[end] !== ',' && text[end] !== '}' && text[end] !== ']') end += 1;
      const token = text.slice(i, end);
      const number = c === '-' || (c >= '0' && c <= '9');
      if (number && (token === '-0' || /[.eE]/.test(token)) && !lenientHere()) return true;
      i = end;
    }
  }
  return false;
}

/** A file's bytes as text the way the wallet reads them: UTF-8 only, and a byte-order mark is not JSON. */
export function proofText(bytes: ArrayBuffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

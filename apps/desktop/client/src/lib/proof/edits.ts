// A few edits to a proof file's JSON: set the value at a JSON pointer, or remove the key or array
// item. The tamper control makes them; the parity test applies the very same ones to the sample
// and compares the report with the wallet's verifier's report for the edited file.
export interface Edit {
  op: 'set' | 'remove';
  /** A JSON pointer (RFC 6901), e.g. `/deal/terms/unit_price/minor`. */
  path: string;
  value?: unknown;
}

const unescape = (part: string): string => part.replace(/~1/g, '/').replace(/~0/g, '~');
type Holder = Record<string, unknown> | unknown[];
const holds = (value: unknown): value is Holder => typeof value === 'object' && value !== null;

/** The value at `path`, or undefined when nothing is there. */
export function readAt(document: unknown, path: string): unknown {
  let at: unknown = document;
  for (const part of path.split('/').slice(1).map(unescape)) {
    if (!holds(at)) return undefined;
    at = (at as Record<string, unknown>)[part];
  }
  return at;
}

/** Applies the edits to `document` in place; throws when a path leads nowhere. */
export function applyEdits(document: unknown, edits: readonly Edit[]): void {
  for (const edit of edits) {
    const at = edit.path.lastIndexOf('/');
    const parent = readAt(document, edit.path.slice(0, at));
    const key = unescape(edit.path.slice(at + 1));
    if (!holds(parent)) throw new Error(`nothing at ${edit.path}`);
    if (Array.isArray(parent)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= parent.length) throw new Error(`no item at ${edit.path}`);
      if (edit.op === 'set') parent[index] = edit.value;
      else parent.splice(index, 1);
    } else if (edit.op === 'set') {
      parent[key] = edit.value;
    } else {
      if (!(key in parent)) throw new Error(`no key at ${edit.path}`);
      delete parent[key];
    }
  }
}

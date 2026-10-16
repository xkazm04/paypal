/** Pure helpers for the inspector: walk the `[data-loc]` ancestor chain and pick the call site. */

export interface LocEntry {
  el: Element;
  /** Copied reference, `src/.../File.tsx:88`. */
  loc: string;
  path: string;
  line: number;
}

/** Reusable internals: skipped by the default copy (the call site wins), reachable with Alt. */
const LIBRARY_PREFIXES = ['src/shared/ui/', 'src/design/', 'src/lib/'];

export function isLibraryPath(path: string): boolean {
  return LIBRARY_PREFIXES.some((p) => path.startsWith(p));
}

export function parseLoc(raw: string): Omit<LocEntry, 'el'> | null {
  const m = /^(.*):(\d+):(\d+)$/.exec(raw);
  if (!m?.[1] || !m[2]) return null;
  return { path: m[1], line: Number(m[2]), loc: `${m[1]}:${m[2]}` };
}

/** Innermost to outermost. */
export function buildChain(start: Element | null): LocEntry[] {
  const out: LocEntry[] = [];
  let el: Element | null = start?.closest('[data-loc]') ?? null;
  while (el) {
    const parsed = parseLoc(el.getAttribute('data-loc') ?? '');
    if (parsed) out.push({ el, ...parsed });
    el = el.parentElement?.closest('[data-loc]') ?? null;
  }
  return out;
}

/** First non-library entry (the call site), else the innermost. */
export function pickDefaultIndex(chain: LocEntry[]): number {
  const i = chain.findIndex((c) => !isLibraryPath(c.path));
  return i === -1 ? 0 : i;
}

export function dedupeChain(chain: LocEntry[]): LocEntry[] {
  return chain.filter((c, i) => i === 0 || c.loc !== chain[i - 1]?.loc);
}

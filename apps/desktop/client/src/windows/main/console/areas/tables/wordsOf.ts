// Test helper for the trade areas' words guards (rebuild WP3a): every string a words object can say,
// its functions called with sample arguments. Imported only by the area tests.
const SAMPLES: readonly unknown[] = [2, 'Dan', '$12.00', 'the item', 'x'];

export function wordsOf(o: unknown, depth = 0): string[] {
  if (depth > 4 || o === null || o === undefined) return [];
  if (typeof o === 'string') return [o];
  if (typeof o === 'function') {
    try {
      return wordsOf((o as (...a: unknown[]) => unknown)(...SAMPLES), depth + 1);
    } catch {
      return [];
    }
  }
  if (Array.isArray(o)) return o.flatMap((x) => wordsOf(x, depth + 1));
  if (typeof o === 'object') return Object.values(o as Record<string, unknown>).flatMap((x) => wordsOf(x, depth + 1));
  return [];
}

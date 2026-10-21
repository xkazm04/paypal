// The wallet's note on a deal (ApprovalSummary.unavailable_reason) reaches this window as Rust's
// own text. Every sentence Rust can put there is enumerated from its source (table-runtime
// service.rs `summary`), not from a hand list, and each must come out of reasonWords in plain
// words: never the wallet's text, never a word of its machinery.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reasonWords } from '../../lib/words';

const SERVICE = resolve(process.cwd(), '../../../crates/table-runtime/src/service.rs');

/** The string literals between `unavailable_reason:` and the next field of the summary. */
function rustReasons(): string[] {
  const src = readFileSync(SERVICE, 'utf8');
  const start = src.indexOf('unavailable_reason:');
  const end = src.indexOf('rescue: self.rescue_view', start);
  if (start < 0 || end < 0) throw new Error('service.rs no longer has the unavailable_reason block this test reads');
  const block = src.slice(start, end).replace(/\/\/.*$/gm, '');
  return [...block.matchAll(/"([^"\\]+)"/g)].map((m) => m[1]!);
}

describe('the wallet note, in plain words', () => {
  it('reads every sentence Rust can send (at least the four known ones)', () => {
    expect(rustReasons().length).toBeGreaterThanOrEqual(4);
  });
  it('words every one of them, and none keeps the wallet’s raw text or names its machinery', () => {
    for (const raw of rustReasons()) {
      const said = reasonWords(raw);
      expect(said, raw).not.toBe(raw);
      expect(said, raw).not.toMatch(/executor|sandbox credentials|replay-only/i);
    }
  });
});

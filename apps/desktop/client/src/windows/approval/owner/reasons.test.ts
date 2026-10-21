// The what-if's words for Rust's refusals (simulation.ts REASON), pinned to the reasons
// MandatePayload::check actually gives (table-core mandate.rs). A reason the table does not know
// falls back to the rule's bare name, so a new reason in Rust fails here instead of reading as
// "Limit per deal" with no why.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { reasonWords, verdictWords } from './simulation';

const MANDATE_RS = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../../crates/table-core/src/mandate.rs');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const RS = stripComments(readFileSync(MANDATE_RS, 'utf8'));

/** The body of `pub fn check(` up to the end of its impl block (the tests module follows it). */
function checkBody(): string {
  const a = RS.indexOf('pub fn check(');
  const b = RS.indexOf('#[cfg(test)]', a);
  if (a < 0 || b < 0) throw new Error('mandate.rs no longer has pub fn check( … #[cfg(test)]');
  return RS.slice(a, b);
}

/** Every literal reason check() refuses with: Refusal::new(<clause>, "<reason>"). */
function checkReasons(): Array<{ clause: number; reason: string }> {
  const out: Array<{ clause: number; reason: string }> = [];
  for (const m of checkBody().matchAll(/Refusal::new\(\s*(\d+)\s*,\s*"([^"]+)"/g)) out.push({ clause: Number(m[1]), reason: m[2]! });
  return out;
}

describe('the what-if words every refusal check() gives', () => {
  it('reads check()’s reasons from mandate.rs', () => {
    // A floor, so a broken parser cannot pass by finding nothing.
    expect(checkReasons().length).toBeGreaterThanOrEqual(15);
  });
  it('has words for each one, beyond the rule’s bare name', () => {
    const bare = checkReasons().filter(({ clause, reason }) => reason !== 'mandate is not active' && verdictWords({ type: 'refuse', clause, reason }) !== 'No rules in force' && reasonWords(reason) === null);
    expect(bare.map((r) => r.reason)).toEqual([]);
  });
});

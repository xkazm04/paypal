// @vitest-environment node
// Files the wallet's own runtime wrote, not files made for this checker: eight proof files taken from the
// Rust test suite's real deals (a deal that has not started, seller and buyer flows, a shop-around group,
// market prices, a lost answer read back, and the house seller's record kept and then found shortened).
// `real.json` is the verifier's word on each, written by `cargo run -p table-client --bin real-proofs`. The
// browser checker must give the same report for every one, line for line and word for word.
import { describe, expect, it } from 'vitest';
import { AUTHORITY_MANIFEST } from '@bindings/authority';
import words from './real/real.json';
import { checkProofText, type ProofReport } from './verify';

const files = import.meta.glob('./real/*.tableproof', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
type Outcome = { report?: ProofReport; refused?: string };
const wallet = words as unknown as Record<string, Outcome>;
const named = Object.entries(files).map(([path, text]) => [path.replace('./real/', ''), text] as const);
const lines = (r: ProofReport) => r.checks.map((c) => [c.id, c.ok, c.checked, c.applies, c.detail]);

describe('files the wallet’s own runtime wrote', () => {
  it('are all here', () => {
    expect(named.map(([name]) => name).sort()).toEqual(Object.keys(wallet).sort());
    expect(named).toHaveLength(8);
  });

  it.each(named)('%s: the same report as the wallet verifier', async (name, text) => {
    const outcome = await checkProofText(text, AUTHORITY_MANIFEST);
    const expected = wallet[name] as Outcome;
    if (expected.refused !== undefined) {
      expect(outcome).toEqual({ refused: expected.refused });
      return;
    }
    if (!('report' in outcome)) throw new Error(outcome.refused);
    expect(lines(outcome.report)).toEqual(lines(expected.report as ProofReport));
    expect(outcome.report).toEqual(expected.report);
  });

  it('read the house seller’s record, in full, and catch a record that got shorter', async () => {
    const kept = await checkProofText(files['./real/house-buyer.tableproof'] as string, AUTHORITY_MANIFEST);
    const short = await checkProofText(files['./real/house-buyer-shorter.tableproof'] as string, AUTHORITY_MANIFEST);
    if (!('report' in kept) || !('report' in short)) throw new Error('refused');
    const line = (r: ProofReport) => r.checks.find((c) => c.id === 'house_record');
    expect(line(kept.report)).toMatchObject({ ok: true, applies: true });
    expect(line(kept.report)?.detail).toMatch(/^36 entries at your receipt; 1 head\(s\), never shorter, one record; signed by the pinned house key$/);
    expect(line(short.report)).toMatchObject({ ok: false, checked: true });
    expect(line(short.report)?.detail).toMatch(/got shorter after your receipt: 36 entries, then 34/);
    expect(short.report.checks.filter((c) => c.applies && c.checked && !c.ok).map((c) => c.id)).toEqual(['house_record']);
  });
});

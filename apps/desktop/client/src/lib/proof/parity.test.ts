// @vitest-environment node
// The browser checker against the wallet's verifier. `parity.json` is written by Rust
// (`cargo run -p table-client --bin sample-proof`): the report `check_proof_file` gives for the
// sample deal, and for twelve tampered copies of it (each a few JSON edits). The checker here must
// give the same report for the same file, line by line, and the same words. If the two ever
// disagree this fails; if Rust's side goes stale a Rust test fails.
import { describe, expect, it } from 'vitest';
import { AUTHORITY_MANIFEST } from '@bindings/authority';
import golden from './sample/golden.tableproof?raw';
import parity from './sample/parity.json';
import { applyEdits, type Edit } from './edits';
import { checkProofText, type ProofReport } from './verify';

type Variant = { name: string; edits: Edit[]; red: string[]; outcome: { report?: ProofReport; refused?: string } };
const wallet = parity as unknown as { golden: ProofReport; variants: Variant[] };

const tampered = (edits: Edit[]): string => {
  const document: unknown = JSON.parse(golden);
  applyEdits(document, edits);
  return JSON.stringify(document, null, 2);
};
const lines = (report: ProofReport) => report.checks.map((c) => [c.id, c.ok, c.checked, c.applies, c.detail]);
const red = (report: ProofReport) => report.checks.filter((c) => c.applies && c.checked && !c.ok).map((c) => c.id);

describe('the sample deal', () => {
  it('gets the wallet verifier\'s report, line for line', async () => {
    const outcome = await checkProofText(golden, AUTHORITY_MANIFEST);
    if (!('report' in outcome)) throw new Error(outcome.refused);
    expect(outcome.report.verified).toBe(true);
    expect(lines(outcome.report)).toEqual(lines(wallet.golden));
    expect(outcome.report).toEqual(wallet.golden);
  });
});

describe('a tampered copy', () => {
  it('covers the edits a person would make', () => {
    expect(wallet.variants.map((v) => v.name)).toEqual(
      ['price', 'audit-line', 'audit-gap', 'signature', 'payee', 'paypal-amount', 'refund', 'receipt', 'rules', 'relabel', 'owner-key', 'not-a-proof'],
    );
  });
  it.each(wallet.variants.map((v) => [v.name, v] as const))('%s: same report as the wallet verifier', async (_name, variant) => {
    const outcome = await checkProofText(tampered(variant.edits), AUTHORITY_MANIFEST);
    if (variant.outcome.refused !== undefined) {
      expect(outcome).toEqual({ refused: variant.outcome.refused });
      return;
    }
    const expected = variant.outcome.report as ProofReport;
    if (!('report' in outcome)) throw new Error(outcome.refused);
    expect(outcome.report.verified).toBe(false);
    expect(red(outcome.report)).toEqual(variant.red);
    expect(lines(outcome.report)).toEqual(lines(expected));
    expect(outcome.report).toEqual(expected);
  });
});

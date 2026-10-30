// @vitest-environment node
// The browser checker against the wallet's verifier. `parity.json` is written by Rust
// (`cargo run -p table-client --bin sample-proof`): the report `check_proof_file` gives for each sample
// deal, and for tampered copies of it (each a few JSON edits). The checker here must give the same
// report for the same file, line by line, and the same words. If the two ever disagree this fails; if
// Rust's side goes stale a Rust test fails.
import { describe, expect, it } from 'vitest';
import { AUTHORITY_MANIFEST } from '@bindings/authority';
import busy from './sample/busy.tableproof?raw';
import buyer from './sample/buyer.tableproof?raw';
import golden from './sample/golden.tableproof?raw';
import parity from './sample/parity.json';
import { applyEdits, type Edit } from './edits';
import { editsFor, type TamperId } from './tamper';
import { checkProofText, type ProofReport } from './verify';

type Variant = { name: string; edits: Edit[]; red: string[]; outcome: { report?: ProofReport; refused?: string } };
type Entry = { golden: ProofReport; variants: Variant[] };
const wallet = (parity as unknown as { samples: Record<string, Entry> }).samples;
const FILES: Record<string, string> = { monitor: golden, busy, buyer };

const tampered = (text: string, edits: Edit[]): string => {
  const document: unknown = JSON.parse(text);
  applyEdits(document, edits);
  return JSON.stringify(document, null, 2);
};
const lines = (report: ProofReport) => report.checks.map((c) => [c.id, c.ok, c.checked, c.applies, c.detail]);
const red = (report: ProofReport) => report.checks.filter((c) => c.applies && c.checked && !c.ok).map((c) => c.id);

describe('the samples', () => {
  it('are the practice deals', () => {
    expect(Object.keys(wallet).sort()).toEqual(['busy', 'buyer', 'monitor']);
  });
});

for (const [name, text] of Object.entries(FILES)) {
  const entry = wallet[name] as Entry;

  describe(`the ${name} deal`, () => {
    it('gets the wallet verifier\'s report, line for line', async () => {
      const outcome = await checkProofText(text, AUTHORITY_MANIFEST);
      if (!('report' in outcome)) throw new Error(outcome.refused);
      expect(outcome.report.verified).toBe(true);
      expect(lines(outcome.report)).toEqual(lines(entry.golden));
      expect(outcome.report).toEqual(entry.golden);
    });

    it.each(entry.variants.filter((v) => v.name !== 'not-a-proof').map((v) => [v.name, v] as const))('tamper %s: the control makes the very edits the wallet tests make', (_name, variant) => {
      expect(editsFor(variant.name as TamperId, JSON.parse(text))).toEqual(variant.edits);
    });

    it.each(entry.variants.map((v) => [v.name, v] as const))('tampered %s: same report as the wallet verifier', async (_name, variant) => {
      const outcome = await checkProofText(tampered(text, variant.edits), AUTHORITY_MANIFEST);
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
}

describe('the tampered copies cover what a person would try', () => {
  it('on the monitor deal', () => {
    expect((wallet.monitor as Entry).variants.map((v) => v.name)).toEqual(
      ['price', 'audit-line', 'audit-gap', 'signature', 'payee', 'paypal-amount', 'refund', 'receipt', 'rules', 'relabel', 'owner-key', 'not-a-proof'],
    );
  });
  it('on the busy deal, the records only it has', () => {
    expect((wallet.busy as Entry).variants.map((v) => v.name)).toEqual(['shield-release', 'market-price', 'group-winner', 'group-agreed', 'request-id']);
  });
  it('on the buyer\'s file of the same sale', () => {
    expect((wallet.buyer as Entry).variants.map((v) => v.name)).toEqual(['price', 'transcript-head']);
  });
  it('and a tamper the file has nothing to break is not offered', () => {
    expect(editsFor('market-price', JSON.parse(golden))).toBeNull();
    expect(editsFor('group-winner', JSON.parse(golden))).toBeNull();
    expect(editsFor('shield-release', JSON.parse(golden))).toBeNull();
    expect(editsFor('payee', JSON.parse(busy))).not.toBeNull();
  });
});

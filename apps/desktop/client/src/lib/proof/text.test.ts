// @vitest-environment node
// What the wallet's reader refuses in a file's TEXT (a key written twice, a number written with a point,
// a BOM, containers nested too deep) and a JSON.parse-based page would not notice. Every expectation here
// was taken by running `table-verify` on the same edit of sample/golden.tableproof: "cannot read" (exit 2)
// is a refusal here, "VERIFIED" / "NOT VERIFIED" is a file that reads.
import { describe, expect, it } from 'vitest';
import { fromView } from './fileText';
import { proofText, writtenWrong } from './text';
import { checkProofText, readProofFile } from './verify';
import golden from './sample/golden.tableproof?raw';
import { NOT_A_PROOF } from './read';
import { quartiles } from './market';

const refused = async (text: string): Promise<boolean> => {
  const outcome = await checkProofText(text);
  return 'refused' in outcome && outcome.refused === NOT_A_PROOF;
};
const verifies = async (text: string): Promise<boolean> => {
  const outcome = await checkProofText(text);
  return 'report' in outcome && outcome.report.verified;
};
const inBody = (extra: string): string => golden.replace('"body": {\n        "id"', `"body": {\n        ${extra}\n        "id"`);

describe('a file the wallet cannot read, however the checker would take it', () => {
  it('the untouched file reads and verifies', async () => {
    expect(writtenWrong(golden)).toBe(false);
    expect(await verifies(golden)).toBe(true);
  });

  it('a key written twice in one object is refused ("duplicate field"), also when spelled with an escape', async () => {
    expect(await refused(golden.replace('"format"', '"format": "table.proof.v2",\n  "format"'))).toBe(true);
    expect(await refused(golden.replace('"format": "table.proof.v2",', '"format": "table.proof.v2",\n  "\\u0066ormat": "table.proof.v2",'))).toBe(true);
  });

  it('a whole number written with a point, an exponent or as -0 is refused ("floating point, expected i64")', async () => {
    expect(await refused(golden.replace(/("exported_at":\s*)(\d+)/, '$1$2.0'))).toBe(true);
    expect(await refused(golden.replace(/("exported_at":\s*)(\d+)/, '$11.7931116e9'))).toBe(true);
    expect(await refused(golden.replace(/("mandate_version":\s*)(\d+)/, '$1-0'))).toBe(true);
  });

  it('a PayPal call\'s body is free-form JSON: repeats and floats there are read, as the wallet reads them', async () => {
    // the last copy of "id" is the file's own, so the same bytes are signed over; a float changes the body (not verified) but reads
    expect(writtenWrong(inBody('"id": "x",'))).toBe(false);
    expect(await verifies(inBody('"id": "x",'))).toBe(true);
    expect(writtenWrong(inBody('"f": 1.5e3,'))).toBe(false);
    expect(await refused(inBody('"f": 1.5e3,'))).toBe(false);
  });

  it('containers nested 128 deep are refused ("recursion limit exceeded"); 127 read', async () => {
    const nested = (k: number): string => inBody(`"n": ${'['.repeat(k)}${']'.repeat(k)},`);
    expect(writtenWrong(nested(123))).toBe(false);
    expect(await refused(nested(123))).toBe(false);
    expect(await refused(nested(124))).toBe(true);
    // far deeper than the reader's limit, and than JSON.parse itself bears: still a refusal, not a crash
    expect(await refused(`${'['.repeat(200_000)}${']'.repeat(200_000)}`)).toBe(true);
  });

  it('a lone half of a surrogate pair reads (as U+FFFD, in the wallet too): not a refusal', () => {
    expect(writtenWrong(inBody('"s": "\\ud800",'))).toBe(false);
  });

  it('the editor takes the same view of what is written', () => {
    expect(() => fromView('{ "a": 1, "a": 2 }')).toThrow(SyntaxError);
    expect(() => fromView('{ "a": 2.0 }')).toThrow(SyntaxError);
    expect(fromView('{ "a": [1, 2], "b": { "a": 3 } }')).toEqual({ a: [1, 2], b: { a: 3 } });
  });
});

describe('a picked file is read as the wallet reads bytes', () => {
  const bytes = (text: string, ...prefix: number[]): ArrayBuffer => Uint8Array.from([...prefix, ...new TextEncoder().encode(text)]).buffer;

  it('a byte-order mark is not JSON, and bytes that are not UTF-8 are not text', async () => {
    expect(proofText(bytes(golden))).toBe(golden);
    // `Blob.text()` would drop the mark and the page would verify what the wallet refuses ("expected value at line 1 column 1")
    const marked = proofText(bytes(golden, 0xef, 0xbb, 0xbf));
    expect(marked?.charCodeAt(0)).toBe(0xfeff);
    expect(await refused(marked ?? '')).toBe(true);
    expect(proofText(Uint8Array.from([0x7b, 0xff, 0x7d]).buffer)).toBeNull();
  });

  it('readProofFile gives the same', async () => {
    expect(await readProofFile(new Blob([golden]))).toBe(golden);
    expect(await readProofFile(new Blob([Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])]))).toBe('﻿{}');
    expect(await readProofFile(new Blob([Uint8Array.from([0xc3, 0x28])]))).toBeNull();
  });
});

describe('market quartiles use whole-number arithmetic, as the wallet does (128-bit)', () => {
  it('a price near 2^53 times three is not rounded by a double', () => {
    const [p25, median, p75] = quartiles([1000, 7000000000001001]) ?? [];
    const exact = (quarter: bigint): number => Number(1000n + (7000000000000001n * quarter) / 4n);
    expect([p25, median, p75]).toEqual([exact(1n), exact(2n), exact(3n)]);
    expect(p75).toBe(5250000000001000);
  });
});

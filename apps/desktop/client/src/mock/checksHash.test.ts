// @vitest-environment node
// The preview's checks hash is the wallet's: on the shared fixture (every checklist the wallet's own
// sample proof files record with an owner decision, written by Rust), the mock's synchronous hash equals
// the hash Rust recorded beside the lines, and equals the checker's asynchronous one.
import { describe, expect, it } from 'vitest';
import { sha256, toHex } from '../lib/proof/bytes';
import { checksHash, readChecklist } from '../lib/proof/checklist';
import busy from '../lib/proof/sample/busy.tableproof?raw';
import buyer from '../lib/proof/sample/buyer.tableproof?raw';
import house from '../lib/proof/sample/d-0205.tableproof?raw';
import golden from '../lib/proof/sample/golden.tableproof?raw';
import { mockChecksHash } from './checks';
import { sha256Sync } from './sha256';

type Row = { action: string; detail_json: string };
const recorded = (text: string) =>
  (JSON.parse(text) as { audit: Row[] }).audit
    .filter((r) => r.action === 'owner.decision')
    .map((r) => JSON.parse(r.detail_json) as { checks?: unknown; checks_hash: number[] });

describe('the mock checks hash', () => {
  const rows = [golden, busy, buyer, house].flatMap(recorded).filter((d) => d.checks !== undefined);

  it('is the hash Rust recorded with each checklist', async () => {
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const d of rows) {
      const lines = readChecklist(d.checks);
      if (lines === null) throw new Error('a recorded checklist does not read');
      expect(mockChecksHash(lines)).toEqual(d.checks_hash);
      expect(Array.from(await checksHash(lines))).toEqual(d.checks_hash);
    }
  });

  it('runs the same SHA-256 as the platform', async () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 31 + n) & 0xff);
      expect(toHex(sha256Sync(data))).toBe(toHex(await sha256(data)));
    }
    expect(toHex(sha256Sync(new TextEncoder().encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

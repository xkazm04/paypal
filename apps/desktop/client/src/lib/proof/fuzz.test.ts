// @vitest-environment node
// Adversarial edits: 220 random edits (a number nudged, a key deleted, a byte flipped, a list swapped, an
// extra key, a wrong kind of value, a broken signature) to the practice deals and to the files the wallet's
// own runtime wrote. `fuzz.json` holds, for each, a digest of what the wallet's verifier says about the edited
// file (its report, or why it will not read it): the browser checker must say exactly the same, so no edit,
// however odd, can make it pass what the wallet fails or read what the wallet refuses.
// Regenerate with `scripts/proof-fuzz.mjs` and `cargo run -p table-client --bin fuzz-proofs`.
import { describe, expect, it } from 'vitest';
import { AUTHORITY_MANIFEST } from '@bindings/authority';
import { sha256, toHex } from './bytes';
import { applyEdits, type Edit } from './edits';
import corpus from './fuzz.json';
import { canonicalBytes } from './jcs';
import { checkProofText } from './verify';

const files = import.meta.glob(['./real/*.tableproof', './sample/*.tableproof'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
type Entry = { source: string; edits: Edit[]; digest: string };
const entries = corpus as unknown as Entry[];

describe('adversarial edits to real files', () => {
  it('cover every kind of file, with edits the wallet reads and refuses alike', () => {
    expect(entries).toHaveLength(220);
    expect(new Set(entries.map((e) => e.source)).size).toBeGreaterThanOrEqual(10);
  });

  it('are judged exactly as the wallet’s verifier judges them', { timeout: 300_000 }, async () => {
    const different: string[] = [];
    for (const [index, entry] of entries.entries()) {
      const text = files[`./${entry.source}.tableproof`];
      if (text === undefined) throw new Error(`no file for ${entry.source}`);
      const document: unknown = JSON.parse(text);
      applyEdits(document, entry.edits);
      const outcome = await checkProofText(JSON.stringify(document, null, 2), AUTHORITY_MANIFEST);
      const word = 'report' in outcome ? { report: outcome.report } : { refused: outcome.refused };
      const digest = toHex(await sha256(canonicalBytes(word)));
      if (digest !== entry.digest) different.push(`#${index} ${entry.source}: ${JSON.stringify(entry.edits)}`);
    }
    expect(different).toEqual([]);
  });
});

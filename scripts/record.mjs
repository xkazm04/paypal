#!/usr/bin/env node
// Re-records every fixture the preview draws from one recording, arena, then haggle, then proofs:
//   1. arena   - Break The Table's record and its refused attacks' proof files (reads haggle.json)
//   2. haggle  - the engine's recorded haggles (mock/haggle.json) and the house deal's proof file
//   3. proofs  - the proof checker's parity files and the verifier's word on every recorded file
// The arena replays haggle.json as it stands, so when the haggle step changes that file the arena and
// proofs steps run once more after it. Each step is the recorder's own test with TABLE_RECORD set to its
// name; a step that fails stops the run. A second run changes nothing.
// Usage: node scripts/record.mjs [arena|haggle|proofs ...] (default: all three).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const STEPS = {
  arena: ['test', '-p', 'table-app', '--test', 'gauntlet', 'arena'],
  haggle: ['test', '-p', 'table-runtime', '--lib', 'recorded_haggles'],
  proofs: ['test', '-p', 'table-client', '--lib', 'sample_proof'],
};
const asked = process.argv.slice(2);
const unknown = asked.filter((s) => !(s in STEPS));
if (unknown.length) {
  console.error(`record: unknown recorder ${unknown.join(', ')} (known: ${Object.keys(STEPS).join(', ')})`);
  process.exit(2);
}
const HAGGLE = join(root, 'apps/desktop/client/src/mock/haggle.json');
const digest = () => { try { return createHash('sha256').update(readFileSync(HAGGLE)).digest('hex'); } catch { return null; } };
const record = (name) => {
  console.log(`record: ${name} (TABLE_RECORD=${name} cargo ${STEPS[name].join(' ')})`);
  const run = spawnSync('cargo', STEPS[name], { cwd: root, stdio: 'inherit', env: { ...process.env, TABLE_RECORD: name } });
  if (run.status !== 0) {
    console.error(`record: ${name} failed (${run.error?.message ?? `exit ${run.status}`})`);
    process.exit(run.status || 1);
  }
};
const chosen = Object.keys(STEPS).filter((s) => asked.length === 0 || asked.includes(s));
const before = digest();
for (const name of chosen) record(name);
if (chosen.includes('haggle') && digest() !== before) {
  console.log('record: haggle.json changed; the arena replays it, so arena and proofs run again');
  for (const name of chosen.filter((s) => s !== 'haggle')) record(name);
}
console.log('record: done');

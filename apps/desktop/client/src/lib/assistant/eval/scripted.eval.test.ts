// The scripted arm of the board's view-choice evaluation: every case through the scripted engine,
// scored by the real door. It asserts only that the harness runs and that every scripted reply is
// schema-valid. Choice accuracy is MEASURED and printed, never asserted: the figures go to README.md,
// and no case is tuned to make them better.
import { describe, expect, it } from 'vitest';
import { createScriptedEngine } from '../scripted';
import { runArm } from './arm';
import { CASES } from './cases';
import { formatTable } from './score';

describe('board view-choice eval, scripted arm', () => {
  it('runs every case through the door and prints the figures', async () => {
    const engine = createScriptedEngine();
    const run = await runArm(CASES, async (q, digest) => ({ ok: true, raw: await engine.ask(q, digest) }));

    process.stderr.write(`\n${formatTable(`Board view-choice eval, arm scripted, ${CASES.length} cases`, run.aggregate, run.scores)}\n\n`);

    expect(run.scores).toHaveLength(CASES.length);
    expect(run.aggregate.errors).toBe(0);
    expect(run.aggregate.schema_valid).toEqual({ hit: CASES.length, of: CASES.length });
  });
});

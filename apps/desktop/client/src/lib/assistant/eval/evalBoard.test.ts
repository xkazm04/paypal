// @vitest-environment node
// The live arm's runner (scripts/evalBoard.ts) against the fake CLI the bridge tests use: no network,
// no cost. Proves the call path, the result file and the honest refusals; the real run is
// `pnpm eval:board` (README.md). Vitest only collects src/**, so this lives beside the eval.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, parseArgs, selectCases } from '../../../../scripts/evalBoard';
import { CASES } from './cases';

const fake = fileURLToPath(new URL('../bridge/fakeClaude.mjs', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'board-eval-test-'));
const quiet = (): void => {};

afterEach(() => { delete process.env.FAKE_MODE; });
afterAll(() => { rmSync(scratch, { recursive: true, force: true }); });

describe('eval:board, the live arm runner', () => {
  it('parses its flags and refuses unknown ones', () => {
    expect(parseArgs(['--limit', '3', '--only', 'a,b', '--concurrency', '2', '--out', 'x.json'])).toEqual({ limit: 3, only: ['a', 'b'], concurrency: 2, out: 'x.json' });
    expect(parseArgs(['--limit', '0'])).toEqual({ error: '--limit must be a whole number above 0' });
    expect(parseArgs(['--limit'])).toEqual({ error: '--limit needs a value' });
    expect(parseArgs(['--fast', '1'])).toEqual({ error: 'unknown flag --fast' });
  });

  it('selects cases by id and limit; an unknown id is an error', () => {
    expect(selectCases({})).toHaveLength(CASES.length);
    expect((selectCases({ only: ['money-room-left', 'prose-thanks'] }) as { id: string }[]).map((c) => c.id)).toEqual(['money-room-left', 'prose-thanks']);
    expect(selectCases({ limit: 2 })).toHaveLength(2);
    expect(selectCases({ only: ['nope'] })).toEqual({ error: 'unknown case ids: nope' });
  });

  it('says exactly why it cannot run when there is no CLI', async () => {
    const r = await main({ env: { CLAUDE_BIN: join(scratch, 'missing-claude.exe') }, log: quiet });
    expect(r).toEqual({ ok: false, reason: 'no claude CLI found: set CLAUDE_BIN, or put claude on PATH or in ~/.local/bin' });
  });

  it('runs the chosen cases through the bridge call path, scores them and writes the result outside the repo', async () => {
    const out = join(scratch, 'run.json');
    let printed = '';
    const r = await main({ env: { CLAUDE_BIN: fake }, only: ['prose-thanks', 'money-room-left'], concurrency: 2, out, log: (t) => { printed += t; } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.out).toBe(out);
    expect(r.cost_usd).toBe(0.02);
    const saved = JSON.parse(readFileSync(out, 'utf8')) as { arm: string; aggregate: { n: number; schema_valid: unknown; pass: unknown }; cases: { id: string; outcome: { ok: boolean } }[] };
    expect(saved.arm).toBe('claude-code');
    expect(saved.cases.map((c) => c.id)).toEqual(['money-room-left', 'prose-thanks']); // the set's order, not the flag's
    expect(saved.cases.every((c) => c.outcome.ok)).toBe(true);
    // The fake answers {say:'hi', ops:[]}: valid, right for the prose case, a miss for the money one.
    expect(saved.aggregate).toMatchObject({ n: 2, schema_valid: { hit: 2, of: 2 }, pass: { hit: 1, of: 2 } });
    expect(printed).toContain('schema-valid        2/2  100.0%');
    expect(printed).toContain('money-room-left: missed money');
  }, 60_000);

  it('writes nothing and says so when every call fails', async () => {
    process.env.FAKE_MODE = 'crash';
    const out = join(scratch, 'failed.json');
    const r = await main({ env: { CLAUDE_BIN: fake }, only: ['prose-thanks'], out, log: quiet });
    expect(r).toEqual({ ok: false, reason: 'every call failed (bad_output 1); nothing was scored and no result was written' });
    expect(existsSync(out)).toBe(false);
  }, 60_000);
});

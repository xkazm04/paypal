// The live arm of the board's view-choice evaluation: every case of src/lib/assistant/eval/cases.ts
// asked of the real model through the dev bridge's own call path (runClaude in assistantBridge.ts:
// the same argv, prompt, schema, budget cap per call, timeout and stripped environment), scored by
// the same door and scorer as the scripted arm. Writes a results JSON OUTSIDE the repository (the
// OS temp folder unless --out is given; results are never committed) and prints the same table.
//
// Run: `pnpm eval:board [--limit N] [--only id,id] [--concurrency N] [--out file]`
// (scripts/eval-board.mjs loads this file under Vite's module runner; plain Node cannot resolve the
// extensionless imports of the client sources). Needs the `claude` CLI and the owner's login; costs
// real usage, at most the bridge's per-call budget times the number of cases.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runArm } from '../src/lib/assistant/eval/arm';
import { CASES, type EvalCase } from '../src/lib/assistant/eval/cases';
import { formatTable, type Outcome } from '../src/lib/assistant/eval/score';
import { resolveClaudeBin, runClaude } from './assistantBridge';

export type EvalBoardOptions = {
  limit?: number;
  only?: string[];
  concurrency?: number;
  out?: string;
  env?: NodeJS.ProcessEnv;
  log?: (text: string) => void;
};

export type EvalBoardResult =
  | { ok: true; out: string; table: string; cost_usd: number | null }
  | { ok: false; reason: string };

/** `--limit N`, `--only a,b`, `--concurrency N`, `--out file`. Unknown flags are an error. */
export function parseArgs(argv: readonly string[]): EvalBoardOptions | { error: string } {
  const o: EvalBoardOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return { error: `${flag} needs a value` };
    if (flag === '--limit' || flag === '--concurrency') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) return { error: `${flag} must be a whole number above 0` };
      if (flag === '--limit') o.limit = n; else o.concurrency = n;
    } else if (flag === '--only') o.only = value.split(',').map((s) => s.trim()).filter(Boolean);
    else if (flag === '--out') o.out = value;
    else return { error: `unknown flag ${flag}` };
    i++;
  }
  return o;
}

/** The cases a run asks: --only picks by id (unknown ids are an error), --limit keeps the first N. */
export function selectCases(opts: EvalBoardOptions): EvalCase[] | { error: string } {
  let cases = [...CASES];
  if (opts.only?.length) {
    const unknown = opts.only.filter((id) => !CASES.some((c) => c.id === id));
    if (unknown.length) return { error: `unknown case ids: ${unknown.join(', ')}` };
    cases = cases.filter((c) => opts.only?.includes(c.id));
  }
  if (opts.limit) cases = cases.slice(0, opts.limit);
  return cases;
}

function cliVersion(bin: string): string | null {
  try {
    const script = /\.m?js$/i.test(bin);
    const r = spawnSync(script ? process.execPath : bin, script ? [bin, '--version'] : ['--version'], { input: '', timeout: 15_000, windowsHide: true, encoding: 'utf8' });
    const line = (r.stdout ?? '').trim().split(/\r?\n/)[0] ?? '';
    return line ? line.slice(0, 80) : null;
  } catch {
    return null;
  }
}

export async function main(opts: EvalBoardOptions = {}): Promise<EvalBoardResult> {
  const log = opts.log ?? ((t: string) => process.stdout.write(t));
  const env = opts.env ?? process.env;
  const cases = selectCases(opts);
  if ('error' in cases) return { ok: false, reason: cases.error };
  const bin = resolveClaudeBin(env);
  if (!bin) return { ok: false, reason: 'no claude CLI found: set CLAUDE_BIN, or put claude on PATH or in ~/.local/bin' };

  const version = cliVersion(bin);
  const started = new Date();
  const concurrency = opts.concurrency ?? 1;
  log(`board eval, live arm: ${cases.length} cases, CLI ${version ?? 'version unknown'}, concurrency ${concurrency}\n`);

  const run = await runArm(cases, async (question, digest): Promise<Outcome> => {
    const t0 = Date.now();
    const r = await runClaude(question, digest, bin);
    return r.ok ? { ok: true, raw: r.reply, ms: r.ms, cost_usd: r.costUsd } : { ok: false, error: r.reason, ms: Date.now() - t0 };
  }, {
    concurrency,
    onCase: (c, s, done) => log(`  ${String(done).padStart(2)}/${cases.length} ${s.pass ? 'pass' : 'FAIL'} ${c.id}${s.error ? ` (${s.error})` : ''}\n`),
  });

  const failures = run.outcomes.filter((o) => !o.ok);
  if (failures.length === run.outcomes.length) {
    const tally = new Map<string, number>();
    for (const f of failures) if (!f.ok) tally.set(f.error, (tally.get(f.error) ?? 0) + 1);
    return { ok: false, reason: `every call failed (${[...tally].map(([k, n]) => `${k} ${n}`).join(', ')}); nothing was scored and no result was written` };
  }

  const costs = run.outcomes.flatMap((o) => (o.ok && typeof o.cost_usd === 'number' ? [o.cost_usd] : []));
  const cost_usd = costs.length ? Math.round(costs.reduce((a, b) => a + b, 0) * 10_000) / 10_000 : null;
  const model = env.ASSISTANT_CLAUDE_MODEL || 'the CLI default';
  const title = `Board view-choice eval, arm claude-code (${model}, CLI ${version ?? '?'}), ${started.toISOString().slice(0, 10)}, ${cases.length} cases`;
  const table = formatTable(title, run.aggregate, run.scores);

  const out = opts.out ?? join(tmpdir(), 'board-eval', `claude-code-${started.toISOString().replace(/[:.]/g, '-')}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({
    arm: 'claude-code',
    started: started.toISOString(),
    finished: new Date().toISOString(),
    cli_version: version,
    model,
    concurrency,
    cost_usd,
    aggregate: run.aggregate,
    cases: cases.map((c, i) => ({ id: c.id, question: c.question, board: c.board, expect: c.expect, outcome: run.outcomes[i], score: run.scores[i] })),
  }, null, 2)}\n`);

  log(`\n${table}\n\ncost ${cost_usd === null ? 'not reported' : `$${cost_usd}`}; results: ${out}\n`);
  return { ok: true, out, table, cost_usd };
}

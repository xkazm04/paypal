// `pnpm eval:board`: runs scripts/evalBoard.ts (the live arm of the board view-choice evaluation)
// under Vite's module runner (named apart from evalBoard.ts so an import of `scripts/evalBoard` never
// resolves here: Vite tries .mjs before .ts). The client sources import each other without file extensions, which
// plain Node cannot resolve; Vite (already a dependency) resolves them exactly as the dev server does.
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const { module } = await runnerImport(here('./evalBoard.ts'), {
  root: here('..'),
  logLevel: 'error',
  resolve: { alias: { '@bindings': here('../../../../bindings'), '@': here('../src') } },
});

const opts = module.parseArgs(process.argv.slice(2));
if ('error' in opts) {
  process.stderr.write(`eval:board: ${opts.error}\nusage: pnpm eval:board [--limit N] [--only id,id] [--concurrency N] [--out file]\n`);
  process.exitCode = 2;
} else {
  const r = await module.main(opts);
  if (!r.ok) process.stderr.write(`eval:board did not run: ${r.reason}\n`);
  process.exitCode = r.ok ? 0 : 1;
}

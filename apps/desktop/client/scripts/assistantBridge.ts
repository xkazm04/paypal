// Dev-server bridge from the browser board to the `claude` CLI (headless, one turn, no tools).
// DEV ONLY: registered with `apply: 'serve'` in vite.config.ts, so it is absent from `vite build`.
// The browser mock world cannot reach an LLM; this lets a real model choose panels over the digest.
// Everything the CLI returns is UNTRUSTED: the client validates it (lib/assistant/validate.ts).
//
// A dev server that spawns a process is an attack surface, so: loopback Host + same-origin only,
// JSON only, 256 KB body, one request at a time, 60 s hard timeout (whole process tree killed),
// 64 KB output cap, and no stderr or model text is ever put in an error response.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { BRIDGE_PATH, type BridgeRequest, type BridgeResponse } from '../src/lib/assistant/contract';
import { buildDigest } from '../src/lib/assistant/digest';
import { systemPrompt } from '../src/lib/assistant/prompt';
import { replyJsonSchema } from '../src/lib/assistant/vocabulary';

const MAX_BODY = 256 * 1024;
const MAX_OUTPUT = 64 * 1024;
const MAX_QUESTION = 500;
const DEFAULT_TIMEOUT_MS = 60_000;
const BUDGET_USD = '0.25';

/** Mirrors crates/table-engine/src/argv.rs STRIP_ENV (keep in step), plus anything key-shaped. */
export const STRIP_ENV: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_EFFORT',
];
const SECRET_SHAPE = /(_API_KEY|_AUTH_TOKEN|_SECRET|_SECRET_KEY|_ACCESS_TOKEN)$/i;

export function childEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (STRIP_ENV.includes(k) || SECRET_SHAPE.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/** CLAUDE_BIN, else `claude` on PATH, else ~/.local/bin/claude(.exe). null when none exists. */
export function resolveClaudeBin(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.CLAUDE_BIN;
  if (explicit) return existsSync(explicit) ? explicit : null;
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude'];
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  dirs.push(join(homedir(), '.local', 'bin'));
  for (const d of dirs) for (const n of names) {
    const p = join(d, n);
    if (existsSync(p)) return p;
  }
  return null;
}

export type RunResult =
  | { ok: true; reply: unknown; ms: number; costUsd: number | null }
  | { ok: false; reason: 'unavailable' | 'timeout' | 'bad_output' };

export function claudeArgs(): string[] {
  const args = [
    '-p',
    '--output-format', 'json',
    '--tools', '',
    '--no-session-persistence',
    '--setting-sources', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--effort', 'low',
    '--max-budget-usd', BUDGET_USD,
    '--system-prompt', systemPrompt(),
    '--json-schema', JSON.stringify(replyJsonSchema()),
  ];
  const model = process.env.ASSISTANT_CLAUDE_MODEL;
  if (model) args.push('--model', model);
  return args;
}

function killTree(pid: number | undefined, fallback: () => void): void {
  if (pid === undefined) return fallback();
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch { /* fall through */ }
    fallback();
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch { fallback(); }
  }
}

/** One non-interactive turn. Prompt goes on stdin (no argv length limit). Never throws. */
export function runClaude(question: string, digest: BridgeRequest['digest'], bin: string, signal?: AbortSignal): Promise<RunResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const timeoutMs = Number(process.env.ASSISTANT_TIMEOUT_MS) > 0 ? Number(process.env.ASSISTANT_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
    let cwd: string;
    try { cwd = mkdtempSync(join(tmpdir(), 'assistant-bridge-')); } catch { return resolve({ ok: false, reason: 'unavailable' }); }

    let done = false;
    const finish = (r: RunResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      try { rmSync(cwd, { recursive: true, force: true }); } catch { /* temp dir, best effort */ }
      resolve(r);
    };

    const args = claudeArgs();
    const script = /\.m?js$/i.test(bin);
    let child;
    try {
      child = spawn(script ? process.execPath : bin, script ? [bin, ...args] : args, {
        cwd,
        env: childEnv(process.env),
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
    } catch {
      return finish({ ok: false, reason: 'unavailable' });
    }

    const kill = () => killTree(child.pid, () => { try { child.kill('SIGKILL'); } catch { /* gone */ } });
    const timer = setTimeout(() => { kill(); finish({ ok: false, reason: 'timeout' }); }, timeoutMs);
    const onAbort = () => { kill(); finish({ ok: false, reason: 'unavailable' }); };
    signal?.addEventListener('abort', onAbort, { once: true });

    let out = '';
    let size = 0;
    child.stdout.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_OUTPUT) { kill(); return finish({ ok: false, reason: 'bad_output' }); }
      out += c.toString('utf8');
    });
    child.on('error', () => finish({ ok: false, reason: 'unavailable' }));
    child.stdin.on('error', () => { /* child exited before reading; close handles it */ });
    child.on('close', (code) => {
      if (done) return;
      if (code !== 0) return finish({ ok: false, reason: 'bad_output' });
      finish(parseEnvelope(out, Date.now() - started));
    });
    child.stdin.end(`${question}\n\n${buildDigest(digest)}\n`);
  });
}

/** The CLI's json envelope: `structured_output` holds the schema-shaped reply. */
export function parseEnvelope(raw: string, ms: number): RunResult {
  try {
    const env = JSON.parse(raw) as Record<string, unknown>;
    if (!env || typeof env !== 'object' || env.is_error === true) return { ok: false, reason: 'bad_output' };
    const reply = env.structured_output;
    if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return { ok: false, reason: 'bad_output' };
    const cost = typeof env.total_cost_usd === 'number' ? env.total_cost_usd : null;
    return { ok: true, reply, ms, costUsd: cost };
  } catch {
    return { ok: false, reason: 'bad_output' };
  }
}

function isRequest(b: unknown): b is BridgeRequest {
  if (!b || typeof b !== 'object') return false;
  const r = b as Record<string, unknown>;
  if (typeof r.question !== 'string' || r.question.trim() === '' || r.question.length > MAX_QUESTION) return false;
  const d = r.digest as Record<string, unknown> | null;
  return !!d && typeof d === 'object' && typeof d.now_ms === 'number' && Array.isArray(d.deals);
}

function send(res: ServerResponse, status: number, body: BridgeResponse | { ok: boolean; reason?: string }): void {
  if (res.headersSent) return;
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string | 'too_big'> {
  return new Promise((resolve) => {
    const declared = Number(req.headers['content-length']);
    if (declared > MAX_BODY) return resolve('too_big');
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { resolve('too_big'); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve('too_big'));
  });
}

type Next = (err?: unknown) => void;
export type BridgeOptions = { getPort: () => number | null };

/** Connect-style middleware; `getPort` is the port the server actually listens on. */
export function createBridgeMiddleware(opts: BridgeOptions) {
  let busy = false;
  let lookup: { at: number; bin: string | null } | null = null;
  const bin = (): string | null => {
    if (!lookup || Date.now() - lookup.at > 30_000) lookup = { at: Date.now(), bin: resolveClaudeBin() };
    return lookup.bin;
  };

  const hostOk = (req: IncomingMessage): boolean => {
    const port = opts.getPort();
    const host = String(req.headers.host ?? '').toLowerCase();
    if (port === null || !(host === `localhost:${port}` || host === `127.0.0.1:${port}`)) return false;
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    try { return new URL(String(origin)).host.toLowerCase() === host; } catch { return false; }
  };

  return async (req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== BRIDGE_PATH) return next();
    if (!hostOk(req)) return send(res, 403, { ok: false, reason: 'bad_request' });

    if (req.method === 'GET') {
      if (url.searchParams.get('probe') !== '1') return send(res, 400, { ok: false, reason: 'bad_request' });
      return bin() ? send(res, 200, { ok: true }) : send(res, 200, { ok: false, reason: 'unavailable' });
    }
    if (req.method !== 'POST') return send(res, 405, { ok: false, reason: 'bad_request' });
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      return send(res, 415, { ok: false, reason: 'bad_request' });
    }
    if (busy) return send(res, 429, { ok: false, reason: 'busy' });
    busy = true;
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ac.abort(); });
    try {
      const raw = await readBody(req);
      if (raw === 'too_big') return send(res, 413, { ok: false, reason: 'bad_request' });
      let body: unknown;
      try { body = JSON.parse(raw); } catch { return send(res, 400, { ok: false, reason: 'bad_request' }); }
      if (!isRequest(body)) return send(res, 400, { ok: false, reason: 'bad_request' });
      const b = bin();
      if (!b) return send(res, 200, { ok: false, reason: 'unavailable' });
      const r = await runClaude(body.question, body.digest, b, ac.signal);
      send(res, 200, r.ok ? { ok: true, engine: 'claude-code', ms: r.ms, reply: r.reply } : { ok: false, reason: r.reason });
    } finally {
      busy = false;
    }
  };
}

export function assistantBridge(): Plugin {
  return {
    name: 'assistant-bridge',
    apply: 'serve',
    configureServer(server) {
      const mw = createBridgeMiddleware({
        getPort: () => {
          const a = server.httpServer?.address();
          return a && typeof a === 'object' ? a.port : null;
        },
      });
      server.middlewares.use((req, res, next) => { void mw(req, res, next); });
    },
  };
}

// @vitest-environment node
// Dev bridge to the claude CLI: all cases run against a fake CLI (fakeClaude.mjs), no network.
// Vitest only collects src/**, so this lives beside the assistant lib, not under scripts/.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assistantBridge, createBridgeMiddleware, STRIP_ENV, childEnv, parseEnvelope } from '../../../../scripts/assistantBridge';
import { BRIDGE_PATH, type BridgeRequest } from '../contract';

const fake = fileURLToPath(new URL('./fakeClaude.mjs', import.meta.url));
const repoRoot = resolve(fileURLToPath(new URL('../../../../../../..', import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), 'bridge-test-'));
const logFile = join(scratch, 'log.json');

const digest: BridgeRequest['digest'] = {
  now_ms: 1, first_run: false, deals: [],
  money: { room_left_minor: null, day_cap_minor: null, held_minor: null, paid_today_minor: null, deals_today: null, deals_cap: null, currency: null },
  rules_in_force: null, setup: [],
};
const good: BridgeRequest = { question: 'What needs me?', digest };

let server: Server;
let port = 0;
beforeAll(async () => {
  process.env.CLAUDE_BIN = fake;
  const mw = createBridgeMiddleware({ getPort: () => port });
  server = createServer((req, res) => { void mw(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(scratch, { recursive: true, force: true });
});
afterEach(() => {
  delete process.env.FAKE_MODE;
  delete process.env.FAKE_LOG;
  delete process.env.ASSISTANT_TIMEOUT_MS;
  process.env.CLAUDE_BIN = fake;
});

type Raw = { status: number; body: unknown };
function raw(opts: { method?: string; path?: string; port?: number; headers?: Record<string, string>; body?: string }): Promise<Raw> {
  return new Promise((res, rej) => {
    const r = httpRequest({ host: '127.0.0.1', port: opts.port ?? port, method: opts.method ?? 'POST', path: opts.path ?? BRIDGE_PATH, headers: opts.headers }, (m) => {
      let t = '';
      m.on('data', (c) => { t += c; });
      m.on('end', () => { try { res({ status: m.statusCode ?? 0, body: t ? JSON.parse(t) : null }); } catch { res({ status: m.statusCode ?? 0, body: t }); } });
    });
    r.on('error', rej);
    r.end(opts.body);
  });
}
const post = (b: unknown = good, headers: Record<string, string> = {}) =>
  raw({ headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(b) });

/** A second bridge whose binary lookup cache is fresh (the first one has cached the fake). */
async function withFreshBridge<T>(fn: (p: number, hostPort: number) => Promise<T>): Promise<T> {
  const mw = createBridgeMiddleware({ getPort: () => port });
  const s2 = createServer((req, res) => { void mw(req, res, () => undefined); });
  await new Promise<void>((r) => s2.listen(0, '127.0.0.1', r));
  try {
    return await fn((s2.address() as AddressInfo).port, port);
  } finally {
    await new Promise<void>((r) => s2.close(() => r()));
  }
}

describe('assistant bridge, fake CLI', () => {
  it('returns the structured reply of an ok envelope', async () => {
    process.env.FAKE_MODE = 'ok';
    const r = await post();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, engine: 'claude-code', reply: { v: 1, say: 'hi', ops: [] } });
    expect(typeof (r.body as { ms: number }).ms).toBe('number');
  });

  it('bad JSON, missing structured output, error envelope and crash are bad_output, without stderr or text', async () => {
    for (const mode of ['bad_json', 'no_structured', 'error_envelope', 'crash']) {
      process.env.FAKE_MODE = mode;
      const r = await post();
      expect(r.body, mode).toEqual({ ok: false, reason: 'bad_output' });
      expect(JSON.stringify(r.body)).not.toMatch(/secret|text only/);
    }
  });

  it('output over 64 KB is bad_output', async () => {
    process.env.FAKE_MODE = 'huge';
    expect((await post()).body).toEqual({ ok: false, reason: 'bad_output' });
  });

  it('a slow CLI hits the timeout and is killed', async () => {
    process.env.FAKE_MODE = 'slow';
    process.env.ASSISTANT_TIMEOUT_MS = '700';
    const t = Date.now();
    expect((await post()).body).toEqual({ ok: false, reason: 'timeout' });
    expect(Date.now() - t).toBeLessThan(10_000);
  });

  it('a second request while one is in flight is busy', async () => {
    process.env.FAKE_MODE = 'medium';
    const first = post();
    await new Promise((r) => setTimeout(r, 150));
    const second = await post();
    expect(second.body).toEqual({ ok: false, reason: 'busy' });
    expect((await first).body).toMatchObject({ ok: true });
    process.env.FAKE_MODE = 'ok';
    expect((await post()).body).toMatchObject({ ok: true });
  });

  it('refuses a wrong Host (DNS rebinding) and a foreign Origin', async () => {
    process.env.FAKE_MODE = 'ok';
    expect((await post(good, { host: 'evil.example:' + port })).status).toBe(403);
    expect((await post(good, { host: '127.0.0.1:1' })).status).toBe(403);
    expect((await post(good, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await post(good, { origin: `http://127.0.0.1:${port}` })).status).toBe(200);
    expect((await raw({ method: 'GET', path: BRIDGE_PATH + '?probe=1', headers: { host: 'evil.example' } })).status).toBe(403);
  });

  it('refuses a non-JSON content type', async () => {
    const r = await raw({ headers: { 'content-type': 'text/plain' }, body: JSON.stringify(good) });
    expect(r.status).toBe(415);
    expect(r.body).toEqual({ ok: false, reason: 'bad_request' });
  });

  it('refuses an oversized body', async () => {
    const r = await post({ ...good, pad: 'x'.repeat(300 * 1024) });
    expect(r.status).toBe(413);
    expect(r.body).toEqual({ ok: false, reason: 'bad_request' });
  });

  it('validates the request shape and the question length', async () => {
    expect((await post({ question: 'x'.repeat(501), digest })).body).toEqual({ ok: false, reason: 'bad_request' });
    expect((await post({ question: '', digest })).body).toEqual({ ok: false, reason: 'bad_request' });
    expect((await post({ question: 'hi' })).body).toEqual({ ok: false, reason: 'bad_request' });
    expect((await raw({ headers: { 'content-type': 'application/json' }, body: '{nope' })).body).toEqual({ ok: false, reason: 'bad_request' });
  });

  it('probe answers ok when the binary resolves', async () => {
    expect((await raw({ method: 'GET', path: BRIDGE_PATH + '?probe=1' })).body).toEqual({ ok: true });
  });

  it('probe and POST answer unavailable when no binary resolves', async () => {
    process.env.CLAUDE_BIN = join(scratch, 'does-not-exist');
    await withFreshBridge(async (p, hostPort) => {
      const host = { host: `127.0.0.1:${hostPort}` };
      expect((await raw({ method: 'GET', port: p, path: BRIDGE_PATH + '?probe=1', headers: host })).body).toEqual({ ok: false, reason: 'unavailable' });
      const r = await raw({ port: p, headers: { ...host, 'content-type': 'application/json' }, body: JSON.stringify(good) });
      expect(r.body).toEqual({ ok: false, reason: 'unavailable' });
    });
  });

  it('runs the child with no tools, no session, the schema, outside the repo, without secrets', async () => {
    process.env.FAKE_MODE = 'ok';
    process.env.FAKE_LOG = logFile;
    process.env.ANTHROPIC_API_KEY = 'k1';
    process.env.OPENAI_API_KEY = 'k2';
    process.env.SOME_VENDOR_API_KEY = 'k3';
    process.env.CLAUDECODE = '1';
    try {
      expect((await post()).body).toMatchObject({ ok: true });
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.SOME_VENDOR_API_KEY;
      delete process.env.CLAUDECODE;
    }
    const seen = JSON.parse(readFileSync(logFile, 'utf8')) as { argv: string[]; cwd: string; envKeys: string[]; stdin: string };
    const at = (f: string) => seen.argv.indexOf(f);
    expect(seen.argv).toContain('-p');
    expect(seen.argv[at('--tools') + 1]).toBe('');
    expect(seen.argv).toContain('--no-session-persistence');
    expect(seen.argv).toContain('--strict-mcp-config');
    expect(seen.argv).toContain('--disable-slash-commands');
    expect(seen.argv[at('--setting-sources') + 1]).toBe('');
    expect(seen.argv[at('--output-format') + 1]).toBe('json');
    expect(JSON.parse(seen.argv[at('--json-schema') + 1] ?? 'null')).toMatchObject({ type: 'object' });
    expect(seen.argv[at('--system-prompt') + 1]).toBeTruthy();
    expect(Number(seen.argv[at('--max-budget-usd') + 1])).toBeLessThanOrEqual(1);
    expect(seen.stdin).toContain(good.question);
    expect(resolve(seen.cwd).toLowerCase().startsWith((repoRoot + sep).toLowerCase())).toBe(false);
    for (const k of [...STRIP_ENV, 'SOME_VENDOR_API_KEY']) expect(seen.envKeys, k).not.toContain(k);
  });

  it('childEnv strips the table-engine list and keeps the rest', () => {
    expect(childEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'x', CODEX_API_KEY: 'y', HOME: '/h' })).toEqual({ PATH: '/bin', HOME: '/h' });
  });

  it('parseEnvelope takes structured_output only', () => {
    expect(parseEnvelope(JSON.stringify({ structured_output: { a: 1 } }), 5)).toMatchObject({ ok: true, reply: { a: 1 } });
    expect(parseEnvelope(JSON.stringify({ structured_output: [1] }), 5)).toEqual({ ok: false, reason: 'bad_output' });
    expect(parseEnvelope(JSON.stringify({ result: '{"a":1}' }), 5)).toEqual({ ok: false, reason: 'bad_output' });
  });

  it('is a dev-server-only plugin (absent from vite build)', () => {
    expect(assistantBridge().apply).toBe('serve');
  });
});

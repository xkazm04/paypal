// The director rig's shared parts: Playwright without a dependency, the dev server, the browser
// context every take uses, and waiting for a beat to show its end state. scripts/takes.mjs (stills,
// video, the rehearsal check) and scripts/film-capture.mjs (the demo film's capture) both drive the
// director through these, so a take and a film capture cannot drift apart.
//
// BROWSER PREVIEW ONLY: nothing here clicks inside a framed window or opens a PayPal page.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CLIENT = resolve(HERE, '..', '..');
export const SIZE = { width: 1920, height: 1080 };
/** The director's camera glides for 1.1 s; a beat is never captured before that. */
export const CAMERA_MS = 1300;
/** How long a beat may take to show its end state before the rig calls it broken. */
export const SETTLE_TIMEOUT_MS = 12_000;

// ---- Playwright, without a dependency ---------------------------------------------------------------

export async function loadPlaywright() {
  const tries = [];
  if (process.env.PLAYWRIGHT) tries.push(pathToFileURL(resolve(process.env.PLAYWRIGHT)).href);
  tries.push('playwright');
  // the global root beside this Node (Unix layout: <prefix>/bin/node, <prefix>/lib/node_modules)
  const roots = [join(dirname(dirname(process.execPath)), 'lib', 'node_modules')];
  try {
    // under `pnpm takes` the npm_config_* variables pnpm sets would point npm at this package
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toLowerCase().startsWith('npm_')));
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (root) roots.push(root);
  } catch {
    /* no npm on PATH */
  }
  for (const r of new Set(roots)) tries.push(pathToFileURL(join(r, 'playwright', 'index.mjs')).href);
  const missed = [];
  for (const t of tries) {
    try {
      const m = await import(t);
      if (m.chromium) return m;
      missed.push(`${t}: no chromium export`);
    } catch (e) {
      missed.push(`${t}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
  }
  throw new Error(`Playwright not found: install it globally (npm i -g playwright) or set PLAYWRIGHT=<.../playwright/index.mjs>\n  tried ${missed.join('\n  tried ')}`);
}

// ---- the server -------------------------------------------------------------------------------------

export async function reachable(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function ensureServer(o) {
  if (o.url) {
    const base = o.url.endsWith('/') ? o.url : `${o.url}/`;
    if (!(await reachable(new URL('director.html', base)))) throw new Error(`no director at ${base}director.html`);
    return { base, stop: () => {} };
  }
  const base = `http://localhost:${o.port}/`;
  if (await reachable(new URL('director.html', base))) return { base, stop: () => {} };
  const vite = join(CLIENT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(vite)) throw new Error('vite is not installed: run pnpm install in apps/desktop/client, or pass --url');
  const child = spawn(process.execPath, [vite, '--port', String(o.port), '--strictPort'], { cwd: CLIENT, stdio: 'ignore' });
  const stop = () => {
    if (child.exitCode === null) child.kill('SIGTERM');
  };
  process.on('exit', stop);
  for (let i = 0; i < 60; i++) {
    if (await reachable(new URL('director.html', base))) return { base, stop };
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  stop();
  throw new Error(`the dev server did not start on port ${o.port}`);
}

// ---- the browser --------------------------------------------------------------------------------------

export async function openBrowser(pw, o) {
  const executablePath = process.env.PW_CHROMIUM || undefined;
  return pw.chromium.launch({ executablePath, headless: !o.headed });
}

export async function newContext(browser, o, theme, recordDir) {
  const ctx = await browser.newContext({
    viewport: SIZE,
    screen: SIZE,
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
    colorScheme: theme,
    locale: 'en-US',
    timezoneId: o.tz,
    ...(recordDir ? { recordVideo: { dir: recordDir, size: SIZE } } : {}),
  });
  // The Table, the Tumbler, the approval window and the stage all follow the stored theme
  // (lib/theme.ts THEME_KEY).
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('table-theme', t);
    } catch {
      /* storage blocked: dark */
    }
  }, theme);
  return ctx;
}

/** Page errors and console errors, from the page and every frame in it. */
export function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console error: ${m.text()}`);
  });
  page.on('crash', () => errors.push('the page crashed'));
  return errors;
}

export const hook = (page, fn, arg) => page.evaluate(fn, arg);

export async function plan(page, o) {
  await page.waitForFunction(() => !!window.__takes, null, { timeout: 30_000 });
  const p = await hook(page, () => window.__takes.plan);
  // an unknown --story would quietly play Maya's week: refuse instead
  const want = o.story ?? 'maya';
  if (p.story !== want) throw new Error(`the director plays "${p.story}", not "${want}"`);
  return p;
}

export async function fontsReady(page) {
  await page.evaluate(async () => {
    const docs = [document, ...[...document.querySelectorAll('iframe')].map((f) => { try { return f.contentDocument; } catch { return null; } })];
    await Promise.all(docs.filter(Boolean).map((d) => d.fonts?.ready));
  });
}

/**
 * Wait (at most `cap` ms) until nothing is mid-move: no finite animation or transition runs in the
 * page or a frame (a console layer's entrance, the camera's glide; the Tumbler's breathing ring, the
 * seal's sweep and other endless ones do not count).
 */
export async function quiet(page, cap = 9000) {
  const start = Date.now();
  while (Date.now() - start < cap) {
    const busy = await page.evaluate(() => {
      const docs = [document, ...[...document.querySelectorAll('iframe')].map((f) => { try { return f.contentDocument; } catch { return null; } })].filter(Boolean);
      return docs.some((d) => d.getAnimations().some((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity));
    });
    if (!busy) return;
    await page.waitForTimeout(200);
  }
}

/** Wait for beat `index` to play and show its end state; the failures if it never does. */
export async function settle(page, index, { timeout = SETTLE_TIMEOUT_MS, until = null, still = false, playTimeout = 30_000 } = {}) {
  try {
    await page.waitForFunction((i) => {
      const n = window.__takes?.now();
      return !!n && n.ready && n.index === i;
    }, index, { timeout: playTimeout });
  } catch {
    return [`beat ${index} never played`];
  }
  const start = Date.now();
  await page.waitForTimeout(CAMERA_MS);
  let fail = [];
  for (;;) {
    fail = await hook(page, () => window.__takes.verify());
    if (fail.length === 0) break;
    if (Date.now() - start > timeout) break;
    if (until && (await until())) break;
    await page.waitForTimeout(250);
  }
  await fontsReady(page);
  if (still) await quiet(page);
  return fail;
}

export const pad = (n) => String(n).padStart(2, '0');
export const log = (s) => process.stdout.write(`${s}\n`);

export function ffmpegPath() {
  const candidates = [process.env.FFMPEG, 'ffmpeg'].filter(Boolean);
  for (const c of candidates) {
    try {
      execFileSync(c, ['-version'], { stdio: 'ignore' });
      return c;
    } catch {
      /* next */
    }
  }
  return null;
}


export function rawLength(ff, file) {
  const beside = join(dirname(ff), 'ffprobe');
  try {
    const out = execFileSync(existsSync(beside) ? beside : 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
    const n = Number(out.trim());
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    /* no ffprobe: decode the length instead */
  }
  const r = spawnSync(ff, ['-hide_banner', '-i', file, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const m = [...(r.stderr ?? '').matchAll(/time=(\d+):(\d+):([0-9.]+)/g)].pop();
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number.POSITIVE_INFINITY;
}

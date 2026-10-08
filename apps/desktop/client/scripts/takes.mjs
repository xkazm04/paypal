#!/usr/bin/env node
// Repeatable takes of the "Maya's week" director (director.html): stills of every beat, a video of
// the whole story or one chapter, and a rehearsal check that fails loudly on a broken beat.
//
// BROWSER PREVIEW ONLY: it drives the director on the browser mock. It never clicks inside a
// framed window (the director has no approve or pay action, and neither does this script), never
// opens a PayPal page, and every frame it writes carries the director's preview banner.
//
// Playwright is not a dependency of this package: use a globally installed one (`npm i -g
// playwright`), or point PLAYWRIGHT at its index.mjs. PW_CHROMIUM names the Chromium binary;
// without it Playwright's own download is used. ffmpeg (optional) retimes a video onto the beat
// file's clock (src/director/retime.ts). See src/director/README.md for the commands.
//
//   node scripts/takes.mjs --check
//   node scripts/takes.mjs --stills <dir> [--theme dark|light|both]
//   node scripts/takes.mjs --video <file.webm> [--chapter <n|id>]
//
// Options: --url <base> (a running dev or preview server; default: start `vite` on --port),
// --port <n> (default 1444), --date YYYY-MM-DD (the story's day; default 2026-11-05),
// --tz <IANA zone> (default America/Los_Angeles), --headed.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Pure and erasable TypeScript, loaded straight from the source (Node 22.18+ strips the types).
import { retimePlan, setptsExpr } from '../src/director/retime.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(HERE, '..');
const SIZE = { width: 1920, height: 1080 };
/** The director's camera glides for 1.1 s; a beat is never captured before that. */
const CAMERA_MS = 1300;
/** How long a beat may take to show its end state before the rig calls it broken. */
const SETTLE_TIMEOUT_MS = 12_000;

// ---- arguments ------------------------------------------------------------------------------------

function parseArgs(argv) {
  const o = { theme: 'dark', port: 1444, date: '2026-11-05', tz: 'America/Los_Angeles', headed: false };
  const flags = new Set(['--check', '--headed', '--help', '-h']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (flags.has(a)) {
      if (a === '--check') o.check = true;
      else if (a === '--headed') o.headed = true;
      else o.help = true;
      continue;
    }
    const v = argv[i + 1];
    if (!a.startsWith('--') || v === undefined) throw new Error(`unknown or incomplete option: ${a}`);
    i++;
    switch (a) {
      case '--url': o.url = v; break;
      case '--port': o.port = Number(v); break;
      case '--stills': o.stills = v; break;
      case '--video': o.video = v; break;
      case '--chapter': o.chapter = v; break;
      case '--theme': o.theme = v; break;
      case '--date': o.date = v; break;
      case '--tz': o.tz = v; break;
      default: throw new Error(`unknown option: ${a}`);
    }
  }
  if (!['dark', 'light', 'both'].includes(o.theme)) throw new Error('--theme is dark, light or both');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw new Error('--date is YYYY-MM-DD');
  if (o.chapter !== undefined && !o.video) throw new Error('--chapter goes with --video');
  if (!o.help && !o.check && !o.stills && !o.video) o.help = true;
  return o;
}

const USAGE = `takes: stills, video and a rehearsal check of the director (browser preview only)

  --check                 run every beat; exit 1 on a page or console error, a missing banner or
                          preview badge, or a beat whose end state is not on screen
  --stills <dir>          one 1920x1080 PNG per beat: <dir>/<theme>/NN-chapter-beat.png
  --theme dark|light|both theme of The Table and the stage for --stills (default dark)
  --video <file.webm>     the whole story at 1920x1080 in real time (cue sheet: <file>.cues.json)
  --chapter <n|id>        with --video: one chapter (1 = the haggle, as the caption rail counts)
  --url <base>            a running dev or preview server (default: start vite on --port)
  --port <n>              port for the server this script starts (default 1444)
  --date YYYY-MM-DD       the story's day (default 2026-11-05), --tz <zone> its time zone
  --headed                show the browser

  env PW_CHROMIUM=<chromium binary>, PLAYWRIGHT=<path to playwright's index.mjs>`;

// ---- Playwright, without a dependency ---------------------------------------------------------------

async function loadPlaywright() {
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

async function reachable(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureServer(o) {
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

async function openBrowser(pw, o) {
  const executablePath = process.env.PW_CHROMIUM || undefined;
  return pw.chromium.launch({ executablePath, headless: !o.headed });
}

async function newContext(browser, o, theme, recordDir) {
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
  // The Table and the stage follow the stored theme (lib/theme.ts THEME_KEY); the Tumbler and the
  // approval window are always dark.
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
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console error: ${m.text()}`);
  });
  page.on('crash', () => errors.push('the page crashed'));
  return errors;
}

function directorUrl(base, o, index, play) {
  const q = new URLSearchParams({ beat: String(index), play: play ? '1' : '0', take: '1', date: o.date });
  return new URL(`director.html?${q}`, base).href;
}

const hook = (page, fn, arg) => page.evaluate(fn, arg);

async function plan(page) {
  await page.waitForFunction(() => !!window.__takes, null, { timeout: 30_000 });
  return hook(page, () => window.__takes.plan);
}

async function fontsReady(page) {
  await page.evaluate(async () => {
    const docs = [document, ...[...document.querySelectorAll('iframe')].map((f) => { try { return f.contentDocument; } catch { return null; } })];
    await Promise.all(docs.filter(Boolean).map((d) => d.fonts?.ready));
  });
}

/**
 * Wait (at most `cap` ms) until nothing is mid-move: The Table's opening animation on Home has
 * finished and no finite animation or transition runs in the page or a frame (the Tumbler's
 * breathing ring and other endless ones do not count).
 */
async function quiet(page, cap = 9000) {
  const start = Date.now();
  while (Date.now() - start < cap) {
    const busy = await page.evaluate(() => {
      const docs = [document, ...[...document.querySelectorAll('iframe')].map((f) => { try { return f.contentDocument; } catch { return null; } })].filter(Boolean);
      return docs.some((d) => !!d.querySelector('.home.intro') || d.getAnimations().some((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity));
    });
    if (!busy) return;
    await page.waitForTimeout(200);
  }
}

/** Wait for beat `index` to play and show its end state; the failures if it never does. */
async function settle(page, index, { timeout = SETTLE_TIMEOUT_MS, until = null, still = false, playTimeout = 30_000 } = {}) {
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

const pad = (n) => String(n).padStart(2, '0');
const log = (s) => process.stdout.write(`${s}\n`);

// ---- --check -------------------------------------------------------------------------------------------

async function runCheck(browser, base, o) {
  const ctx = await newContext(browser, o, 'dark');
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await page.goto(directorUrl(base, o, 0, false));
  const p = await plan(page);
  let broken = 0;
  for (const b of p.beats) {
    errors.length = 0;
    await page.goto(directorUrl(base, o, b.index, false));
    const fail = await settle(page, b.index);
    const all = [...fail, ...errors];
    if (all.length) {
      broken++;
      log(`FAIL ${pad(b.index)} ${b.id}`);
      for (const f of all) log(`       - ${f}`);
    } else {
      log(`ok   ${pad(b.index)} ${b.id}`);
    }
  }
  await ctx.close();
  log(broken ? `\n${broken} of ${p.beats.length} beats are broken: fix them before a take.` : `\nall ${p.beats.length} beats show their end state.`);
  return broken === 0;
}

// ---- --stills ------------------------------------------------------------------------------------------

async function runStills(browser, base, o) {
  const themes = o.theme === 'both' ? ['dark', 'light'] : [o.theme];
  let ok = true;
  for (const theme of themes) {
    const dir = resolve(o.stills, theme);
    mkdirSync(dir, { recursive: true });
    const ctx = await newContext(browser, o, theme);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(directorUrl(base, o, 0, false));
    const p = await plan(page);
    for (const b of p.beats) {
      errors.length = 0;
      await page.goto(directorUrl(base, o, b.index, false));
      const fail = [...(await settle(page, b.index, { still: true })), ...errors];
      await page.waitForTimeout(300);
      const file = join(dir, b.still);
      await page.screenshot({ path: file, animations: 'allow' });
      if (fail.length) {
        ok = false;
        log(`FAIL ${theme} ${b.still}`);
        for (const f of fail) log(`       - ${f}`);
      } else {
        log(`ok   ${theme} ${file}`);
      }
    }
    await ctx.close();
  }
  return ok;
}

// ---- --video -------------------------------------------------------------------------------------------

function ffmpegPath() {
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

/** Seconds of the first beat, settled, before the story runs (kept at the head of a take). */
const LEAD_S = 0.4;
/** Where the caption text sits at 1920x1080 (director.css .dir-text): the rig watches it change. */
const CAPTION_BOX = 'crop=1100:70:20:950';

/** Raw-video seconds at which the caption changed (one per beat after the first). */
function captionChanges(ff, file) {
  const r = spawnSync(ff, ['-hide_banner', '-i', file, '-vf', `${CAPTION_BOX},select='gt(scene,0.08)',showinfo`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return [...(r.stderr ?? '').matchAll(/pts_time:([0-9.]+)/g)].map((m) => Number(m[1]));
}

function rawLength(ff, file) {
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

async function runVideo(browser, base, o) {
  const out = resolve(o.video);
  mkdirSync(dirname(out), { recursive: true });
  const rawDir = join(tmpdir(), `takes-${process.pid}-${Date.now()}`);
  mkdirSync(rawDir, { recursive: true });

  // Read the plan on a page that is not recorded.
  const probeCtx = await newContext(browser, o, 'dark');
  const probe = await probeCtx.newPage();
  await probe.goto(directorUrl(base, o, 0, false));
  await plan(probe);
  const span = o.chapter !== undefined
    ? await hook(probe, (sel) => window.__takes.chapter(/^\d+$/.test(sel) ? Number(sel) : sel), o.chapter)
    : await hook(probe, () => window.__takes.whole);
  const p = await hook(probe, () => window.__takes.plan);
  await probeCtx.close();
  if (!span) throw new Error(`no chapter ${o.chapter}`);

  const ctx = await newContext(browser, o, 'dark', rawDir);
  const page = await ctx.newPage();
  const t0 = Date.now();
  const errors = watchErrors(page);
  await page.goto(directorUrl(base, o, span.first, false));
  const first = await settle(page, span.first);
  // Hold the first beat's settled frame a moment, then let the story run on its own clock.
  await page.waitForTimeout(LEAD_S * 1000 + 100);
  const leadIn = (Date.now() - t0) / 1000;
  await hook(page, () => window.__takes.play());
  const startedAt = Date.now();
  const cues = [{ beat: p.beats[span.first].id, still: p.beats[span.first].still, at: 0 }];
  const broken = first.length ? [{ beat: p.beats[span.first].id, fail: first }] : [];
  let index = span.first;
  const duration = span.to - span.from;
  log(`recording ${o.chapter !== undefined ? `chapter ${o.chapter}` : 'the whole story'}: ${duration.toFixed(0)} s`);
  for (;;) {
    const n = await hook(page, () => window.__takes.now());
    // a chapter take stops just before the next chapter's first beat can play
    if (o.chapter !== undefined && n.t >= span.to - 0.4) {
      await hook(page, () => window.__takes.pause());
      break;
    }
    if (n.index > span.last || n.t >= span.to - 0.05 || (!n.playing && n.t >= span.to - 1)) break;
    if (n.index !== index && n.index >= 0) {
      index = n.index;
      const b = p.beats[index];
      cues.push({ beat: b.id, still: b.still, at: Number(((Date.now() - startedAt) / 1000).toFixed(2)) });
      log(`  ${pad(index)} ${b.id} at ${(b.at - span.from).toFixed(0)} s`);
      // verify the beat while it plays (its end state must show before the next beat starts)
      const next = p.beats[index + 1];
      const fail = await settle(page, index, {
        timeout: Math.max(2000, ((next ? next.at : span.to) - b.at) * 1000 - CAMERA_MS - 500),
        playTimeout: 3000,
        until: async () => (await hook(page, () => window.__takes.now())).index !== index,
      });
      if (fail.length) broken.push({ beat: b.id, fail });
      continue;
    }
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(o.chapter !== undefined ? 300 : 1500);
  const video = page.video();
  await ctx.close();
  const raw = join(rawDir, 'raw.webm');
  await video.saveAs(raw);

  const ff = ffmpegPath();
  const takeBeats = p.beats.slice(span.first, span.last + 1);
  const wall = (shift) => takeBeats.map((b) => {
    const c = cues.find((x) => x.beat === b.id);
    return c ? Number((c.at + shift).toFixed(2)) : null;
  });
  let cueAt = wall(leadIn);
  let timing = 'wall clock; the recording keeps its loading lead-in and any recorder lag (no ffmpeg)';
  let drift = null;
  if (ff) {
    const encode = ['-an', '-c:v', 'libvpx', '-b:v', '6M', '-crf', '8', '-qmin', '0', '-qmax', '40', '-deadline', 'good', '-cpu-used', '4', out];
    const changes = captionChanges(ff, raw);
    const plan = retimePlan({
      changes,
      beats: takeBeats.map((b) => b.at),
      end: span.to,
      lead: LEAD_S,
      tail: o.chapter !== undefined ? 0.3 : 1.5,
      rawLength: rawLength(ff, raw),
    });
    if (plan) {
      // Cut the lead-in and put every beat back on the beat file's clock (see src/director/retime.ts).
      const vf = `trim=start=${plan.cut}:end=${plan.end},setpts='(${setptsExpr(plan)})/TB',fps=25`;
      execFileSync(ff, ['-y', '-loglevel', 'error', '-i', raw, '-vf', vf, ...encode], { stdio: 'inherit' });
      cueAt = plan.cues;
      drift = plan.drift;
      timing = `retimed to the beat file; the raw recording ran up to ${Math.max(0, ...plan.drift.map(Math.abs)).toFixed(1)} s off`;
    } else {
      // The captions could not be matched to the beats: only cut the lead-in.
      const cut = Math.max(0, leadIn - LEAD_S);
      execFileSync(ff, ['-y', '-loglevel', 'error', '-ss', cut.toFixed(2), '-i', raw, ...encode], { stdio: 'inherit' });
      cueAt = wall(leadIn - cut);
      timing = `wall clock, lead-in cut; ${changes.length} caption changes for ${takeBeats.length - 1} beats could not be matched, so recorder lag is not corrected`;
      log(`warning: ${timing} (raw recording kept: ${out}.raw.webm)`);
      copyFileSync(raw, `${out}.raw.webm`);
    }
  } else {
    copyFileSync(raw, out);
    log(`no ffmpeg: the take keeps a ${leadIn.toFixed(1)} s loading lead-in (the cue sheet accounts for it)`);
  }
  rmSync(rawDir, { recursive: true, force: true });
  const sheet = {
    take: o.chapter !== undefined ? `chapter ${o.chapter}` : 'whole story',
    date: o.date,
    tz: o.tz,
    size: SIZE,
    scenario: { from: span.from, to: span.to },
    timing,
    cues: takeBeats.map((b, i) => ({ beat: b.id, still: b.still, at: cueAt[i] ?? null, ...(drift && i > 0 ? { recorder_drift: drift[i - 1] } : {}) })),
    broken,
    errors: [...errors],
  };
  writeFileSync(`${out}.cues.json`, `${JSON.stringify(sheet, null, 2)}\n`);
  for (const b of broken) {
    log(`FAIL ${b.beat}`);
    for (const f of b.fail) log(`       - ${f}`);
  }
  for (const e of errors) log(`FAIL ${e}`);
  log(`video: ${out}\ncues:  ${out}.cues.json`);
  return broken.length === 0 && errors.length === 0;
}

// ---- main ----------------------------------------------------------------------------------------------

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    log(USAGE);
    return 0;
  }
  const pw = await loadPlaywright();
  const server = await ensureServer(o);
  const browser = await openBrowser(pw, o);
  let ok = true;
  try {
    if (o.check) ok = (await runCheck(browser, server.base, o)) && ok;
    if (o.stills) ok = (await runStills(browser, server.base, o)) && ok;
    if (o.video) ok = (await runVideo(browser, server.base, o)) && ok;
  } finally {
    await browser.close();
    server.stop();
  }
  return ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`takes: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  },
);

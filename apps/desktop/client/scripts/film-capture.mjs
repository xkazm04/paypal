#!/usr/bin/env node
// The demo film's capture adapter for the director (the demo-film kit's `capture` step): plays the
// film script's capture beats on director.html?take=film, one recorded context, and writes the take
// (take/take.webm, take/take.mp4) and its record (take/take.json, the kit's `Take` contract): when
// each beat started and ended in the video, where its targets were drawn, what its action stood in
// for pressing, and the figures the mock world held.
//
// BROWSER PREVIEW ONLY and watch-only: the rig plays beats through the director's own `__takes`
// hook. It never clicks inside a framed window and the director has no money action; every beat
// is verified against the director's expected end state (EXPECT, with the preview banner and the
// "Preview · sample data" badges), recorded, and the take carries on; the exit code says which
// beats broke.
//
//   node scripts/film-capture.mjs <film-dir> [--story maya] [--base-url http://localhost:1531]
//                                [--port 1531] [--keep-server] [--date YYYY-MM-DD] [--tz <zone>] [--headed]
//
// <film-dir>/film.json is the FilmScript; <film-dir>/audio/manifest.json (optional) gives each
// beat's measured clip length, otherwise the line's length is estimated. The kit's contract.ts is
// loaded from $DEMO_FILM_KIT/tools/src/contract.ts (default <repo>/.claude/skills/demo-film).
// Without --base-url it starts vite on its own port (1531, --strictPort) and stops it at the end.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CLIENT, SIZE, ffmpegPath, hook, log, loadPlaywright, newContext, openBrowser, pad, plan, quiet, rawLength, reachable, settle, watchErrors } from './lib/rig.mjs';

const REPO = resolve(CLIENT, '..', '..', '..');
const PORT = 1531;
/** Playwright's video starts with the context; the exact first frame is not observable from Node,
 *  so every offset is Date.now() at the beat minus Date.now() at context creation, and this is its
 *  stated error bar (athena's journey take measured the same 300 ms). */
const OFFSET_UNCERTAINTY_MS = 300;
const FPS = 30;

const USAGE = `film-capture: the demo film's capture of the director (browser preview only)

  node scripts/film-capture.mjs <film-dir> [options]

  --story <id>         the director story the film's capture beats belong to (default maya)
  --base-url <url>     a running dev or preview server (default: start vite on --port)
  --port <n>           port for the server this script starts (default ${PORT}, never 1430)
  --keep-server        leave the server it started running
  --date YYYY-MM-DD    the story's day (default 2026-11-05), --tz <zone> its time zone
  --headed             show the browser

  env DEMO_FILM_KIT=<kit dir> (default <repo>/.claude/skills/demo-film), PLAYWRIGHT, PW_CHROMIUM`;

function parseArgs(argv) {
  const o = { story: 'maya', port: PORT, date: '2026-11-05', tz: 'America/Los_Angeles', headed: false, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (a === '--keep-server') { o.keep = true; continue; }
    if (a === '--headed') { o.headed = true; continue; }
    if (!a.startsWith('--')) {
      if (o.dir) throw new Error(`one film dir, not "${o.dir}" and "${a}"`);
      o.dir = a;
      continue;
    }
    const v = argv[++i];
    if (v === undefined) throw new Error(`incomplete option: ${a}`);
    switch (a) {
      case '--story': o.story = v; break;
      case '--base-url': o.url = v; break;
      case '--port': o.port = Number(v); break;
      case '--date': o.date = v; break;
      case '--tz': o.tz = v; break;
      default: throw new Error(`unknown option: ${a}`);
    }
  }
  if (!o.help && !o.dir) o.help = true;
  if (o.port === 1430) throw new Error('port 1430 belongs to the main checkout: use another');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw new Error('--date is YYYY-MM-DD');
  if (!/^[a-z0-9-]+$/.test(o.story)) throw new Error('--story is a story id');
  return o;
}

/** The kit's wire contract (erasable TypeScript; Node strips the types). */
async function loadContract() {
  const kit = resolve(process.env.DEMO_FILM_KIT || join(REPO, '.claude', 'skills', 'demo-film'));
  const file = join(kit, 'tools', 'src', 'contract.ts');
  if (!existsSync(file)) throw new Error(`no demo-film contract at ${file}: set DEMO_FILM_KIT to the kit's directory`);
  return import(pathToFileURL(file).href);
}

/** Our own server on our own port (strict), unless --base-url names one. */
async function startServer(o) {
  if (o.url) {
    const base = o.url.endsWith('/') ? o.url : `${o.url}/`;
    if (!(await reachable(new URL('director.html', base)))) throw new Error(`no director at ${base}director.html`);
    return { base, stop: () => {} };
  }
  const base = `http://localhost:${o.port}/`;
  if (await reachable(new URL('director.html', base))) throw new Error(`port ${o.port} is already serving: stop it, or pass --base-url ${base}`);
  const vite = join(CLIENT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(vite)) throw new Error('vite is not installed: run pnpm install in apps/desktop/client, or pass --base-url');
  const child = spawn(process.execPath, [vite, '--port', String(o.port), '--strictPort'], { cwd: CLIENT, stdio: 'ignore' });
  const stop = () => {
    if (o.keep || child.exitCode !== null) return;
    // the whole tree: vite's own children too (Windows keeps them otherwise)
    if (process.platform === 'win32') {
      try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
    } else {
      child.kill('SIGTERM');
    }
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

function filmUrl(base, o, index) {
  const q = new URLSearchParams({ ...(o.story !== 'maya' ? { story: o.story } : {}), beat: String(index), play: '0', take: 'film', date: o.date });
  return new URL(`director.html?${q}`, base).href;
}

/** The corner sync mark's grey level in every frame of the take (12 px square, bottom right). */
function markLevels(ff, video) {
  const out = execFileSync(ff, ['-loglevel', 'error', '-i', video, '-vf', `fps=${FPS},crop=8:8:${SIZE.width - 10}:${SIZE.height - 10},scale=1:1:flags=area,format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 });
  return [...out];
}

/** Resolves once the text of every window has not changed for `stillMs` (or after `cap`). */
async function textStable(page, stillMs = 600, cap = 8000) {
  const read = () => page.evaluate(() => [document, ...[...document.querySelectorAll('iframe')].map((f) => { try { return f.contentDocument; } catch { return null; } })]
    .filter(Boolean).map((d) => d.body?.innerText ?? '').join('\u0000'));
  const start = Date.now();
  let last = await read();
  let since = Date.now();
  while (Date.now() - start < cap) {
    await page.waitForTimeout(150);
    const now = await read();
    if (now !== last) { last = now; since = Date.now(); } else if (Date.now() - since >= stillMs) return;
  }
}

/** The stage ground just left of the mark, as an ffmpeg colour, to paint the mark out with. Read
 *  from a frame mid-take: the first frames are the page still loading (white). */
function groundBeside(ff, video) {
  const mid = Math.max(1, rawLength(ff, video) / 2);
  const px = execFileSync(ff, ['-loglevel', 'error', '-ss', String(mid), '-i', video, '-frames:v', '1', '-vf', `crop=8:8:${SIZE.width - 30}:${SIZE.height - 12},scale=1:1:flags=area,format=rgb24`, '-f', 'rawvideo', '-']);
  return `0x${[...px.subarray(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Moves each row's startMs/endMs from the wall clock to the video's, by where its sync mark first
 *  shows (searching forward in beat order). A beat whose mark is not found keeps its wall offsets,
 *  and the log says so. */
function alignToVideo(ff, video, rows, sync) {
  const levels = markLevels(ff, video);
  const frameMs = 1000 / FPS;
  let from = 0;
  const shifts = [];
  rows.forEach((row, i) => {
    const want = sync[i].shade;
    const near = (f) => f < levels.length && Math.abs(levels[f] - want) <= 4;
    let f = from;
    while (f < levels.length && !(near(f) && near(f + 1) && near(f + 2))) f += 1;
    if (f >= levels.length) {
      log(`sync: ${row.id}: mark ${want} not found in the video; wall-clock offsets kept`);
      return;
    }
    const shift = Math.round(f * frameMs) - sync[i].playedMs;
    // the drift keeps growing inside a beat, so its end is also bounded by the last frame that
    // still shows its own mark: the next jump's reload (a white page) never leaks into its tail
    let last = f;
    while (near(last + 1)) last += 1;
    row.startMs = Math.max(0, row.startMs + shift);
    row.endMs = Math.max(row.startMs + 1, Math.min(row.endMs + shift, Math.round((last + 1) * frameMs) - 1));
    shifts.push(shift);
    from = f + 1;
  });
  if (shifts.length) log(`sync: ${shifts.length}/${rows.length} beats aligned to the video; shift ${Math.min(...shifts)}..${Math.max(...shifts)} ms`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    log(USAGE);
    return 0;
  }
  const C = await loadContract();
  const dir = resolve(o.dir);
  const script = C.FilmScript.parse(readJson(join(dir, 'film.json')));
  const manifestFile = join(dir, 'audio', 'manifest.json');
  const manifest = existsSync(manifestFile) ? C.AudioManifest.parse(readJson(manifestFile)) : null;
  if (!manifest) log('no audio/manifest.json: every hold is estimated from its line');
  const captured = script.beats.filter((b) => b.capture);
  if (captured.length === 0) throw new Error('the film has no capture beats');

  const pw = await loadPlaywright();
  const server = await startServer(o);
  const browser = await openBrowser(pw, o);
  const takeDir = join(dir, 'take');
  const rawDir = join(takeDir, '.raw');
  rmSync(rawDir, { recursive: true, force: true });
  mkdirSync(rawDir, { recursive: true });
  const rows = [];
  const sync = [];
  const failed = [];
  let contextAt = 0;
  let closedAt = 0;
  const webm = join(takeDir, 'take.webm');
  const mp4 = join(takeDir, 'take.mp4');
  try {
    // The plan, from a page that is not recorded: beat ids -> the director's indices.
    const probeCtx = await newContext(browser, o, 'dark');
    const probe = await probeCtx.newPage();
    await probe.goto(filmUrl(server.base, o, 0));
    const p = await plan(probe, o);
    await probeCtx.close();
    const indexOf = new Map(p.beats.map((b) => [b.id, b.index]));
    for (const b of captured) if (!indexOf.has(b.capture.beat)) throw new Error(`film beat ${b.id}: the director has no beat "${b.capture.beat}"`);

    const ctx = await newContext(browser, o, 'dark', rawDir);
    contextAt = Date.now();
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(filmUrl(server.base, o, indexOf.get(captured[0].capture.beat)));
    await page.waitForFunction(() => !!window.__takes?.film, null, { timeout: 30_000 });
    let first = true;
    let at = indexOf.get(captured[0].capture.beat);
    for (const fb of captured) {
      const index = indexOf.get(fb.capture.beat);
      if (!first && index !== at + 1 && index > 0) {
        // not the next beat: jump to the beat before it first, so the reload a jump costs (a white
        // page, a loading pill) lands outside every logged window, then play this beat in place
        await hook(page, (n) => window.__takes.film.go(n), index - 1);
        await settle(page, index - 1);
      }
      errors.length = 0;
      if (!first) await hook(page, (n) => window.__takes.film.go(n), index);
      first = false;
      at = index;
      // the beat plays, then must show its end state (EXPECT); a broken beat is recorded, not fatal
      const fail = await settle(page, index);
      const playedAt = await hook(page, () => window.__takes.film.playedAt());
      // from "ready": the footage begins once the end state is on screen (settle has returned), for
      // a beat whose action is only a page change or a load; otherwise when the action starts
      const playedMs = Math.max(0, Math.round(playedAt - contextAt));
      // a "ready" beat's end-state checks can pass on the page it is leaving (the same text is on
      // both), so it is ready only once its windows are still: no animation, text unchanged 600 ms
      if (fb.capture.from === 'ready') {
        await quiet(page);
        await textStable(page);
      }
      const startMs = fb.capture.from === 'ready' ? Math.round(Date.now() - contextAt) : playedMs;
      const shade = await hook(page, () => window.__takes.film.shade());
      const targets = fb.capture.targets ?? [];
      const rects = await hook(page, (t) => window.__takes.film.rects(t), targets);
      const clicks = await hook(page, () => window.__takes.film.clicks());
      const record = await hook(page, () => window.__takes.film.record());
      const seen = await hook(page, () => window.__takes.seen());
      const problems = [...fail, ...errors];
      for (const t of targets) if (!rects[t]) problems.push(`target ${t} is not drawn`);
      // the record's figures must be the ones The Table draws (takes.ts recordShown)
      problems.push(...(await hook(page, (r) => window.__takes.film.shown(r), record)));
      const hold = C.holdMs(fb, script.breathMs, manifest?.clips[fb.id]?.ms);
      const left = startMs + hold - (Date.now() - contextAt);
      if (left > 0) await page.waitForTimeout(left);
      const endMs = Math.round(Date.now() - contextAt);
      const row = { id: fb.id, startMs, endMs, rects, clicks: clicks.map((c) => ({ x: c.x, y: c.y, atMs: Math.round(c.atMs) })) };
      if (Object.keys(record).length) row.record = record;
      if (problems.length) {
        row.error = problems.join('; ');
        failed.push({ id: fb.id, problems });
      }
      rows.push(row);
      sync.push({ shade, playedMs });
      const banner = seen.banner.includes('Browser preview with sample data') ? 'banner' : 'NO BANNER';
      log(`${problems.length ? 'FAIL' : 'ok  '} ${fb.id} (${pad(index)} ${fb.capture.beat}) ${startMs}-${endMs} ms, hold ${hold} ms, ${Object.keys(rects).length}/${targets.length} rects, ${clicks.length} clicks, ${banner}${row.record ? `, record ${JSON.stringify(row.record)}` : ''}`);
      for (const f of problems) log(`       - ${f}`);
    }
    await page.waitForTimeout(300);
    const video = page.video();
    closedAt = Date.now();
    await ctx.close();
    // the take: the raw webm as recorded (saved before the browser goes)
    await video.saveAs(webm);
  } finally {
    await browser.close();
    server.stop();
  }
  rmSync(rawDir, { recursive: true, force: true });
  // an h264 copy on the same clock for the film's renderer (Remotion's OffthreadVideo)
  const ff = ffmpegPath();
  if (!ff) throw new Error('ffmpeg is needed for take.mp4 (put it on the PATH or set FFMPEG)');
  // The recorder's video drifts behind the wall clock it ran on (seconds over a long take), so the
  // logged windows are moved onto the video's own clock: each beat's corner sync mark is found in
  // the frames, and the beat's offsets shift by where it really appeared. The mark is then painted
  // over with the ground beside it, so no film ever shows it.
  alignToVideo(ff, webm, rows, sync);
  const ground = groundBeside(ff, webm);
  execFileSync(ff, ['-y', '-loglevel', 'error', '-i', webm, '-an', '-vf', `drawbox=x=${SIZE.width - 16}:y=${SIZE.height - 16}:w=16:h=16:color=${ground}:t=fill`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-fps_mode', 'cfr', '-r', String(FPS), '-movflags', '+faststart', mp4], { stdio: 'inherit' });
  // The recorder's length against the wall clock it ran on, for the log: Chromium pads the tail when
  // the context closes, so the difference is not the offsets' error (their head is context creation).
  const wallMs = closedAt - contextAt;
  const videoMs = Math.round(rawLength(ff, webm) * 1000);
  const take = C.Take.parse({
    video: 'take/take.mp4',
    width: SIZE.width,
    height: SIZE.height,
    fps: FPS,
    offsetUncertaintyMs: OFFSET_UNCERTAINTY_MS,
    beats: rows,
  });
  writeFileSync(join(takeDir, 'take.json'), `${JSON.stringify(take, null, 2)}\n`);
  log(`\ntake:   ${mp4} (${(videoMs / 1000).toFixed(2)} s; wall ${(wallMs / 1000).toFixed(2)} s)\nrecord: ${join(takeDir, 'take.json')}`);
  if (failed.length) {
    log(`\n${failed.length} of ${captured.length} beats broke:`);
    for (const f of failed) log(`  ${f.id}: ${f.problems.join('; ')}`);
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`film-capture: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  },
);

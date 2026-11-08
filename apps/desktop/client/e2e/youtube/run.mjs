#!/usr/bin/env node
// YouTube sponsorship, end to end: a guided runbook plus an observer.
//
// The script drives The Table where that is safe, and at every step only the owner may take (PayPal
// sandbox keys, signing rules, confirming four words, any approval-window decision, unlocking) it
// stops, prints a "You do this" card, and watches the app until the step shows as done. It never
// approves, signs, pays, pastes keys or unlocks. In the mock world those owner steps are simulated
// through the mock's own approval window and labelled so.
//
//   node e2e/youtube/run.mjs                      mock dry-run (starts Vite on a free port, ?first_run=1)
//   node e2e/youtube/run.mjs --mode live          the desktop app over CDP (see README.md)
//   node e2e/youtube/run.mjs --mode live --observe ledger   no CDP: desktop screenshots + ledger copy
//
// Output: <repo>/e2e-out/youtube/<timestamp>/ (results.json, friction.md, shots/). See README.md.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from '../../scripts/lib/rig.mjs';
import { openLive, openMock, readLedger, sleep, windowOf, WINDOWS } from './lib/app.mjs';
import { OwnerInput, printCard, waitFor } from './lib/card.mjs';
import { countChecks, frictionMarkdown, screenChecks } from './lib/friction.mjs';
import { BEATS } from './beats.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(HERE, '..', '..');
const REPO = resolve(CLIENT, '..', '..', '..');
const log = (s) => process.stdout.write(`${s}\n`);

function args(argv) {
  const o = {
    mode: 'mock', port: 1561, url: null, cdp: 'http://127.0.0.1:9222', observe: 'cdp', ledger: null,
    out: null, timeoutMin: 15, brandTimeoutMin: 30, only: null, from: null, themes: ['light', 'dark'],
    headed: false, tz: 'America/Los_Angeles', pinnedAt: '2026-11-05T09:00:00-08:00', notes: true, client: CLIENT,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    switch (a) {
      case '--mode': o.mode = v(); break;
      case '--port': o.port = Number(v()); break;
      case '--url': o.url = v(); break;
      case '--cdp': o.cdp = v(); break;
      case '--observe': o.observe = v(); break;
      case '--ledger': o.ledger = v(); break;
      case '--out': o.out = v(); break;
      case '--timeout-min': o.timeoutMin = Number(v()); break;
      case '--brand-timeout-min': o.brandTimeoutMin = Number(v()); break;
      case '--only': o.only = v(); break;
      case '--from': o.from = v(); break;
      case '--theme': { const t = v(); o.themes = t === 'both' ? ['light', 'dark'] : [t]; break; }
      case '--headed': o.headed = true; break;
      case '--tz': o.tz = v(); break;
      case '--at': o.pinnedAt = v(); break;
      case '--no-notes': o.notes = false; break;
      case '-h': case '--help':
        log(readFileSync(join(HERE, 'README.md'), 'utf8').split('\n').slice(0, 60).join('\n'));
        process.exit(0);
        break;
      default: throw new Error(`unknown option ${a} (see e2e/youtube/README.md)`);
    }
  }
  if (!['mock', 'live'].includes(o.mode)) throw new Error('--mode is mock or live');
  if (!['cdp', 'ledger'].includes(o.observe)) throw new Error('--observe is cdp or ledger');
  if (o.mode === 'live' && !o.ledger && process.env.APPDATA) o.ledger = join(process.env.APPDATA, 'dev.thetable.wallet', 'wallet.sqlite');
  const ids = BEATS.map((b) => b.id);
  for (const k of ['only', 'from']) if (o[k] && !ids.includes(o[k])) throw new Error(`--${k} names no beat; beats: ${ids.join(', ')}`);
  return o;
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/** Observe-only stand-in for the app when CDP is not available: nothing to read or click. */
function nullApp() {
  return {
    mode: 'live', context: null, errors: [], clicks: [],
    page: () => null, read: async () => null, charter: async () => null, mockState: async () => null,
    takeErrors() { return []; }, takeClicks() { return []; }, theme: async () => null,
    route: async () => { throw new Error('no CDP: the harness cannot navigate in observe-only mode'); },
    click: async () => { throw new Error('no CDP: the harness cannot click in observe-only mode'); },
    stop: async () => {},
  };
}

/** A full-desktop PNG through PowerShell (Windows only): the observe-only screenshot. */
function desktopShot(file) {
  const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; $m=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($m); $g.CopyFromScreen($b.Left,$b.Top,0,0,$m.Size); $m.Save('${file.replace(/'/g, "''")}'); $g.Dispose(); $m.Dispose()`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore', timeout: 20_000 });
}

async function main() {
  const o = args(process.argv.slice(2));
  const out = resolve(o.out ?? join(REPO, 'e2e-out', 'youtube', stamp()));
  mkdirSync(join(out, 'shots'), { recursive: true });
  const briefs = JSON.parse(readFileSync(join(HERE, 'briefs.json'), 'utf8'));

  log(`YouTube sponsorship e2e · ${o.mode}${o.mode === 'live' ? ` (${o.observe === 'cdp' ? `CDP ${o.cdp}` : 'observe only: desktop screenshots + ledger copy'})` : ''}`);
  log(`  output: ${out}`);

  let pw = null;
  if (o.observe === 'cdp' || o.mode === 'mock') pw = await loadPlaywright();
  const app = o.mode === 'mock' ? await openMock(pw, o, log) : o.observe === 'cdp' ? await openLive(pw, o, log) : nullApp();
  const input = new OwnerInput(o.mode === 'live' && o.notes);

  // The sample week (no first_run) in a context of its own, for the mock's reference screens.
  let refContext = null;
  const referencePage = async (path) => {
    if (!refContext) {
      refContext = await app.browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', timezoneId: o.tz, reducedMotion: 'reduce' });
      await refContext.clock.install({ time: new Date(o.pinnedAt) });
    }
    const p = refContext.pages()[0] ?? (await refContext.newPage());
    await p.goto(new URL(path, app.base).href, { waitUntil: 'domcontentloaded' });
    return p;
  };

  const run = { case: 'youtube-sponsorship', mode: o.mode, observe: o.mode === 'live' ? o.observe : null, startedAt: new Date().toISOString(), pinnedAt: o.mode === 'mock' ? o.pinnedAt : null, base: app.base ?? o.cdp, out, beats: [], data: {} };
  const save = () => {
    writeFileSync(join(out, 'results.json'), JSON.stringify(run, null, 2));
    writeFileSync(join(out, 'friction.md'), frictionMarkdown(run));
  };

  const ledger = o.mode === 'live' && o.ledger ? () => readLedger(o.ledger) : null;
  const total = BEATS.length;
  let started = !o.from;
  try {
    for (const [i, beat] of BEATS.entries()) {
      const n = i + 1;
      if (o.from === beat.id) started = true;
      if (!started || (o.only && o.only !== beat.id)) continue;
      const rec = {
        n, id: beat.id, title: beat.title, actor: beat.actor, actorShown: beat.actor, status: 'running', signal: '', ms: 0,
        startedAt: new Date().toISOString(), screens: [...beat.screens], expected: beat.expected, success: beat.success,
        clicks: [], consoleErrors: [], friction: [], screenshots: [], ownerNotes: [], gaps: beat.gaps ?? [], data: {}, timings: {},
      };
      run.beats.push(rec);
      const t0 = Date.now();
      const shootPage = async (page, name) => {
        for (const theme of o.themes) {
          try {
            const btn = page.getByRole('button', { name: theme === 'light' ? 'Light' : 'Dark', exact: true }).first();
            if (await btn.isVisible().catch(() => false)) await btn.click();
            else {
              await page.evaluate((t) => {
                const old = localStorage.getItem('table-theme');
                localStorage.setItem('table-theme', t);
                window.dispatchEvent(new StorageEvent('storage', { key: 'table-theme', oldValue: old, newValue: t, storageArea: localStorage }));
                document.documentElement.setAttribute('data-theme', t);
              }, theme);
            }
            await page.waitForTimeout(400);
            const file = `shots/${String(n).padStart(2, '0')}-${beat.id}-${slug(name)}-${theme}.png`;
            await page.screenshot({ path: join(out, file) });
            rec.screenshots.push(file);
          } catch (e) {
            rec.friction.push({ kind: 'harness', severity: 'low', window: windowOf(page.url()) ?? 'page', text: `screenshot ${name} (${theme}) failed: ${String(e.message).split('\n')[0]}` });
          }
        }
      };
      const shoot = async (name) => {
        if (app === null || !app.context) {
          if (o.observe === 'ledger') {
            const file = `shots/${String(n).padStart(2, '0')}-${beat.id}-${slug(name)}-desktop.png`;
            try { desktopShot(join(out, file)); rec.screenshots.push(file); } catch (e) { rec.friction.push({ kind: 'harness', severity: 'low', window: 'desktop', text: `desktop screenshot failed: ${e.message}` }); }
          }
          return;
        }
        const before = await app.page('main')?.evaluate(() => localStorage.getItem('table-theme') || 'dark').catch(() => null);
        for (const theme of o.themes) {
          await app.theme(theme).catch(() => {});
          for (const win of WINDOWS) {
            const p = app.page(win);
            if (!p) continue;
            await p.waitForTimeout(300);
            const file = `shots/${String(n).padStart(2, '0')}-${beat.id}-${slug(name)}-${win}-${theme}.png`;
            try { await p.screenshot({ path: join(out, file) }); rec.screenshots.push(file); } catch { /* window closed meanwhile */ }
          }
        }
        if (before) await app.theme(before).catch(() => {});
      };
      const checkPage = (win, r) => { for (const f of screenChecks(win, r)) rec.friction.push(f); };
      const ctx = {
        briefs, pinnedAt: o.pinnedAt, data: run.data, refContext: null, ledger,
        friction: (f) => rec.friction.push(f),
        signal: (s) => { rec.data.signals = [...(rec.data.signals ?? []), s]; },
        screen: (s) => { if (!rec.screens.includes(s)) rec.screens.push(s); },
        counterparty: (s) => { rec.data.counterparty = [...(rec.data.counterparty ?? []), s]; },
        checkScreen: async (win) => checkPage(win, await app.read(win)),
        checkPage: async (win, page) => checkPage(win, await page.evaluate(() => ({ body: document.body.innerText, content: [...document.querySelectorAll('.cs-bar, .cs-foot, [role=tablist]')].reduce((t, e) => t.replace(e.innerText, ''), document.body.innerText), headings: [...document.querySelectorAll('h1,h2,h3')].map((e) => e.innerText), gold: [], infos: document.querySelectorAll('[aria-label^="About"]').length }))),
        shoot, shootPage,
        referencePage: async (path) => { const p = await referencePage(path); ctx.refContext = refContext; return p; },
      };

      // In the browser preview the approval window shares The Table's tab: start each beat on The Table.
      if (o.mode === 'mock') await app.ensureMain();

      // 1. what the script does itself
      const card = beat.card ?? {};
      if (beat.script) {
        printCard(log, { kind: 'script', n, total, title: beat.title, where: beat.screens.join(' · '), done: beat.success });
        const ts = Date.now();
        try { await beat.script(app, ctx); } catch (e) { rec.friction.push({ kind: 'harness', severity: 'medium', window: 'main', text: `script part failed: ${String(e.message).split('\n')[0]}` }); }
        rec.timings.scriptMs = Date.now() - ts;
      }

      // 2. the owner's (or the brand's) part
      let result;
      if (beat.actor === 'owner' || beat.actor === 'brand') {
        if (o.mode === 'mock') {
          if (beat.simulate) {
            rec.actorShown = `${beat.actor} (simulated owner step)`;
            printCard(log, { kind: 'simulated', n, total, title: beat.title, where: card.where, steps: card.steps, done: card.done, note: 'In the live run you do this yourself; here the mock\'s own windows stand in.' });
            const ts = Date.now();
            try { await beat.simulate(app, ctx); } catch (e) { rec.friction.push({ kind: 'harness', severity: 'high', window: 'approval', text: `simulated owner step failed: ${String(e.message).split('\n')[0]}` }); }
            rec.timings.simulateMs = Date.now() - ts;
            result = await waitFor(() => beat.detect(app, ctx), { timeoutMs: 15_000, everyMs: 500, log, label: beat.title });
            if (result.status === 'done') result.status = 'done (simulated owner step)';
          } else {
            rec.actorShown = beat.actor === 'brand' ? 'brand (simulated counterparty in mock)' : beat.actor;
            result = await waitFor(() => beat.detect(app, ctx), { timeoutMs: 8000, everyMs: 500, log, label: beat.title });
            if (result.status === 'timeout' && beat.reference) result = { status: 'reference only (sample data)', signal: 'the first-run world cannot reach this beat; shown on the sample week', ms: result.ms, notes: [] };
            else if (result.status === 'done' && beat.actor === 'brand') result.status = 'done (simulated counterparty)';
          }
        } else {
          printCard(log, { kind: 'owner', n, total, title: beat.actor === 'brand' ? `${beat.title} (the brand acts; you watch)` : beat.title, where: card.where, steps: card.steps, done: card.done });
          result = await waitFor(() => beat.detect(app, ctx), { timeoutMs: (beat.actor === 'brand' ? o.brandTimeoutMin : o.timeoutMin) * 60_000, everyMs: 2000, input, log, label: beat.title });
          rec.ownerNotes.push(...result.notes);
          if (result.status === 'timeout') log(`  ! Not seen in time: ${beat.title}. Moving on; the step is marked "timeout" in results.json. Re-run it with --only ${beat.id}.`);
        }
      } else {
        result = await waitFor(() => beat.detect(app, ctx), { timeoutMs: o.mode === 'mock' ? 8000 : 60_000, everyMs: 500, input, log, label: beat.title });
        if (o.mode === 'mock' && beat.reference && result.signal === 'reference only') result.status = 'reference only (sample data)';
      }
      rec.status = result.status;
      rec.signal = [result.signal, ...(rec.data.signals ?? [])].filter(Boolean).join(' · ');
      rec.timings.waitMs = result.ms;

      // 3. mock: the same screens on the sample week where the first-run world cannot go
      if (o.mode === 'mock' && beat.reference) {
        printCard(log, { kind: 'script', n, total, title: `${beat.title}: reference screens on the sample week (not this case's deal)`, where: beat.screens.join(' · ') });
        try { await beat.reference(app, ctx); } catch (e) { rec.friction.push({ kind: 'harness', severity: 'low', window: 'reference', text: `reference failed: ${String(e.message).split('\n')[0]}` }); }
      }

      // 4. what the owner sees at the end of the beat, light and dark, and what the screens say
      await shoot('end');
      const reads = {};
      for (const win of WINDOWS) {
        reads[win] = await app.read(win);
        if (reads[win]) { checkPage(win, reads[win]); if (!rec.screens.some((s) => s.toLowerCase().includes(win === 'main' ? 'the table' : win))) rec.screens.push(`${win}: ${reads[win].headings[0] ?? '(no heading)'}`); }
      }
      const counts = countChecks(reads);
      rec.data.setupCounts = counts.found;
      rec.friction.push(...counts.findings);
      // de-duplicate repeated automatic findings within a beat
      const seen = new Set();
      rec.friction = rec.friction.filter((f) => { const k = `${f.kind}|${f.window}|${f.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
      rec.clicks = app.takeClicks().map(({ t, ...c }) => ({ ...c, atS: t ? Math.round((t - t0) / 100) / 10 : null }));
      rec.consoleErrors = app.takeErrors();
      if (o.mode === 'mock') rec.data.mock = summarizeMock(await app.mockState());
      if (ledger) rec.data.ledger = ledger();
      rec.ms = Date.now() - t0;
      log(`  → ${rec.status}: ${rec.signal || '-'} (${(rec.ms / 1000).toFixed(1)} s, ${rec.clicks.length} clicks, ${rec.consoleErrors.length} console errors, ${rec.friction.length} findings)`);
      save();
    }
  } finally {
    run.endedAt = new Date().toISOString();
    save();
    input.close();
    if (refContext) await refContext.close().catch(() => {});
    await app.stop();
  }
  log('');
  log(`Done. ${run.beats.filter((b) => b.status.startsWith('done')).length} of ${run.beats.length} beats done.`);
  log(`  ${join(out, 'results.json')}`);
  log(`  ${join(out, 'friction.md')}`);
  await sleep(50);
}

function summarizeMock(s) {
  if (!s) return null;
  return {
    keysSaved: !!s.settings?.payment_executor_configured,
    engine: s.settings?.selected_engine, engineChosen: !!s.settings?.engine_chosen,
    mandates: s.mandates?.length ?? 0,
    counterparties: (s.counterparties ?? []).map((c) => `${c.display_name} (${c.pairing})`),
    deals: (s.deals ?? []).map((d) => `${d.display.label} ${d.deal.side} ${d.deal.terms.item_ref} ${d.deal.state} ${d.deal.terms.unit_price.minor / 100}`),
    notes: Object.keys(s.notes ?? {}).length,
  };
}

main().catch((e) => {
  log(`\nThe run stopped: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

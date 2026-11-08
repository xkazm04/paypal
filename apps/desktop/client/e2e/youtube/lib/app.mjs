// The app under test, in either world, behind one small surface the beats use:
//
//   mock: the browser preview (Vite dev server, the mock backend, `?first_run=1` for day one). The
//         harness starts Chromium itself and may drive every window, the approval window included,
//         because the mock moves no money. Owner steps there are "simulated owner steps".
//   live: the real desktop app (Tauri, WebView2) reached over the Chrome DevTools Protocol. The
//         harness may read every window's DOM and take screenshots, and may click only harmless
//         navigation in The Table (main). It never clicks in the approval window or the Tumbler,
//         never presses a money, sign, unlock or connect button, and never evaluates anything that
//         reaches the wallet's IPC. Those refusals are enforced here, in `click`, not by convention.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The only controls the harness may press in the live app: the tour, the theme and plain navigation.
 *  An allow-list, so a new money or owner button can never slip through. Hand-offs (↗) are the owner's. */
const LIVE_ALLOWED = /^(next|back|‹ ?back|skip tour|finish|take the tour|light|dark|(tables|spend|counter|book|shield|rescue)( \d+\+?)?|rules|connections|settings|rewind|see all.*)$/i;
/** Hash routes of The Table the harness may visit in the live app (navigation only). */
const LIVE_ROUTES = /^#(s=setup|m=(tables|counter|book|shield|spend|rescue)(&v=\w+)?|p=(connections|pairing|settings|rules|safety)|d=[\w-]+(&dv=\w+)?)?$/;

export const WINDOWS = ['main', 'approval', 'tumbler'];

/** Which window a page is, from its address (the browser preview and the desktop app agree). */
export function windowOf(url) {
  let path;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  if (/approval\.html$/.test(path)) return 'approval';
  if (/tumbler\.html$/.test(path)) return 'tumbler';
  if (/(index\.html|\/)$/.test(path)) return 'main';
  return null;
}

export class App {
  constructor({ mode, browser, context, base, firstRun = true, log }) {
    this.mode = mode;
    this.browser = browser;
    this.context = context;
    this.base = base;
    this.firstRun = firstRun;
    this.log = log;
    /** Console and page errors, per window, since the last `takeErrors()`. */
    this.errors = [];
    /** Clicks the harness made since the last `takeClicks()` (what an owner would have clicked). */
    this.clicks = [];
    this.watched = new WeakSet();
    for (const p of context.pages()) this.watch(p);
    context.on('page', (p) => this.watch(p));
  }

  watch(page) {
    if (this.watched.has(page)) return;
    this.watched.add(page);
    page.on('console', (m) => {
      if (m.type() === 'error') this.errors.push({ window: windowOf(page.url()), text: m.text().slice(0, 400) });
    });
    page.on('pageerror', (e) => this.errors.push({ window: windowOf(page.url()), text: `page error: ${String(e.message).slice(0, 400)}` }));
  }

  takeErrors() {
    const e = this.errors;
    this.errors = [];
    return e;
  }

  takeClicks() {
    const c = this.clicks;
    this.clicks = [];
    return c;
  }

  /** The open page of a window, or null. The approval window comes and goes. */
  page(win) {
    const pages = this.context.pages().filter((p) => !p.isClosed() && windowOf(p.url()) === win);
    return pages[pages.length - 1] ?? null;
  }

  /** Wait (at most `ms`) for a window to be open, e.g. after a hand-off opened the approval window. */
  async waitWindow(win, ms = 10_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const p = this.page(win);
      if (p) {
        await p.waitForLoadState('domcontentloaded').catch(() => {});
        return p;
      }
      await sleep(250);
    }
    return null;
  }

  /**
   * Mock only: make sure The Table is open. The browser preview opens the approval window in the same
   * tab as The Table (demo mode, lib/runtime.ts), so after a hand-off "Back to The Table" brings it back.
   */
  async ensureMain() {
    if (this.mode !== 'mock' || this.page('main')) return this.page('main');
    const ap = this.page('approval');
    if (ap) {
      const back = ap.getByRole('button', { name: /Back to The Table/ }).first();
      if (await back.isVisible().catch(() => false)) {
        await back.click().catch(() => {});
        this.clicks.push({ window: 'approval', words: '‹ Back to The Table', why: 'return to The Table', simulated: true, t: Date.now() });
        for (let i = 0; i < 20 && !this.page('main'); i++) await sleep(250);
      }
    }
    if (!this.page('main')) {
      const p = this.context.pages().find((x) => !x.isClosed()) ?? (await this.context.newPage());
      await p.goto(this.url('index.html'), { waitUntil: 'domcontentloaded' });
    }
    const main = this.page('main');
    await main?.waitForTimeout(1500);
    return main;
  }

  url(path) {
    const u = new URL(path, this.base);
    if (this.mode === 'mock' && this.firstRun) {
      const [p, h] = path.split('#');
      return `${new URL(p, this.base).href}${p.includes('?') ? '&' : '?'}first_run=1${h !== undefined ? `#${h}` : ''}`;
    }
    return u.href;
  }

  /** Move The Table to a route (`#m=tables`, `#s=setup`, ...). Navigation only; never a decision. */
  async route(hash) {
    const main = this.mode === 'mock' ? await this.ensureMain() : this.page('main');
    if (!main) throw new Error('The Table (main window) is not open');
    if (this.mode === 'live' && !LIVE_ROUTES.test(hash)) throw new Error(`refused: route ${hash} is not on the live navigation list`);
    await main.evaluate((h) => { location.hash = h; }, hash);
    await main.waitForTimeout(900);
    return main;
  }

  /**
   * Click something, counting it as a click the owner would make. In the live app this refuses any
   * window but The Table and any control whose words are a money, sign, unlock or connect action.
   * `simulated` marks a click that stands in for the owner (mock only).
   */
  async click(win, locate, why, { simulated = false, timeout = 6000 } = {}) {
    const page = this.page(win);
    if (!page) throw new Error(`${win} window is not open (wanted: ${why})`);
    const loc = typeof locate === 'function' ? locate(page) : page.locator(locate);
    const target = loc.first();
    await target.waitFor({ state: 'visible', timeout });
    const words = ((await target.innerText().catch(() => '')) || (await target.getAttribute('aria-label').catch(() => '')) || '').trim();
    if (this.mode === 'live') {
      if (simulated) throw new Error('refused: a simulated owner step never runs against the live app');
      if (win !== 'main') throw new Error(`refused: the harness never clicks in the ${win} window of the live app`);
      const plain = words.replace(/\s+/g, ' ').trim();
      if (!LIVE_ALLOWED.test(plain)) throw new Error(`refused: "${plain}" is not on the live allow-list (tour, theme, navigation); the owner presses it`);
    }
    await target.click({ timeout });
    this.clicks.push({ window: win, words: words.replace(/\s+/g, ' ').slice(0, 80), why, simulated, t: Date.now() });
    await page.waitForTimeout(350);
    return target;
  }

  /** Type into a field (counted as one owner action). Same live refusals as `click`. */
  async fill(win, selector, text, why, { simulated = false } = {}) {
    const page = this.page(win);
    if (!page) throw new Error(`${win} window is not open (wanted: ${why})`);
    if (this.mode === 'live') throw new Error('refused: the harness never types into the live app (codes, names and amounts are the owner\'s)');
    const loc = page.locator(selector).first();
    await loc.waitFor({ state: 'visible', timeout: 6000 });
    await loc.fill(text);
    this.clicks.push({ window: win, words: `type "${text.slice(0, 40)}"`, why, simulated, t: Date.now() });
    return loc;
  }

  /** What a window shows, read from its DOM only (no IPC): text, headings, buttons, classes. */
  async read(win) {
    const page = this.page(win);
    if (!page) return null;
    return page.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const text = (e) => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim();
      const all = (s) => [...document.querySelectorAll(s)].filter(vis);
      const tabs = Object.fromEntries(all('button').map(text).map((t) => t.match(/^(Tables|Spend|Counter|Book|Shield|Rescue) (\d+\+?)$/)).filter(Boolean).map((m) => [m[1].toLowerCase(), m[2]]));
      return {
        url: location.href,
        title: document.title,
        body: document.body ? document.body.innerText.replace(/[ \t]+/g, ' ') : '',
        // The page without its standing chrome (top bar, module tabs, footer): what this screen says.
        content: (() => {
          let t = document.body ? document.body.innerText : '';
          for (const e of document.querySelectorAll('.cs-bar, .cs-foot, [role=tablist]')) {
            const c = e.innerText;
            if (c) t = t.replace(c, '');
          }
          return t.replace(/[ \t]+/g, ' ');
        })(),
        headings: all('h1,h2,h3').map(text).filter(Boolean),
        buttons: all('button,a[href],[role=button]').map((e) => text(e) || e.getAttribute('aria-label') || '').filter(Boolean),
        gold: all('.ui-btn.gold,button.gold,[class*="gold"] > button').map(text).filter(Boolean),
        infos: all('[aria-label^="About"],button[aria-label*="How"]').length,
        charter: all('ol.ch-fields > li').map((li) => li.className),
        tour: all('[data-tour-stop]').map((e) => e.getAttribute('data-tour-stop')),
        tabs,
        theme: document.documentElement.getAttribute('data-theme') || (localStorage.getItem('table-theme') ?? ''),
      };
    }).catch(() => null);
  }

  /** The charter's five lines as states (keys, rules, practice, agent, unlock), when it is on screen. */
  async charter() {
    const r = await this.read('main');
    if (!r || r.charter.length === 0) return null;
    const keys = ['keys', 'rules', 'practice', 'agent', 'unlock'];
    return Object.fromEntries(r.charter.map((cls, i) => {
      const c = cls.split(/\s+/);
      return [keys[i] ?? `line${i}`, c.includes('done') ? 'done' : c.includes('cur') || c.includes('waiting') ? 'next' : c.includes('todo') ? 'todo' : cls];
    }));
  }

  /** Mock only: the shared mock world as stored by the preview (an IPC-free read of its state). */
  async mockState() {
    if (this.mode !== 'mock') return null;
    const page = this.page('main') ?? this.page('approval');
    if (!page) return null;
    return page.evaluate(() => {
      const key = Object.keys(localStorage).filter((k) => k.startsWith('the-table-mock-state-') && k.endsWith(':first-run')).sort().pop();
      if (!key) return null;
      try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
    }).catch(() => null);
  }

  /**
   * Mock only: a counterparty step the core would record on its own (a signed NOTE from the brand
   * arriving on a deal), through the preview's own world handle. It moves nothing and calls nothing.
   */
  async mockNote(label, text) {
    if (this.mode !== 'mock') throw new Error('refused: counterparty injection exists only in the mock world');
    const page = this.page('main');
    return page.evaluate(async ([l, t]) => {
      const m = await import('/src/mock/backend.ts');
      m.mockBackend('main').world.note(l, t);
      return true;
    }, [label, text]);
  }

  /** Switch the theme from The Table's footer (a preference, never a decision). Returns the theme before. */
  async theme(want) {
    // The Table's footer has the switch; in the browser preview the approval window may stand in its tab.
    const main = this.page('main') ?? (this.mode === 'mock' ? this.page('approval') : null);
    if (!main) return null;
    const before = await main.evaluate(() => localStorage.getItem('table-theme') || 'dark').catch(() => null);
    if (before === want) return before;
    const btn = main.getByRole('button', { name: want === 'light' ? 'Light' : 'Dark', exact: true }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
    } else if (this.mode === 'mock') {
      // The approval window follows the stored theme through the storage event (lib/theme.ts); a
      // reload would lose an open sheet, so set it and tell the page as another window would.
      await main.evaluate((t) => {
        const old = localStorage.getItem('table-theme');
        localStorage.setItem('table-theme', t);
        window.dispatchEvent(new StorageEvent('storage', { key: 'table-theme', oldValue: old, newValue: t, storageArea: localStorage }));
        document.documentElement.setAttribute('data-theme', t);
      }, want);
    }
    await main.waitForTimeout(500);
    return before;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Start the mock world: the dev server (unless one is given) and a fresh Chromium context. */
export async function openMock(pw, o, log) {
  const server = await ensureVite(o, log);
  const browser = await pw.chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, headless: !o.headed });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: o.tz,
    reducedMotion: 'reduce',
  });
  // Pin the clock: every countdown, "in force for 30 days" and rule end in the mock world reads from
  // this start, so two dry-runs show the same words. Time still flows from it.
  await context.clock.install({ time: new Date(o.pinnedAt) });
  // A control that is not there is a dead end to record, not a 30 s stall.
  context.setDefaultTimeout(8000);
  const page = await context.newPage();
  const app = new App({ mode: 'mock', browser, context, base: server.base, firstRun: true, log });
  app.stop = async () => {
    await browser.close().catch(() => {});
    server.stop();
  };
  await page.goto(app.url('index.html'), { waitUntil: 'domcontentloaded' });
  return app;
}

/** Attach to the desktop app's WebView2 over CDP (WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS). */
export async function openLive(pw, o, log) {
  const browser = await pw.chromium.connectOverCDP(o.cdp, { timeout: 15_000 });
  const contexts = browser.contexts();
  if (contexts.length === 0) throw new Error(`connected to ${o.cdp} but it has no browser context`);
  const context = contexts[0];
  const app = new App({ mode: 'live', browser, context, base: null, firstRun: false, log });
  // Every window of the app shares one WebView2 environment, so its pages appear here; a window opened
  // later (the approval window) arrives as a new page on the same context (UNVERIFIED on a real desktop).
  for (const c of contexts.slice(1)) for (const p of c.pages()) app.watch(p);
  app.stop = async () => {
    // Detach only: closing would close the owner's windows.
    await browser.close().catch(() => {});
  };
  if (!app.page('main')) log(`  ! no page of The Table found over CDP yet; pages: ${context.pages().map((p) => p.url()).join(', ') || 'none'}`);
  return app;
}

async function reachable(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureVite(o, log) {
  if (o.url) {
    const base = o.url.endsWith('/') ? o.url : `${o.url}/`;
    if (!(await reachable(new URL('index.html', base)))) throw new Error(`no preview at ${base}index.html`);
    return { base, stop: () => {} };
  }
  const { spawn } = await import('node:child_process');
  const base = `http://localhost:${o.port}/`;
  if (await reachable(new URL('index.html', base))) {
    log(`  using the dev server already on port ${o.port}`);
    return { base, stop: () => {} };
  }
  const vite = join(o.client, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(vite)) throw new Error('vite is not installed: run pnpm install in apps/desktop/client, or pass --url');
  const child = spawn(process.execPath, [vite, '--port', String(o.port), '--strictPort'], { cwd: o.client, stdio: 'ignore' });
  const stop = () => {
    if (child.exitCode === null) {
      child.kill();
      if (process.platform === 'win32' && child.pid) {
        try { execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' }); } catch { /* gone */ }
      }
    }
  };
  process.on('exit', stop);
  for (let i = 0; i < 80; i++) {
    if (await reachable(new URL('index.html', base))) {
      log(`  started the dev server on port ${o.port} (stopped at the end)`);
      return { base, stop };
    }
    if (child.exitCode !== null) break;
    await sleep(500);
  }
  stop();
  throw new Error(`the dev server did not start on port ${o.port} (is the port free? pass --port)`);
}

/**
 * The fallback observer for the live app when CDP is not available: the wallet's own ledger, read
 * from a copy of the file (so the app's writes are never blocked), never through the app. It sees
 * rules, connections and deals; it cannot see saved PayPal keys (they live in the OS keychain).
 */
export function readLedger(file) {
  if (!file || !existsSync(file)) return null;
  const dir = mkdtempSync(join(tmpdir(), 'table-e2e-'));
  const copy = join(dir, 'wallet.copy.sqlite');
  try {
    copyFileSync(file, copy);
    // eslint-disable-next-line no-undef
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const db = new DatabaseSync(copy, { readOnly: true });
    const q = (sql) => { try { return db.prepare(sql).all(); } catch { return []; } };
    const out = {
      mandates: q("SELECT id, version, status, body_json FROM mandates WHERE status = 'active'").map((m) => ({ id: m.id, version: m.version, sells: /"sell"/.test(m.body_json), body: m.body_json.slice(0, 600) })),
      counterparties: q('SELECT key_id, display_name, paired_via, words_confirmed_at, declared_payee FROM counterparties'),
      deals: q('SELECT d.id, l.number, d.kind, d.side, d.state, d.item_ref, d.unit_price_minor, d.currency, d.decided_by, d.pp_order_id IS NOT NULL AS has_order, d.pp_capture_id IS NOT NULL AS has_capture, d.reconciliation, d.updated_at FROM deals d LEFT JOIN deal_labels l ON l.deal_id = d.id ORDER BY d.updated_at'),
    };
    db.close();
    return out;
  } catch (e) {
    return { error: String(e.message ?? e) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

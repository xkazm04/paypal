#!/usr/bin/env node
// Live e2e of the real desktop app (WebView2 over CDP): the Chat view and the Platform view.
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 target/debug/table-desktop.exe
//   PLAYWRIGHT=<path to playwright/index.mjs> node e2e/live/run.mjs [--cdp http://127.0.0.1:9222] [--out dir]
// It reads and navigates only: it never types into a credential field, never clicks a signing, pay,
// release or approve control, and detaches (never closes the owner's windows). Findings print as a
// table, are written to <out>/report.json, and the exit code is 1 when any check fails.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const cdp = arg('--cdp', 'http://127.0.0.1:9222');
const out = resolve(arg('--out', join(process.cwd(), 'e2e', 'live', 'out')));
mkdirSync(out, { recursive: true });
const pw = await import(process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : 'playwright');

const results = [];
const errors = [];
let shot = 0;
const rec = (area, name, ok, note = '') => { results.push({ area, name, ok, note }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${area}] ${name}${note ? ' - ' + note : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await pw.chromium.connectOverCDP(cdp, { timeout: 15000 });
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => !/tumbler|approval|arena|proof|director/.test(p.url()));
if (!page) { console.error('no main page over CDP; pages: ' + ctx.pages().map((p) => p.url()).join(', ')); process.exit(2); }
page.setDefaultTimeout(6000);
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 300)}`); });

async function snap(label) { const f = `${String(++shot).padStart(2, '0')}-${label}.png`; await page.screenshot({ path: join(out, f) }).catch(() => {}); return f; }
async function check(area, name, fn) {
  try { const r = await fn(); rec(area, name, r === undefined || r === true || (r && r.ok !== false), typeof r === 'object' && r?.note ? r.note : ''); }
  catch (e) { rec(area, name, false, String(e.message ?? e).split('\n')[0].slice(0, 220)); await snap('fail-' + name.replace(/\W+/g, '-').slice(0, 30)); }
}
/** True when the element's centre is what the user would hit (nothing sits on top of it). */
const onTop = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s); if (!el) return { ok: false, note: 'missing ' + s };
  const r = el.getBoundingClientRect(); if (!r.width || !r.height) return { ok: false, note: 'zero size ' + s };
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { ok: !!hit && (el === hit || el.contains(hit) || hit.contains(el)), note: hit ? `hit ${hit.tagName.toLowerCase()}.${String(hit.className).split(' ')[0]}` : 'nothing' };
}, sel);
const box = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
const view = () => page.evaluate(() => (document.querySelector('.cs-app') ? 'platform' : document.querySelector('.fs-app') ? 'chat' : 'none'));
async function goView(v) {
  if ((await view()) === v) return;
  await page.click(v === 'chat' ? '#cs-place-board' : '#cs-place-platform');
  await page.waitForSelector(v === 'chat' ? '.fs-app' : '.cs-app');
  await sleep(500);
}

await page.waitForSelector('.ah', { timeout: 20000 });
await sleep(1500);
await snap('start');

// ---------------------------------------------------------------- header
await check('header', 'brand, slogan, status dot and Find are present', async () => {
  for (const s of ['.ah-brand', '.ah-slogan', '#ah-status', '.ah-find']) if (!(await page.$(s))) return { ok: false, note: 'missing ' + s };
});
await check('header', 'status is a dot, no words', async () => {
  const t = (await page.textContent('#ah-status'))?.trim();
  return { ok: t === '' && !!(await page.getAttribute('#ah-status', 'aria-label')), note: `text="${t}"` };
});
await check('header', 'window buttons are present in the desktop shell', async () => ({ ok: (await page.$$('.ah-wb')).length === 3 }));
await check('header', 'the header sits above the app bar (no overlap)', async () => {
  const h = await box('.ah'); const a = await box('.cs-app, .fs-app');
  return { ok: !!h && !!a && a.t >= h.b - 1, note: `header bottom ${h?.b}, app top ${a?.t}` };
});

// ---------------------------------------------------------------- the switch, both views
for (const v of ['chat', 'platform']) {
  await goView(v);
  await check('switch', `${v}: Chat | Platform switch is at the right edge`, async () => {
    const b = await box('.cs-view'); const w = await page.evaluate(() => window.innerWidth);
    return { ok: !!b && w - b.r <= 40 && b.l > w / 2, note: b ? `right gap ${Math.round(w - b.r)}px` : 'missing' };
  });
  await check('switch', `${v}: the lit side is ${v === 'chat' ? 'Chat' : 'Platform'}`, async () => {
    const t = (await page.textContent('.cs-view [aria-current="page"]'))?.trim();
    return { ok: t === (v === 'chat' ? 'Chat' : 'Platform'), note: t };
  });
  await check('switch', `${v}: the switch is clickable (nothing on top)`, () => onTop('.cs-view'));
  await snap(`${v}-view`);
}
await check('switch', 'the switch is in the same place in both views', async () => {
  await goView('chat'); const a = await box('.cs-view');
  await goView('platform'); const b = await box('.cs-view');
  return { ok: Math.abs(a.r - b.r) <= 24 && Math.abs(a.t - b.t) <= 24, note: `chat right ${Math.round(a.r)} top ${Math.round(a.t)}; platform right ${Math.round(b.r)} top ${Math.round(b.t)}` };
});

// ---------------------------------------------------------------- platform
await goView('platform');
await check('platform', 'no "Quiet · Nothing can pay" presence row', async () => ({ ok: !(await page.$('.cs-presence')) && !/Nothing can pay until your charter is signed/.test(await page.evaluate(() => document.querySelector('.cs-app')?.textContent ?? '')) || (await page.$('.cs-presence')) === null }));
const tabs = await page.$$eval('.cs-tabrow [role="tab"]', (els) => els.map((e) => ({ id: e.id, text: e.textContent?.trim() })));
await check('platform', 'six module tabs', async () => ({ ok: tabs.length === 6, note: tabs.map((t) => t.id).join(' ') }));
for (const t of tabs) {
  await check('platform', `tab ${t.text?.replace(/\d+$/, '').trim()} opens and renders`, async () => {
    const before = errors.length;
    await page.click(`#${t.id}`, { timeout: 4000 });
    await sleep(700);
    const sel = await page.getAttribute(`#${t.id}`, 'aria-selected');
    const body = await page.evaluate(() => (document.querySelector('.cs-layer')?.textContent ?? '').trim().length);
    await snap('tab-' + t.id);
    return { ok: sel === 'true' && body > 20 && errors.length === before, note: `selected=${sel} text=${body}${errors.length > before ? ' new errors: ' + errors.slice(before).join(' | ') : ''}` };
  });
}

// ---------------------------------------------------------------- first run: every page offers the way forward
await check('setup', 'each module page offers "Finish setup" before setup is done', async () => {
  const missing = [];
  for (const t of tabs) { await page.click(`#${t.id}`); await sleep(500); if (!(await page.$('.ml-setup-btn'))) missing.push(t.text?.replace(/\d+$/, '').trim()); }
  return { ok: missing.length === 0, note: missing.length ? 'missing on ' + missing.join(', ') : '' };
});
await check('setup', '"Finish setup" opens the Set up page (at the first step still to do)', async () => {
  await page.click('.ml-setup-btn'); await sleep(900); await snap('setup-page');
  const t = await page.evaluate(() => document.querySelector('.cs-layer')?.textContent ?? '');
  return { ok: /charter/i.test(t) && /Line [IV]+ of V/i.test(t), note: t.slice(0, 60) };
});
await check('setup', 'the copy says Signet, not "The Table"', async () => {
  const t = await page.evaluate(() => document.body.innerText);
  return { ok: !/The Table/.test(t), note: (t.match(/.{0,30}The Table.{0,30}/) ?? [''])[0] };
});

// ---------------------------------------------------------------- places menu
await check('places', 'the Places menu button is clickable (not hidden behind a layer)', () => onTop('#cs-place-menu'));
await check('places', 'the Places menu opens in front of everything', async () => {
  await page.click('#cs-place-menu'); await sleep(400);
  const r = await onTop('[role="menu"]');
  const items = await page.$$('[role="menuitem"]');
  await snap('places-open');
  return { ok: r.ok && items.length >= 5, note: `${r.note}, ${items.length} items` };
});
const itemIds = await page.$$eval('[role="menuitem"]', (els) => els.map((e) => ({ id: e.id, text: e.textContent?.trim() })));
for (const it of itemIds) {
  await check('places', `menu item "${it.text}" is reachable and opens`, async () => {
    if (!(await page.$('[role="menu"]'))) { await page.click('#cs-place-menu'); await sleep(300); }
    const r = await onTop('#' + it.id);
    if (!r.ok) return r;
    const before = errors.length;
    await page.click('#' + it.id); await sleep(800);
    await snap('place-' + it.id);
    const hasHeading = await page.evaluate(() => (document.querySelector('.cs-layer, .cs-stage')?.textContent ?? '').trim().length > 20);
    return { ok: hasHeading && errors.length === before, note: errors.length > before ? errors.slice(before).join(' | ') : '' };
  });
}
await check('places', 'Escape closes the menu', async () => {
  if (!(await page.$('[role="menu"]'))) { await page.click('#cs-place-menu'); await sleep(300); }
  await page.keyboard.press('Escape'); await sleep(300);
  return { ok: !(await page.$('[role="menu"]')) };
});

// ---------------------------------------------------------------- find
await check('find', 'Find opens from the header and closes on Escape', async () => {
  await page.click('.ah-find'); await sleep(500);
  const open = await page.evaluate(() => !!document.querySelector('[role="dialog"], .cs-find, [data-find]'));
  await snap('find-open');
  await page.keyboard.press('Escape'); await sleep(300);
  return { ok: open, note: open ? '' : 'no dialog after click' };
});

// ---------------------------------------------------------------- chat
await goView('chat');
await check('chat', 'greeting and ask box render', async () => ({ ok: !!(await page.$('.fs-input')) && !!(await page.$('.fs-talk')) }));
await check('chat', 'the ask box is not covered', () => onTop('.fs-input'));
const flows = [['/rules', 'rules'], ['/settings', 'settings'], ['/connect', 'connections'], ['/rewind', 'rewind']];
for (const [cmd, kind] of flows) {
  await check('chat', `${cmd} opens the ${kind} step card, Cancel leaves it`, async () => {
    await page.fill('.fs-input', cmd); await page.press('.fs-input', 'Enter');
    const locked = page.waitForSelector('text=/wallet is locked/i', { timeout: 5000 }).then(() => 'locked');
    const card = page.waitForSelector(`.fc[data-flow="${kind}"]`, { timeout: 5000 }).then(() => 'card');
    if ((await Promise.race([locked, card])) === 'locked') { await snap('flow-' + kind + '-locked'); return { ok: true, note: 'wallet locked: said so, no card (expected on a fresh wallet)' }; }
    await snap('flow-' + kind);
    const text = (await page.textContent(`.fc[data-flow="${kind}"]`))?.length ?? 0;
    const body = await page.evaluate((k) => document.querySelector(`.fc[data-flow="${k}"] .fc-body`)?.textContent?.trim().length ?? 0, kind);
    const cancel = await page.$(`.fc[data-flow="${kind}"] .fc-cancel`);
    if (cancel) { await cancel.click(); await sleep(300); }
    return { ok: text > 20 && body > 10 && !!cancel, note: `card text ${text}, body ${body}` };
  });
}
await check('chat', 'a typed change-request starts a flow ("change my limits")', async () => {
  await page.fill('.fs-input', 'change my limits'); await page.press('.fs-input', 'Enter');
  const r = await Promise.race([page.waitForSelector('.fc[data-flow="rules"]', { timeout: 5000 }).then(() => 'card'), page.waitForSelector('text=/wallet is locked/i', { timeout: 5000 }).then(() => 'locked')]);
  if (r === 'card') await page.click('.fc[data-flow="rules"] .fc-cancel');
  return { ok: true, note: r };
});
await check('chat', 'a question goes to the assistant, not a flow', async () => {
  await page.fill('.fs-input', 'why was the last rule broken?'); await page.press('.fs-input', 'Enter'); await sleep(800);
  return { ok: !(await page.$('.fc[data-flow]:not(.fc-folded)')) };
});
await check('chat', 'the Platform switch round-trips back to Chat', async () => {
  await goView('platform'); await goView('chat'); return { ok: (await view()) === 'chat' };
});

// ---------------------------------------------------------------- the other windows (opened, looked at, never clicked inside)
await goView('platform');
await check('windows', 'the current setup step hands off to the approval window', async () => {
  await page.click(`#${tabs[0].id}`); await sleep(400); await page.click('.ml-setup-btn'); await sleep(800);
  if (!(await page.$('text=/↗/'))) return { ok: true, note: 'no handoff on this step (done, or no approval needed)' };
  await page.click('text=/↗/');
  const ap = await ctx.waitForEvent('page', { timeout: 10000 }).catch(() => null) ?? ctx.pages().find((p) => /approval/.test(p.url()));
  if (!ap) return { ok: false, note: 'no approval window page' };
  await ap.waitForLoadState('domcontentloaded').catch(() => {}); await sleep(1500);
  await ap.screenshot({ path: join(out, `${String(++shot).padStart(2, '0')}-approval-window.png`) }).catch(() => {});
  const text = await ap.evaluate(() => document.body.innerText).catch(() => '');
  return { ok: text.length > 40 && !/The Table/.test(text), note: text.slice(0, 80).replaceAll('\n', ' / ') };
});
await check('windows', 'the tumbler (mini window) renders', async () => {
  const tp = ctx.pages().find((p) => /tumbler/.test(p.url()));
  if (!tp) return { ok: false, note: 'no tumbler page' };
  await tp.screenshot({ path: join(out, `${String(++shot).padStart(2, '0')}-tumbler.png`) }).catch(() => {});
  const text = await tp.evaluate(() => document.body.innerText).catch(() => '');
  return { ok: !/The Table/.test(text), note: text.slice(0, 80).replaceAll('\n', ' / ') };
});

await check('app', 'no page errors or console errors during the run', async () => ({ ok: errors.length === 0, note: errors.slice(0, 3).join(' | ') }));
await snap('end');

const failed = results.filter((r) => !r.ok);
writeFileSync(join(out, 'report.json'), JSON.stringify({ at: new Date().toISOString(), cdp, results, errors }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed; report in ${out}`);
await browser.close().catch(() => {});
process.exit(failed.length ? 1 : 0);

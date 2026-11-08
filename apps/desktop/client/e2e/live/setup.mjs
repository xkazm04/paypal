#!/usr/bin/env node
// Autonomous owner setup on the real shell (WebView2 over CDP): signs the ready-made shopper rules and unlocks.
// Needs: the keys stored (scripts/sandbox/store-keys.ps1) and the shell started as a debug build with
//   TABLE_E2E_AUTOUNLOCK=1 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
// (the auto-unlock stand-in for Windows Hello exists only in debug builds; see crates/table-runtime/src/reauth.rs).
// Idempotent: a step already done is skipped. Moves no money: it signs rules in the sandbox wallet.
import { pathToFileURL } from 'node:url';
const pw = await import(process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : 'playwright');
const sl = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await pw.chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222');
const ctx = b.contexts()[0];
const main = ctx.pages().find((p) => !/tumbler|approval/.test(p.url()));
const step = (s) => console.log('setup: ' + s);
await main.click('#cs-place-platform').catch(() => {});
await main.waitForSelector('.cs-app');
await sl(600);
// Unlock first when the wallet is locked (the debug stand-in answers the prompt).
if (await main.$('.lockbtn')) {
  const locked = /Locked/.test((await main.textContent('.lockbtn')) ?? '');
  if (locked) {
    step('unlocking');
    const opened = ctx.waitForEvent('page', { timeout: 10000 }).catch(() => null);
    await main.click('.lockbtn');
    const ap = (await opened) ?? ctx.pages().find((p) => /approval/.test(p.url()));
    await sl(1500);
    await ap.click('button:has-text("Unlock with your fingerprint")').catch(() => {});
    await sl(2000);
  }
}
await main.click('#cs-tab-tables'); await sl(400);
if (!(await main.$('.ml-setup-btn'))) { step('already set up'); await b.close(); process.exit(0); }
step('setup not finished: continuing');
await main.click('.ml-setup-btn'); await sl(800);
const text = () => main.evaluate(() => document.querySelector('.cs-layer')?.textContent ?? '');
if (/Line I of V/i.test(await text()) && !/keys saved/i.test(await text())) { console.error('setup: the PayPal keys are not stored: run scripts/sandbox/store-keys.ps1'); process.exit(2); }
if (await main.$('button:has-text("Next step")')) { await main.click('button:has-text("Next step")'); await sl(800); }
if (await main.$('button:has-text("Sign rules")')) {
  step('signing the shopper rules');
  const opened = ctx.waitForEvent('page', { timeout: 10000 }).catch(() => null);
  await main.click('button:has-text("Sign rules")');
  const ap = (await opened) ?? ctx.pages().find((p) => /approval/.test(p.url()));
  await sl(2000);
  await ap.click('text=Careful: asks me above $50'); await sl(800);
  await ap.fill('input[placeholder^="e.g. packrite"]', 'house-seller'); await sl(600);
  await ap.click('button:has-text("Review & sign rules")'); await sl(1200);
  await ap.click('button:has-text("Unlock with your fingerprint")'); await sl(2000);
  await ap.click('button:has-text("Sign with your owner key")'); await sl(2000);
  const done = /Signed with your owner key/.test(await ap.evaluate(() => document.body.innerText));
  step(done ? 'rules signed, wallet unlocked' : 'FAILED: no signed confirmation');
  await b.close();
  process.exit(done ? 0 : 1);
}
step('nothing to sign on this step: ' + (await text()).slice(0, 80));
await b.close();

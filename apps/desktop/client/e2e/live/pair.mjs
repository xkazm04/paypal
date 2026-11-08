#!/usr/bin/env node
// Autonomous practice-shop connection on the real shell (needs the local house: scripts/dev/local-house.ps1, and
// the shell started with TABLE_RELAY_URL, TABLE_E2E_ALLOW_HTTP_RELAY=1 and TABLE_E2E_AUTOUNLOCK=1).
// Connects with the house seller, ticks the four words, and confirms in the approval window. Idempotent.
import { pathToFileURL } from 'node:url';
const pw = await import(process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : 'playwright');
const sl = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await pw.chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9222');
const ctx = b.contexts()[0];
const main = ctx.pages().find((p) => !/tumbler|approval/.test(p.url()));
const step = (s) => console.log('pair: ' + s);
const shot = process.argv[3];
const desk = () => main.evaluate(() => document.querySelector('.pair-desk')?.innerText ?? '');
if (await main.$('button:has-text("Next step")')) {
  for (let i = 0; i < 3 && (await main.$('button:has-text("Next step")')); i++) { await main.click('button:has-text("Next step")'); await sl(700); }
}
let t = await desk();
if (/Connect with the house/.test(t) && (await main.$('input[placeholder^="your PayPal email"]'))) {
  step('connecting with the house');
  await main.fill('input[placeholder^="your PayPal email"]', 'signet-demo');
  await main.click('button:has-text("Connect with the house")');
  await sl(6000);
  t = await desk();
}
if (/Match 4 words/.test(t) && !/Confirm in the approval/.test(t) && (await main.$('.pair-desk .words'))) {
  step('ticking the four words');
  const ticks = await main.$$('.pair-desk .words button');
  for (const k of ticks) { await k.click().catch(() => {}); await sl(150); }
  await main.click('button:has-text("All four match")').catch(() => {});
  await sl(1500);
}
if (await main.$('button:has-text("Keep the practice agent for now")')) {
  step('keeping the practice agent');
  await main.click('button:has-text("Keep the practice agent for now")');
  await sl(1500);
}
if (shot) await main.screenshot({ path: shot });
console.log((await desk()).slice(0, 600));
await b.close();

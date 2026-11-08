#!/usr/bin/env node
// Opens a practice table with the house seller and joins it: Tables > Open a table > House seller > words >
// confirm > "Join the table" > pick rules > join. Needs the local house (scripts/dev/local-house.ps1) and signed haggle rules.
import { pathToFileURL } from 'node:url';
const pw = await import(process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : 'playwright');
const sl = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await pw.chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = b.contexts()[0];
const main = ctx.pages().find((p) => !/tumbler|approval/.test(p.url()));
main.setDefaultTimeout(10000);
const log = (s) => console.log('table: ' + s);
const ap = () => ctx.pages().find((p) => /approval/.test(p.url()));
const clickAp = async (t) => { const a = ap(); if (a && (await a.$(`button:has-text("${t}")`))) { await a.click(`button:has-text("${t}")`).catch(() => {}); await sl(1800); return true; } return false; };
if (!(await main.$('.cs-app'))) await main.click('#cs-place-platform');
await main.waitForSelector('.cs-app');
await main.click('#cs-tab-tables'); await sl(600);
await main.click('button:has-text("Open a table")'); await sl(900);
await main.click('.pair-desk button:has-text("House seller")'); await sl(600);
if (await main.$('input[placeholder^="your PayPal email"]')) await main.fill('input[placeholder^="your PayPal email"]', 'signet-demo');
log('asking the house for a table');
await main.click('.pair-desk button[type="submit"]'); await sl(6000);
log('ticking the words');
for (const k of await main.$$('.pair-desk .words button')) { await k.click().catch(() => {}); await sl(150); }
await main.click('button:has-text("All four match")'); await sl(2500);
for (const t of ['Use “House seller”', 'Unlock with fingerprint', 'All four match: connect']) await clickAp(t);
await sl(1500);
log('joining the table');
await main.click('button:has-text("Join the table")'); await sl(2500);
const a = ap();
const select = await a.$('select');
if (select) { const opts = await select.$$eval('option', (o) => o.map((x) => ({ v: x.value, t: x.textContent }))); log('rule sets: ' + JSON.stringify(opts)); const pick = [...opts].reverse().find((o) => o.v); if (pick) await select.selectOption(pick.v); }
await sl(800);
await clickAp('Unlock with fingerprint');
await clickAp('Join the table');
await sl(3000);
log('approval says: ' + ((await ap()?.evaluate(() => document.body.innerText).catch(() => '')) ?? '').replace(/\s+/g, ' ').slice(0, 300));
await main.screenshot({ path: 'e2e/live/look.png' });
await b.close();

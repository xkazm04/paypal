#!/usr/bin/env node
// Lists (and optionally clicks) the approval window's buttons: node approval.mjs [click "text"]... Used to script steps.
import { pathToFileURL } from 'node:url';
const pw = await import(process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : 'playwright');
const sl = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await pw.chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = b.contexts()[0];
const ap = ctx.pages().find((p) => /approval/.test(p.url()));
if (!ap) { console.log('no approval page'); await b.close(); process.exit(1); }
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  if (args[i] === 'click') { await ap.click(`button:has-text("${args[i + 1]}")`); await sl(1800); }
}
console.log(await ap.evaluate(() => [...document.querySelectorAll('button')].filter((b) => !b.disabled).map((b) => b.textContent.trim()).filter(Boolean).join(' | ')));
console.log('---');
console.log((await ap.evaluate(() => document.body.innerText)).slice(0, 700));
await ap.screenshot({ path: 'e2e/live/approval.png' });
await b.close();

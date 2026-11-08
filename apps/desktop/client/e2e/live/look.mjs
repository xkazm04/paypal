// node look.mjs <selector-to-click|-> : shows the main window's visible buttons and text, screenshot e2e/live/look.png
import { pathToFileURL } from 'node:url';
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT).href);
const b = await pw.chromium.connectOverCDP('http://127.0.0.1:9222'); const ctx = b.contexts()[0];
const main = ctx.pages().find((p) => !/tumbler|approval/.test(p.url()));
const sl = (ms) => new Promise((r) => setTimeout(r, ms));
for (const a of process.argv.slice(2)) { await main.click(a); await sl(900); }
console.log(await main.evaluate(() => [...document.querySelectorAll('.cs-layer button, .cs-layer a')].filter((e) => e.offsetParent).map((e) => e.textContent.trim().slice(0, 50)).filter(Boolean).join(' | ')));
console.log('---'); console.log((await main.evaluate(() => document.querySelector('.cs-layer')?.innerText ?? '')).slice(0, 600));
await main.screenshot({ path: 'e2e/live/look.png' }); await b.close();

// Ticks the four words on the main window's pairing desk and presses "All four match".
import { pathToFileURL } from 'node:url';
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT).href);
const b = await pw.chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = b.contexts()[0];
const main = ctx.pages().find((p) => !/tumbler|approval/.test(p.url()));
const sl = (ms) => new Promise((r) => setTimeout(r, ms));
for (const k of await main.$$('.pair-desk .words button')) { await k.click().catch(() => {}); await sl(150); }
await main.click('button:has-text("All four match")');
await sl(2000);
await b.close();

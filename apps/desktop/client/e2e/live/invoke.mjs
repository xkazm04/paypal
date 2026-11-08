// node invoke.mjs <command> [json args]: calls a main-window Tauri command and prints a short digest of the answer.
import { pathToFileURL } from 'node:url';
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT).href);
const b = await pw.chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = b.contexts()[0];
const main = ctx.pages().find((p) => !/tumbler|approval/.test(p.url()));
const out = await main.evaluate(async ([cmd, args]) => {
  try { return JSON.stringify(await window.__TAURI_INTERNALS__.invoke(cmd, args)); } catch (e) { return 'ERR ' + JSON.stringify(e); }
}, [process.argv[2], process.argv[3] ? JSON.parse(process.argv[3]) : {}]);
console.log(out.slice(0, 3000));
await b.close();

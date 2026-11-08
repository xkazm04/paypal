#!/usr/bin/env node
// Walks the Chat's /rules flow to the end and signs in the approval window (debug auto-unlock). Logs each card.
import { pathToFileURL } from 'node:url';
const pw = await import(process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : 'playwright');
const sl = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await pw.chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = b.contexts()[0];
const main = ctx.pages().find((p) => !/tumbler|approval/.test(p.url()));
main.setDefaultTimeout(8000);
await main.waitForSelector('.cs-app, .fs-app');
if (!(await main.$('.cs-app'))) await main.click('#cs-place-platform');
await main.waitForSelector('.lockbtn');
for (let i = 0; i < 30; i++) { const t = (await main.textContent('.lockbtn').catch(() => '')) ?? ''; if (/Unlocked/.test(t)) break; await sl(1000); }
if (!(await main.$('.fs-app'))) await main.click('#cs-place-board');
await main.waitForSelector('.fs-input');
await main.fill('.fs-input', '/rules');
await main.press('.fs-input', 'Enter');
const card = () => main.evaluate(() => { const c = document.querySelector('.fc:not(.fc-folded)'); return c ? { step: c.getAttribute('data-step'), text: c.innerText.replace(/\s+/g, ' ').slice(0, 220), buttons: [...c.querySelectorAll('button')].map((x) => x.textContent.trim()) } : null; });
for (let i = 0; i < 12; i++) {
  await sl(700);
  const c = await card();
  console.log('card:', JSON.stringify(c));
  if (!c) break;
  if (c.step === 'sign') break;
  const first = c.buttons.find((t) => /^for a week/.test(t)) ?? c.buttons.find((t) => /^Keep|^for a|^Sign|^Yes|^Looks|^Continue/i.test(t) && t !== 'Cancel') ?? c.buttons.find((t) => t !== 'Cancel');
  if (!first) break;
  await main.click(`.fc:not(.fc-folded) button:has-text("${first}")`);
}
await sl(2500);
const ap = ctx.pages().find((p) => /approval/.test(p.url()));
if (ap) {
  console.log('approval buttons:', await ap.evaluate(() => [...document.querySelectorAll('button')].filter((x) => !x.disabled).map((x) => x.textContent.trim()).filter(Boolean).join(' | ')));
  for (const t of ['Review & sign rules', 'Unlock with fingerprint', 'Sign with your owner key']) {
    if (await ap.$(`button:has-text("${t}")`)) { await ap.click(`button:has-text("${t}")`).catch(() => {}); await sl(1800); }
  }
  console.log('approval text:', (await ap.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 300));
}
await sl(2500);
console.log('final card:', JSON.stringify(await card()));
console.log('folded:', await main.evaluate(() => [...document.querySelectorAll('.fc-folded')].map((e) => e.textContent).join(' / ')));
await main.screenshot({ path: 'e2e/live/look.png' });
await b.close();

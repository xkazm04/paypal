// The YouTube sponsorship case as twelve beats, from first launch to money confirmed. The runbook
// (docs/e2e/youtube-sponsorship.md) tells the same story in words; this file is what runs it.
//
// Each beat says who acts (script, owner, brand), which screens it touches, what done looks like,
// and how the harness sees it done:
//   script(app, ctx)   what the harness itself does (navigation, reading, the tour; never a decision)
//   card               the "You do this" card for an owner or brand step
//   detect(app, ctx)   a passive read (DOM, mock store, or the ledger copy) that returns a signal
//                      string once the step is done, else null; it never navigates while it waits
//   simulate(app, ctx) mock only: the owner's clicks, through the mock's own approval window
//   reference(app,ctx) mock only: where the first-run world cannot reach a beat, the same screen on
//                      the preview's sample week, shown as "reference on sample data"
//   gaps               what the product does not support for this beat (recorded, never faked)

const B = (ctx) => ctx.briefs;
const brand = (ctx, id) => B(ctx).brands.find((b) => b.id === id);
const R = (ctx) => B(ctx).creator.rules;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
/** A deal state word on screen, not "Paid to" / "Paid out today" / "Paid in" labels. */
const PAID = /\b(Paid|Collected)\b(?! (to|out|in)\b)(?!:)/;

/** A deal of this case in the mock store (seller haggle for a brand), by the brand's display name. */
function mockDealFor(state, brandName) {
  if (!state) return null;
  const cp = state.counterparties.find((c) => c.display_name === brandName);
  if (!cp) return null;
  return state.deals.find((d) => d.deal.side === 'seller' && d.deal.counterparty === cp.key_id) ?? null;
}

/** A live deal of this case in the ledger copy (seller haggle on one of the case's items). */
function ledgerDeal(ctx) {
  const l = ctx.ledger?.();
  if (!l || !l.deals) return null;
  const items = R(ctx).items;
  return [...l.deals].reverse().find((d) => d.side === 'seller' && items.includes(d.item_ref)) ?? null;
}

async function charterIs(app, key) {
  const c = await app.charter();
  return c && c[key] === 'done' ? `charter line "${key}" reads signed` : null;
}

async function bodyHas(app, win, re) {
  const r = await app.read(win);
  const m = r?.body.match(re);
  return m ? `${win} shows "${m[0].slice(0, 80)}"` : null;
}

/** Click if present; a missing control is a dead end the friction log records, not a crash. */
async function tryClick(app, ctx, win, locate, why, opts = {}) {
  try {
    await app.click(win, locate, why, opts);
    return true;
  } catch (e) {
    ctx.friction({ kind: 'dead-end', severity: 'high', window: win, text: `could not ${why}: ${String(e.message).split('\n')[0]}` });
    return false;
  }
}

const byRole = (role, name, exact = false) => (p) => p.getByRole(role, { name, exact });
const byText = (text, exact = false) => (p) => p.getByText(text, { exact });

/** Mock: the approval window the last hand-off opened (or open it at its address as a fallback). */
async function approval(app, ctx, fallbackPath) {
  let p = await app.waitWindow('approval', 6000);
  if (!p && fallbackPath) {
    ctx.friction({ kind: 'dead-end', severity: 'medium', window: 'main', text: `the hand-off did not open the approval window; opened ${fallbackPath} directly (harness fallback)` });
    p = await app.context.newPage();
    await p.goto(app.url(fallbackPath), { waitUntil: 'domcontentloaded' });
  }
  if (p) await p.waitForTimeout(1500);
  return p;
}

/** Leave the approval window. In the browser preview it replaced The Table in the same tab (demo
 *  mode), so this is its own "Back to The Table"; a separate approval page is closed. */
async function closeApproval(app) {
  await app.ensureMain();
}

// ---- the mock's owner steps, written once ------------------------------------------------------------

async function simulateConnect(app, ctx, b) {
  await app.route('#p=pairing');
  await tryClick(app, ctx, 'main', byRole('button', 'I have a code', true), 'choose "I have a code"', { simulated: true });
  await app.fill('main', 'input[placeholder="the code they gave you"]', b.code, 'type the brand\'s code', { simulated: true });
  await tryClick(app, ctx, 'main', byRole('button', 'Sell', true), 'say "In this deal you: Sell"', { simulated: true });
  await app.fill('main', '#pp-payee', B(ctx).creator.payee, 'type who is paid (the creator)', { simulated: true });
  await tryClick(app, ctx, 'main', (p) => p.locator('form.pair-desk button[type=submit]'), 'press Join', { simulated: true });
  await confirmWords(app, ctx, b.name);
}

/** After Join / Connect: the four words, in The Table if it shows them, then in the approval window. */
async function confirmWords(app, ctx, name) {
  const s = { simulated: true };
  await pause(1500);
  // The Table may show the words to tick first; in the preview the hand-off can come straight away.
  if (!app.page('approval') && app.page('main')) {
    const words = app.page('main').locator('ol.words button');
    const n = await words.count();
    for (let i = 0; i < n; i++) await tryClick(app, ctx, 'main', () => words.nth(i), `tick word ${i + 1} as seen`, s);
    if (n) await tryClick(app, ctx, 'main', byRole('button', 'All four match', true), 'press "All four match"', s);
    ctx.data.wordsTickedInTable = n > 0;
  }
  const ap = await approval(app, ctx, null);
  if (!ap) {
    ctx.friction({ kind: 'dead-end', severity: 'high', window: 'main', text: 'the approval window did not open to confirm the four words' });
    return;
  }
  await app.fill('approval', '#ow-pname', name, 'name them (only the owner sees it)', s);
  await tryClick(app, ctx, 'approval', byRole('button', 'All four match: connect', true), 'press "All four match: connect"', s);
  await pause(1200);
  const done = await app.read('approval');
  ctx.data[`connected:${name}`] = done?.headings.find((h) => /Connected/.test(h)) ?? null;
  const ok = app.page('approval')?.getByRole('button', { name: 'Done', exact: true }).first();
  if (ok && (await ok.isVisible().catch(() => false))) await tryClick(app, ctx, 'approval', () => ok, 'press "Done"', s);
}

async function simulateOpenTable(app, ctx, b) {
  // The pairing desk's gold "Open a table ↗" after connecting; else the approval window's own entry.
  const main = app.page('main');
  const handoff = main?.getByRole('button', { name: /Open a table/ }).first();
  if (handoff && (await handoff.isVisible().catch(() => false))) {
    await tryClick(app, ctx, 'main', () => handoff, 'press "Open a table ↗"', { simulated: true });
  } else {
    // Browser preview: the approval window replaced The Table in this tab, so the pairing desk's
    // "Open a table ↗" (its own state) is gone when the owner comes back. The approval window's wallet
    // setup has the same sheet ("Tables › Open a table…").
    ctx.data.previewOpenTablePath = 'approval window › wallet setup › Open a table…';
    const p = app.page('main') ?? app.page('approval');
    await p.goto(app.url('approval.html'), { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1500);
    await tryClick(app, ctx, 'approval', byRole('button', 'Open a table…', true), 'press "Open a table…" (approval window › Tables)', { simulated: true });
  }
  const ap = await approval(app, ctx, null);
  if (!ap) return;
  await ap.waitForTimeout(800);
  // Who: the brand by name; the rest follows the signed rules (kind, item), then quantity and price.
  const who = ap.locator('.ow-tbl select').first();
  const opts = await who.locator('option').allInnerTexts().catch(() => []);
  const pick = opts.find((o) => o.includes(b.name));
  if (pick) await who.selectOption({ label: pick }, { timeout: 3000 }).catch(() => {});
  else ctx.friction({ kind: 'dead-end', severity: 'high', window: 'approval', text: `"Who" does not list ${b.name} (options: ${opts.join(', ') || 'none'})` });
  const item = ap.locator('.ow-tbl select.mono').first();
  if (await item.isVisible().catch(() => false)) await item.selectOption(b.item, { timeout: 3000 }).catch(() => ctx.friction({ kind: 'dead-end', severity: 'medium', window: 'approval', text: `item ${b.item} is not offered under the signed rules` }));
  const fields = ap.locator('.ow-tbl input.num');
  if ((await fields.count()) >= 2) {
    await fields.nth(0).fill(String(b.qty));
    await fields.nth(1).fill(b.creator_asks);
    app.clicks.push({ window: 'approval', words: `type quantity ${b.qty} and asking price ${b.creator_asks}`, why: 'fill the table', simulated: true, t: Date.now() });
  }
  await tryClick(app, ctx, 'approval', byRole('button', 'Open the table', true), 'press "Open the table"', { simulated: true });
  await ap.waitForTimeout(1200);
}

// ---- the beats ----------------------------------------------------------------------------------------

export const BEATS = [
  {
    id: 'day-one',
    title: 'Day one: The Table opens on a brand-new wallet',
    actor: 'script',
    screens: ['The Table: charter (first run)', 'tour coach marks'],
    expected: 'The charter with five lines (keys, rules, practice deal, agent app, unlock); PayPal keys next; a tour walks the stops.',
    success: 'Charter visible with line I next; the tour shows "Tour · 1 of N" and can be walked to the end.',
    async script(app, ctx) {
      const main = app.page('main');
      await main.waitForTimeout(2500);
      const before = await app.read('main');
      ctx.signal(`charter lines: ${(await app.charter()) ? JSON.stringify(await app.charter()) : 'not on screen'}`);
      // Walk The Table's tour to the end, as a first-time owner would (Next until it is gone).
      const stops = [];
      for (let i = 0; i < 8; i++) {
        const r = await app.read('main');
        if (!r?.tour.length) break;
        const mark = main.locator('[data-tour-stop]').first();
        stops.push((await mark.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 90));
        const next = main.getByRole('button', { name: /^(Next|Finish)$/ }).first();
        if (!(await next.isVisible().catch(() => false))) break;
        await app.click('main', () => next, `tour stop ${i + 1}: Next`);
      }
      ctx.data.tourStops = stops;
      if (stops.length === 0) ctx.friction({ kind: 'what-next', severity: 'low', window: 'main', text: 'no tour on day one (already seen in this profile?)' });
      if (!before?.charter.length) ctx.friction({ kind: 'where-am-i', severity: 'high', window: 'main', text: 'day one did not open on the charter' });
    },
    detect: async (app) => ((await app.read('main'))?.charter.length ? 'charter on screen' : null),
  },
  {
    id: 'paypal-keys',
    title: 'Add the PayPal sandbox keys',
    actor: 'owner',
    screens: ['The Table: charter line I', 'approval window: wallet setup', 'Windows: secure credential dialog', 'Windows Hello'],
    expected: 'Keys saved in the OS keychain; line I reads signed; the approval window says "PayPal sandbox keys saved".',
    success: 'Charter line I is ticked in The Table and the approval window agrees.',
    card: {
      where: 'The Table › your wallet’s charter › line I "PayPal keys" › "Add PayPal keys ↗" (it opens the approval window)',
      steps: [
        'Have your PayPal sandbox app ready: developer.paypal.com › Apps & Credentials › Sandbox › your app › Client ID and Secret.',
        'In The Table press "Add PayPal keys ↗". The approval window opens beside it.',
        'If it says Locked, press "Unlock with Windows Hello" and confirm with your face, finger or PIN.',
        'Press "Add PayPal keys…". A Windows dialog asks for the Client ID and the Secret: paste them there (never into a web page).',
        'Close the dialog. Leave the approval window open or press "Back to The Table".',
      ],
      done: 'The approval window reads "PayPal sandbox keys saved" and The Table\'s charter line I reads "signed".',
    },
    detect: async (app) => (await charterIs(app, 'keys')) || (await bodyHas(app, 'approval', /PayPal sandbox keys saved/)),
    async simulate(app, ctx) {
      await tryClick(app, ctx, 'main', byRole('button', 'Add PayPal keys ↗'), 'press "Add PayPal keys ↗"', { simulated: true });
      const ap = await approval(app, ctx, 'approval.html?target=credentials');
      if (!ap) return;
      await tryClick(app, ctx, 'approval', byRole('button', /^Add (PayPal )?keys…$/), 'press "Add PayPal keys…" (the mock saves at once: no dialog, no real keys)', { simulated: true });
    },
    gaps: ['The keys are not checked against PayPal when saved (onboarding.md): a wrong key shows only at the first PayPal call.'],
  },
  {
    id: 'agent-app',
    title: 'Choose the agent app',
    actor: 'owner',
    screens: ['The Table: charter line IV "Your agent"'],
    expected: 'claude-code or codex-cli chosen when ready, else the practice agent kept on purpose; line IV reads signed.',
    success: 'Charter line IV is ticked.',
    card: {
      where: 'The Table › charter › line IV "Your agent"',
      steps: [
        'Click line IV "Your agent".',
        'If claude-code or codex-cli says it is ready, choose it. If both say "not connected", press "Keep the practice agent for now" (the wallet\'s own negotiator plays your tables; you can add an app later).',
      ],
      done: 'Line IV reads "signed" ("Practice agent kept…" or the app you chose).',
    },
    detect: async (app) => (await charterIs(app, 'agent')) || (await bodyHas(app, 'main', /Practice agent kept/)),
    async simulate(app, ctx) {
      await app.route('#s=setup');
      await tryClick(app, ctx, 'main', (p) => p.locator('ol.ch-fields > li').nth(3), 'open charter line IV', { simulated: true });
      // What the owner reads before choosing: the two agent apps and why they are not available.
      await ctx.checkScreen('main');
      await ctx.shoot('agent-choice');
      await tryClick(app, ctx, 'main', byRole('button', 'Keep the practice agent for now', true), 'press "Keep the practice agent for now"', { simulated: true });
    },
    gaps: ['The native agent apps report "not connected" until their isolation check passes (agents-and-engines.md); only the practice agent negotiates today.'],
  },
  {
    id: 'selling-rules',
    title: 'Sign the sponsorship selling rules',
    actor: 'owner',
    screens: ['The Table: charter line II and its Say it box', 'approval window: rules editor, sign sheet'],
    expected: 'One signed rule set: sell, haggle, category service, items yt-sponsor-60s and yt-shoutout-15s, least you\'ll accept $1,200, most per deal $3,000, $5,000 and 2 deals a day, ask me above $2,000, approved payee creator-studio.',
    success: 'Charter line II ticked; Rules shows one rule set; the approval window says "Signed with your owner key".',
    card: {
      where: 'The Table › charter › line II "Your rules · in the approval window" › the hand-off to the approval window (or the approval window › Agent rules › "Sign your first rules…")',
      steps: [
        'In the rules editor, ignore the three ready-made rule sets: they are all for buying.',
        'Click "What agents may do": tick sell, untick buy.',
        '"Add a rule" four times: Limit per deal, Price range, Daily limit, Approved payees.',
        'Click "What they may buy" (the per-deal row): set "haggle" and tick service.',
        'Click "Items with a price range": type yt-sponsor-60s, yt-shoutout-15s',
        'Click "Approved payees": type creator-studio (or your sandbox business email).',
        'Levers: Most per deal 3000.00 · Least you\'ll accept 1200.00 (offers 6, until: pick a date 14 days out) · Most per day 5000.00 with 2 deals · Ask me above 2000.00.',
        'Press "Review & sign rules…", read "In plain words", then "Sign with your owner key" (unlock with Windows Hello first if asked).',
      ],
      done: 'The editor reads "Signed with your owner key" and charter line II reads "signed".',
    },
    async script(app, ctx) {
      if (app.mode !== 'mock') return;
      // Say it, the one-sentence rules reader: try the creator's sentence and record what it reads.
      await app.route('#s=setup');
      await tryClick(app, ctx, 'main', (p) => p.locator('ol.ch-fields > li').nth(1), 'open charter line II');
      const main = app.page('main');
      const box = main.locator('textarea, input[type=text]').filter({ hasNot: main.locator('[readonly]') }).first();
      if (await box.isVisible().catch(() => false)) {
        const sentence = 'Sell a 60-second sponsorship for at least $1,200, ask me above $2,000, for 14 days';
        await box.fill(sentence);
        const read = main.getByRole('button', { name: /^Read it$/ }).first();
        if (await read.isVisible().catch(() => false)) await read.click();
        await main.waitForTimeout(800);
        const r = await app.read('main');
        const notRead = (r.body.match(/Not read[^\n]*/g) || []).slice(0, 4);
        ctx.data.sayIt = { sentence, notRead, chips: (r.body.match(/You said[\s\S]{0,200}/) || [''])[0].replace(/\s+/g, ' ') };
        ctx.friction({ kind: 'dead-end', severity: 'high', window: 'main', text: `Say it cannot read a selling sentence ("${sentence}"): ${notRead.length ? notRead.join(' | ') : 'see screenshot'}. The creator must build seller rules by hand in the editor.` });
        await box.fill('');
      } else {
        ctx.friction({ kind: 'dead-end', severity: 'low', window: 'main', text: 'no Say it box found on charter line II' });
      }
    },
    detect: async (app, ctx) => (await charterIs(app, 'rules')) || (await bodyHas(app, 'approval', /Signed with your owner key/)) || (ctx.ledger?.()?.mandates?.some((m) => m.sells) ? 'ledger: an active rule set that sells' : null),
    async simulate(app, ctx) {
      const main = app.page('main');
      const handoff = main.getByRole('button', { name: /(rules|Review|Choose).*↗/i }).first();
      if (await handoff.isVisible().catch(() => false)) await tryClick(app, ctx, 'main', () => handoff, 'open the rules editor (hand-off ↗)', { simulated: true });
      else ctx.friction({ kind: 'dead-end', severity: 'medium', window: 'main', text: 'charter line II has no hand-off to the rules editor that the harness could find' });
      const ap = await approval(app, ctx, 'approval.html?target=mandate');
      if (!ap) return;
      if (await ap.getByRole('button', { name: 'Sign your first rules…' }).first().isVisible().catch(() => false)) {
        await tryClick(app, ctx, 'approval', byRole('button', 'Sign your first rules…', true), 'press "Sign your first rules…"', { simulated: true });
      }
      const r = R(ctx);
      const s = { simulated: true };
      await tryClick(app, ctx, 'approval', byText('What agents may do'), 'open "What agents may do"', s);
      await tryClick(app, ctx, 'approval', (p) => p.locator('.ow-pop label.pick', { hasText: 'sell' }).locator('input'), 'tick sell', s);
      await tryClick(app, ctx, 'approval', (p) => p.locator('.ow-pop label.pick', { hasText: 'buy' }).locator('input'), 'untick buy', s);
      await ap.keyboard.press('Escape');
      for (const rule of ['3 · Limit per deal', '4 · Price range', '5 · Daily limit', '7 · Approved payees']) {
        await tryClick(app, ctx, 'approval', byText('Add a rule'), 'open "Add a rule"', s);
        await tryClick(app, ctx, 'approval', byRole('button', rule), `add "${rule.slice(4)}"`, s);
      }
      await tryClick(app, ctx, 'approval', (p) => p.locator('.ui-row[data-clause="3"]'), 'open the per-deal row ("What they may buy")', s);
      await ap.locator('.ow-pop select').first().selectOption(r.kind, { timeout: 3000 }).catch(() => ctx.friction({ kind: 'dead-end', severity: 'high', window: 'approval', text: 'could not set the per-deal kind to haggle' }));
      await tryClick(app, ctx, 'approval', (p) => p.locator('.ow-pop label.pick', { hasText: r.category }).locator('input'), `tick ${r.category}`, s);
      await ap.keyboard.press('Escape');
      await tryClick(app, ctx, 'approval', (p) => p.locator('.ui-row[data-clause="4"]'), 'open "Items with a price range"', s);
      await app.fill('approval', '.ow-pop input.ui-field', r.items.join(', '), 'type the items', s);
      await ap.keyboard.press('Escape');
      await tryClick(app, ctx, 'approval', (p) => p.locator('.ui-row[data-clause="7"]'), 'open "Approved payees"', s);
      await app.fill('approval', '.ow-pop input.ui-field', r.payees, 'type the approved payee', s);
      await ap.keyboard.press('Escape');
      await app.fill('approval', '.ow-lever[data-clause="3"] input.ui-field', r.most_per_deal, 'type most per deal', s);
      await app.fill('approval', '.ow-lever:has(label:text-is("Least you’ll accept · when your agents sell")) input.ui-field', r.least_you_accept, 'type least you\'ll accept', s);
      await app.fill('approval', '.ow-lever[data-clause="5"] input.ui-field', r.per_day_total, 'type most per day', s);
      await tryClick(app, ctx, 'approval', byRole('button', 'more deals per day', true), 'one more deal per day', s);
      await app.fill('approval', '.ow-lever[data-clause="6"] input.ui-field', r.ask_me_above, 'type ask me above', s);
      const deadline = ap.locator('.ow-band input[type=datetime-local]').first();
      if (await deadline.isVisible().catch(() => false)) {
        const shown = await deadline.inputValue();
        ctx.data.bandDeadlineDefault = shown;
        const d = new Date(Date.parse(ctx.pinnedAt) + 14 * 86400_000);
        const pad = (n) => String(n).padStart(2, '0');
        await deadline.fill(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T12:00`);
        app.clicks.push({ window: 'approval', words: 'set the price range\'s end 14 days out', why: 'the default ends tomorrow', simulated: true, t: Date.now() });
        ctx.friction({ kind: 'unclear-copy', severity: 'medium', window: 'approval', text: `the price range's "until" defaults to ${shown} (one day out): a sponsorship negotiation would lapse tomorrow unless the owner notices the small date field` });
      }
      ctx.data.rulesScreen = (await app.read('approval'))?.body.slice(0, 1500);
      await tryClick(app, ctx, 'approval', byRole('button', 'Review & sign rules…', true), 'press "Review & sign rules…"', s);
      await ap.waitForTimeout(800);
      ctx.data.signSheet = (await app.read('approval'))?.body.match(/In plain words[\s\S]{0,700}/)?.[0]?.replace(/\s+/g, ' ');
      await tryClick(app, ctx, 'approval', byRole('button', 'Sign with your owner key', true), 'press "Sign with your owner key"', s);
      await ap.waitForTimeout(1200);
    },
    gaps: [
      'No ready-made seller rules: the three templates (Careful, Shop assistant, Haggler for one item) all buy (windows/approval/templates.ts).',
      'Say it reads buying only; a selling sentence is shown as not read (say-it.md, Known gaps).',
      'One price range per rule set: the 60-second sponsorship and the 15-second shout-out share one least-you\'ll-accept; a lower floor for shout-outs needs a second rule set (mandates-and-rules.md).',
    ],
  },
  {
    id: 'practice-house',
    title: 'Practice deal: connect the house seller',
    actor: 'owner',
    screens: ['The Table: charter line III', 'Connections › Connect a wallet › House seller', 'approval window: confirm four words'],
    expected: 'The house seller is connected (line III signed). It is a seller: the practice is a purchase, not a sale.',
    success: 'Charter line III ticked; all five lines signed; Home becomes the decision centre.',
    card: {
      where: 'The Table › charter › line III "Practice deal" › Connections › Connect a wallet › "House seller"',
      steps: [
        '"Paid to": your PayPal sandbox email (or a shop name with no spaces).',
        'Press "Connect with the house" (it may need "Wake it now" first; waking can take a while).',
        'Tick each of the four words as seen, then "All four match".',
        'In the approval window: check the same four words, name it "House seller", press "All four match: connect" (unlock with Windows Hello if asked).',
        'If The Table says the house seller is unavailable (a build without its release pin), type "s house unavailable" here to skip.',
      ],
      done: 'Charter line III reads "signed" (or the Connections list shows "House seller").',
    },
    detect: async (app, ctx) => (await charterIs(app, 'practice')) || (ctx.ledger?.()?.counterparties?.some((c) => c.paired_via === 'house') ? 'ledger: the house seller is paired' : null),
    async simulate(app, ctx) {
      const s = { simulated: true };
      await app.route('#p=pairing');
      await tryClick(app, ctx, 'main', byRole('button', 'House seller', true), 'choose "House seller"', s);
      await app.fill('main', '#pp-payee', B(ctx).creator.payee, 'type "Paid to"', s);
      await tryClick(app, ctx, 'main', (p) => p.locator('form.pair-desk button[type=submit]'), 'press "Connect with the house"', s);
      await confirmWords(app, ctx, 'House seller');
      await closeApproval(app);
      await app.route('#s=setup');
    },
    gaps: [
      'The charter asks every owner to practise buying from the house seller; there is no practice buyer for a creator who sells (onboarding.md, counter-shop.md).',
      'Debug builds report the house as unavailable and no hosted house is deployed (pairing-relay-house.md): in a live run this step may not complete, and the charter then never finishes.',
    ],
  },
  {
    id: 'sales-places',
    title: 'Where sponsorship deals will show: Tables, Counter, Rules',
    actor: 'script',
    screens: ['The Table: Home', 'Tables', 'Counter', 'Rules'],
    expected: 'Home past the charter; Tables says no tables yet; Counter explains the shop; Rules shows one seller rule set.',
    success: 'Each place answers "is anything happening and does anything need me" with nothing open yet.',
    async script(app, ctx) {
      const home = await app.read('main');
      ctx.data.homeAfterSetup = home?.headings.slice(0, 6);
      for (const [hash, name] of [['#m=tables', 'Tables'], ['#m=counter', 'Counter'], ['#p=rules', 'Rules']]) {
        await app.route(hash);
        await pause(800);
        await ctx.shoot(`place-${name.toLowerCase()}`);
        ctx.screen(`The Table: ${name}`);
        await ctx.checkScreen('main');
      }
      await app.route('');
    },
    detect: async (app) => ((await app.read('main')) ? 'The Table readable' : null),
    gaps: [
      'Counter (the shop) takes orders only from other wallets\' agents; no brand-side screen places an order at it, and items are known only by code (counter-shop.md).',
    ],
  },
  {
    id: 'connect-brand',
    title: 'Connect a brand (Northwind Audio) with four words',
    actor: 'owner',
    screens: ['The Table: Connections › Connect a wallet › I have a code', 'approval window: confirm four words'],
    expected: 'Northwind Audio connected (four words checked on both sides); listed under Connections.',
    success: 'Connections lists Northwind Audio as connected.',
    card: {
      where: 'The Table › Connections › "Connect a wallet ›" › "I have a code"',
      steps: [
        'Get the code from the brand (they press "Share a code" in their own wallet and send it to you).',
        'Type it under "Their code". "In this deal you": Sell. "Paid to": creator-studio (or your sandbox email). Press "Join".',
        'Four words appear. Read them with the brand on a call or chat; tick each one only if theirs match, then "All four match".',
        'In the approval window: check the same words, name them "Northwind Audio", press "All four match: connect".',
      ],
      done: 'The pairing desk shows "connected" and Connections lists Northwind Audio.',
    },
    detect: async (app, ctx) => {
      const name = brand(ctx, 'northwind').name;
      return (await bodyHas(app, 'approval', new RegExp(`Connected · ${name}`)))
        || ((await bodyHas(app, 'main', /\bconnected\b/)) && (await bodyHas(app, 'main', new RegExp(name))))
        || (ctx.ledger?.()?.counterparties?.some((c) => c.display_name === name) ? `ledger: ${name} paired` : null)
        || (app.mode === 'mock' && (await app.mockState())?.counterparties?.some((c) => c.display_name === name) ? `mock store: ${name} connected` : null);
    },
    async simulate(app, ctx) {
      await simulateConnect(app, ctx, brand(ctx, 'northwind'));
    },
    gaps: [
      'Live needs a second wallet for the brand: the app keeps one wallet per Windows user (%APPDATA%\\dev.thetable.wallet, no override), so the brand runs on another PC or another Windows account, and both must be launched with TABLE_RELAY_URL pointing at one relay.',
    ],
  },
  {
    id: 'open-table',
    title: 'Open the sponsorship table and send the listing code',
    actor: 'owner',
    screens: ['The Table: pairing desk "Open a table ↗"', 'approval window: Open a table sheet', 'listing code'],
    expected: 'A seller table for one 60-second sponsorship at $2,400 asking, listed for Northwind; a listing code to send them.',
    success: '"Your table is open" with a listing code; The Table\'s Tables tab counts 1.',
    card: {
      where: 'The Table › Connections, right after connecting › gold "Open a table ↗" (or approval window › Tables › "Open a table…")',
      steps: [
        'Who: Northwind Audio. Rules: your negotiator rules. Kind of thing: Service. Item: yt-sponsor-60s. Quantity: 1. Asking price: 2400.00.',
        'Press "Open the table" (unlock with Windows Hello if asked).',
        'Copy the listing code it shows and send it to the brand: they paste it in their own wallet ("Join with a code").',
        'Press "Follow it in The Table".',
      ],
      done: '"Your table is open" and The Table\'s Tables tab shows 1.',
    },
    detect: async (app, ctx) => (await bodyHas(app, 'approval', /Your table is open/))
      || (Number((await app.read('main'))?.tabs?.tables ?? 0) >= 1 ? 'The Table\'s Tables tab counts a table' : null)
      || (ledgerDeal(ctx) ? `ledger: seller table ${ledgerDeal(ctx).item_ref} ${ledgerDeal(ctx).state}` : null),
    async simulate(app, ctx) {
      await simulateOpenTable(app, ctx, brand(ctx, 'northwind'));
      const code = await app.page('approval')?.locator('.ow-tbl input.mono[readonly]').first().inputValue({ timeout: 3000 }).catch(() => null);
      ctx.data.listingCode = code ?? null;
      if (code) ctx.friction({ kind: 'unclear-copy', severity: 'low', window: 'approval', text: `the listing code is ${code.length} characters of machine text the owner must copy into a chat by hand` });
      // The hostile brand gets a table too, so its note has somewhere to land (beat 9).
      await closeApproval(app);
      await simulateConnect(app, ctx, brand(ctx, 'apex'));
      await simulateOpenTable(app, ctx, brand(ctx, 'apex'));
      await closeApproval(app);
    },
    gaps: [
      'The brand joins only with the listing code sent out of band; no screen shows the creator\'s open tables to a brand (counter-shop.md).',
    ],
  },
  {
    id: 'brand-haggles',
    title: 'The brand joins and the agents haggle; brand messages arrive (one hostile)',
    actor: 'brand',
    screens: ['The Table: Tables, deal page, note chip ("Their words")', 'Watch the haggle', 'Tumbler (must not show their words)'],
    expected: 'Offers and counters inside $1,200–$3,000; their notes visible only behind the note chip; the hostile note changes nothing.',
    success: 'Deal reads Negotiating with offers; the hostile text is absent from the Tumbler and the approval window; price, state and rules unchanged after it.',
    card: {
      where: 'The brand\'s own wallet (another PC or Windows account) · then watch The Table › Tables',
      steps: [
        'Ask Northwind to paste your listing code in their approval window › Tables › "Join with a code", under their buyer rules, and start their agent.',
        'Optional hostile test: the Apex brief\'s note (briefs.json) needs a wallet that sends a NOTE; no screen sends one today, so skip it live unless you have such a tool.',
        'Leave The Table on Tables. Your agent answers on its own inside your price range.',
      ],
      done: 'Tables shows the Northwind table "Negotiating" with offers on the price rail.',
    },
    async script(app, ctx) {
      if (app.mode !== 'mock') {
        await app.route('#m=tables');
        return;
      }
      const before = await app.mockState();
      const north = mockDealFor(before, brand(ctx, 'northwind').name);
      const apex = mockDealFor(before, brand(ctx, 'apex').name);
      if (!north || !apex) {
        ctx.friction({ kind: 'dead-end', severity: 'high', window: 'main', text: 'the case\'s tables are not in the mock world (beat 8 did not open them)' });
        return;
      }
      ctx.data.labels = { northwind: north.display.label, apex: apex.display.label };
      // Simulated counterparty steps: their signed NOTEs arrive (the mock's own world.note).
      await app.mockNote(north.display.label, brand(ctx, 'northwind').note);
      await app.mockNote(apex.display.label, brand(ctx, 'apex').note);
      ctx.counterparty(`${brand(ctx, 'northwind').name} and ${brand(ctx, 'apex').name} each sent a note (simulated counterparty step: world.note)`);
      await pause(800);
      const hostile = brand(ctx, 'apex').note;
      const probe = hostile.slice(0, 40);
      // The deal page: their words only behind the chip.
      await app.route(`#d=${apex.display.label}`);
      await pause(1200);
      const deal = await app.read('main');
      ctx.screen(`The Table: deal ${apex.display.label}`);
      await ctx.shoot('hostile-deal-summary');
      const openly = deal?.body.includes(probe);
      if (openly) ctx.friction({ kind: 'safety', severity: 'high', window: 'main', text: 'the hostile note is visible on the deal page without opening the note chip' });
      if (!/\bnote\b/i.test(deal?.body ?? '')) ctx.friction({ kind: 'did-it-work', severity: 'medium', window: 'main', text: `the deal page's summary does not say the brand wrote anything: their note is two levels down (deal › "Who you deal with" › "note ›")` });
      // Their note lives in the deal's "Who you deal with" view (WhoView, NoteChip).
      await app.route(`#d=${apex.display.label}&dv=who`);
      await pause(1200);
      const chip = app.page('main').getByRole('button', { name: /note ›/ }).first();
      let shown = false;
      if (await chip.isVisible().catch(() => false)) {
        await app.click('main', () => chip, 'open the note chip');
        await pause(600);
        shown = (await app.read('main'))?.body.includes(probe);
        await ctx.shoot('hostile-note-chip');
      } else {
        ctx.friction({ kind: 'dead-end', severity: 'medium', window: 'main', text: 'no "note ›" chip on the deal page after the brand\'s note arrived' });
      }
      // The Tumbler and the approval window must never carry their words.
      const tumbler = await app.context.newPage();
      await tumbler.goto(app.url('tumbler.html'), { waitUntil: 'domcontentloaded' });
      await tumbler.waitForTimeout(1500);
      const inTumbler = (await tumbler.evaluate(() => document.body.innerText)).includes(probe);
      await tumbler.close();
      const ap = await app.context.newPage();
      await ap.goto(app.url(`approval.html?deal=${apex.deal.id}`), { waitUntil: 'domcontentloaded' });
      await ap.waitForTimeout(1800);
      const inApproval = (await ap.evaluate(() => document.body.innerText)).includes(probe);
      await ctx.shoot('hostile-approval-review');
      await ap.close();
      const after = await app.mockState();
      const a2 = mockDealFor(after, brand(ctx, 'apex').name);
      const unchanged = a2 && a2.deal.state === apex.deal.state && JSON.stringify(a2.deal.terms) === JSON.stringify(apex.deal.terms) && after.mandates.length === before.mandates.length;
      ctx.data.hostile = { visibleWithoutChip: !!openly, shownBehindChip: !!shown, inTumbler, inApproval, dealUnchanged: !!unchanged, state: a2?.deal.state };
      if (inTumbler || inApproval) ctx.friction({ kind: 'safety', severity: 'high', window: inTumbler ? 'tumbler' : 'approval', text: 'the hostile note reached a window it must never reach' });
      if (!unchanged) ctx.friction({ kind: 'safety', severity: 'high', window: 'main', text: 'the deal or the rules changed after the hostile note' });
      ctx.signal(`hostile note: behind chip ${shown ? 'yes' : 'no'}, Tumbler ${inTumbler ? 'LEAKED' : 'clean'}, approval ${inApproval ? 'LEAKED' : 'clean'}, deal ${unchanged ? 'unchanged' : 'CHANGED'} (${a2?.deal.state})`);
      await app.route('#m=tables');
      await ctx.shoot('tables-after-notes');
    },
    detect: async (app, ctx) => {
      if (app.mode === 'mock') return ctx.data.hostile ? 'notes delivered and checked (no offers: the mock never moves a new table past Listed)' : null;
      return (await bodyHas(app, 'main', /Negotiating/)) || (ledgerDeal(ctx)?.state === 'NEGOTIATING' ? 'ledger: the table is negotiating' : null);
    },
    gaps: [
      'Mock: a table opened on the first-run wallet never gets an offer (no counterparty agent runs in the preview); the haggle itself is only seen live, or on the sample week\'s recorded tables.',
      'A wallet seller refuses inbound offers below its floor instead of countering them; only the house seller counters (tables-haggling.md).',
      'No screen sends a NOTE: the hostile brand message can only come from a wallet built to send one; the wallet side (quarantine) is what the run checks.',
    ],
  },
  {
    id: 'ask-me-above',
    title: 'Above "Ask me above": the owner approves the price',
    actor: 'owner',
    screens: ['Tumbler gate card', 'The Table: decision centre gold "Review ↗"', 'approval window: The Diff, hold to approve'],
    expected: 'When the agreed price would pass $2,000 the agent stops; the owner holds "Approve $X" in the approval window, or lets it lapse.',
    success: 'The deal reads Agreed (owner decided) or Withdrawn by its deadline if the owner let it go.',
    card: {
      where: 'Tumbler card or The Table › "What needs you" › gold "Review ↗" (opens the approval window on this deal)',
      steps: [
        'Read the wallet\'s checklist (amount, payee, scam check, your rules). Every line must pass.',
        'If the price is right, press and hold "Approve $X" until it fills (Enter does nothing on money buttons). If not, close it: silence lets the offer lapse and no money moves.',
        'Leave The Table on Tables.',
      ],
      done: 'Tables shows the Northwind table "Agreed".',
    },
    detect: async (app, ctx) => (app.mode === 'mock' ? null : await bodyHas(app, 'main', /\bAgreed\b/)) || (['AGREED', 'SETTLING', 'AWAITING_APPROVAL', 'APPROVED', 'AUTHORIZED', 'CAPTURED', 'RECEIPTED', 'RECONCILED'].includes(ledgerDeal(ctx)?.state) ? `ledger: ${ledgerDeal(ctx).state}` : null),
    async reference(app, ctx) {
      const p = await ctx.referencePage('index.html#d=D-0193');
      await p.waitForTimeout(1500);
      ctx.screen('reference (sample week): deal D-0193, Dan\'s counter above "ask me above"');
      await ctx.shootPage(p, 'ref-ask-me-above-deal');
      const gold = p.getByRole('button', { name: /Review/ }).first();
      if (await gold.isVisible().catch(() => false)) {
        await gold.click();
        const ap = await waitPage(ctx.refContext, 'approval', 6000);
        if (ap) {
          await ap.waitForTimeout(2000);
          ctx.screen('reference (sample week): approval window review of D-0193 (not approved)');
          await ctx.shootPage(ap, 'ref-ask-me-above-review');
          await ctx.checkPage('approval', ap);
          await ap.close();
        }
      }
    },
    gaps: ['Mock: no first-run table reaches this point; the screens are shown on the sample week\'s recorded haggle (D-0193) and nothing is approved.'],
  },
  {
    id: 'order-and-pay',
    title: 'The order, the brand pays on PayPal, the wallet collects',
    actor: 'brand',
    screens: ['approval window: order review (owner creates the order above "ask me above")', 'brand\'s PayPal sandbox approval', 'The Table: deal states Waiting for buyer → On hold → Paid'],
    expected: 'The creator\'s wallet creates the PayPal order (by rule, or the owner\'s "Approve" above $2,000); the brand approves on PayPal; the wallet authorizes and collects under the signed rules with no click.',
    success: 'The deal reads "Paid" (seller: collected) and a receipt is saved.',
    card: {
      where: 'Approval window (if the order needs you) · the brand\'s PayPal sandbox buyer account · The Table › Tables',
      steps: [
        'If the decision centre shows "Approve the order", open it and hold "Approve $X": the wallet creates the PayPal order. Under $2,000 it does this by your rule, with no click.',
        'The brand opens PayPal from their approval window and approves with their sandbox personal account.',
        'Wait: your wallet checks PayPal every 10 s and collects on its own once the brand approved.',
      ],
      done: 'The Northwind deal reads "Paid" in Tables or Counter.',
    },
    detect: async (app, ctx) => (app.mode === 'mock' ? null : await bodyHas(app, 'main', PAID)) || (['CAPTURED', 'RECEIPTED', 'RECONCILED'].includes(ledgerDeal(ctx)?.state) ? `ledger: ${ledgerDeal(ctx).state}` : null),
    async reference(app, ctx) {
      const p = await ctx.referencePage('index.html#m=counter');
      await p.waitForTimeout(1500);
      ctx.screen('reference (sample week): Counter, seller orders (Waiting for buyer / On hold / Paid)');
      await ctx.shootPage(p, 'ref-counter-orders');
      await ctx.checkPage('main', p);
    },
    gaps: [
      'UNVERIFIED in the product itself: a live two-account seller authorize and capture has never run (counter-shop.md, money-pipeline.md "No live sandbox run yet").',
      'A haggle\'s order is created at AGREED by the seller; the brand needs its own PayPal sandbox personal account to approve.',
    ],
  },
  {
    id: 'money-confirmed',
    title: 'Money confirmed: Book, statement, proof',
    actor: 'script',
    screens: ['The Table: Book (Paid in, statement)', 'deal page: Proof', 'Your safety record'],
    expected: 'Book shows Paid in $X (sandbox), the statement match (can lag up to 3 h), a receipt and a proof file.',
    success: 'Book lists the deal as paid in; "On statement" once PayPal\'s report catches up.',
    async script(app, ctx) {
      if (app.mode === 'mock') return;
      await app.route('#m=book');
    },
    detect: async (app, ctx) => (app.mode === 'mock' ? 'reference only' : (await bodyHas(app, 'main', /Paid in/)) || (ledgerDeal(ctx)?.reconciliation === 'matched' ? 'ledger: on statement' : null)),
    async reference(app, ctx) {
      const p = await ctx.referencePage('index.html#m=book');
      await p.waitForTimeout(1500);
      ctx.screen('reference (sample week): Book');
      await ctx.shootPage(p, 'ref-book');
      await ctx.checkPage('main', p);
      await p.evaluate(() => { location.hash = '#d=D-0205&dv=proof'; });
      await p.waitForTimeout(1500);
      ctx.screen('reference (sample week): deal D-0205 Proof');
      await ctx.shootPage(p, 'ref-proof');
    },
    gaps: ['PayPal\'s statement can lag up to 3 hours; re-run this beat later with --only money-confirmed.'],
  },
];

async function waitPage(context, win, ms) {
  const { windowOf } = await import('./lib/app.mjs');
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const p = context.pages().find((x) => !x.isClosed() && windowOf(x.url()) === win);
    if (p) return p;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

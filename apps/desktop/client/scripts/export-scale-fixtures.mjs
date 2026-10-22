#!/usr/bin/env node
// Writes the two scale worlds of the browser mock (src/mock/scale.ts) as plain files, so a static
// page opened from disk (a redesign prototype) can load exactly the data the current app shows on
// `?scale=small` and `?scale=large`, with no build and no server.
//
//   node scripts/export-scale-fixtures.mjs --out <dir>
//
// Writes, into <dir>: small.json, large.json, small.js, large.js and SCALE.md.
//   small.js / large.js    window.TABLE_SCALE_SMALL = {...};  /  window.TABLE_SCALE_LARGE = {...};
//   <script src="small.js"></script> is all a page needs.
//
// SAMPLE DATA ONLY. The generator is pure and takes `now`; this script fixes it at
// SCALE_NOW (src/mock/scale.ts, 2026-10-14T14:30:00Z), so the files are reproducible byte for byte
// (run it twice and compare).
// Nothing here talks to PayPal or the network, and nothing is ever paid.
//
// The TypeScript is loaded through Vite (the project's own config, so the `@bindings` and `@`
// aliases resolve exactly as in the app and the tests), in a server-less module graph.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(HERE, '..');

function parseArgs(argv) {
  const o = { out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a === '--out') o.out = argv[++i];
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.out) {
  console.log('usage: node scripts/export-scale-fixtures.mjs --out <dir>');
  process.exit(args.help ? 0 : 2);
}
const out = resolve(args.out);
mkdirSync(out, { recursive: true });

// ---- SCALE.md ---------------------------------------------------------------------------------

function tally(xs, f) {
  const o = {};
  for (const x of xs) { const k = f(x); o[k] = (o[k] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}
const row = (cells) => `| ${cells.join(' | ')} |`;
const table = (head, rows) => [row(head), row(head.map(() => '---')), ...rows.map((r) => (typeof r === 'string' ? r : row(r)))].join('\n');
const usd = (minor) => `$${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function facts(s, now) {
  const deals = s.deals;
  const att = deals.flatMap((d) => (d.attention ? [d.attention] : []));
  const bead = (d) => {
    const st = d.deal.state;
    if (['WITHDRAWN', 'EXPIRED', 'VOIDED', 'AUTO_VOIDED', 'REFUNDED'].includes(st)) return 'off';
    if (['REFUSED', 'MISMATCH', 'DISPUTED', 'FAILED', 'UNCONFIRMED'].includes(st) || d.deal.shield === 'BLOCK') return 'stopped';
    if (['CAPTURED', 'RECONCILED'].includes(st) || (st === 'RECEIPTED' && !(d.deal.side === 'buyer' && ['haggle', 'shop_order'].includes(d.deal.kind)))) return 'settled';
    if (st === 'AUTHORIZED' || d.deal.shield === 'HOLD') return 'held';
    return 'moving';
  };
  const mod = (d) => (d.attention ? d.attention.module : d.deal.shield === 'HOLD' || d.deal.shield === 'BLOCK' ? 'shield' : { haggle: 'tables', purchase: 'spend', shop_order: 'counter', rescue: 'rescue', invoice: 'rescue' }[d.deal.kind]);
  const totals = deals.map((d) => d.deal.terms.unit_price.minor * d.deal.terms.qty);
  const left = att.map((a) => a.deadline - now);
  return {
    deals: deals.length,
    byKind: tally(deals, (d) => d.deal.kind),
    byState: tally(deals, (d) => d.deal.state),
    byModule: tally(deals, mod),
    bead: tally(deals, bead),
    attention: att.length,
    gates: att.filter((a) => a.kind === 'gate').length,
    holds: att.filter((a) => a.kind === 'hold').length,
    attentionByModule: tally(att, (a) => `${a.module} ${a.kind}`),
    soonest: left.length ? Math.min(...left) : null,
    latest: left.length ? Math.max(...left) : null,
    max: Math.max(...totals),
    min: Math.min(...deals.map((d) => d.deal.terms.unit_price.minor)),
    transcriptMax: Math.max(0, ...deals.map((d) => d.transcript.length)),
    cpTrading: s.counterparties.filter((c) => !c.key_id.startsWith('sub_')).length,
    cpSubs: s.counterparties.filter((c) => c.key_id.startsWith('sub_')).length,
    cpLong: s.counterparties.filter((c) => c.display_name.length > 32).length,
    mandateIds: new Set(s.mandates.map((m) => m.payload.id)).size,
    agents: new Set(s.mandates.map((m) => m.payload.agent_key.join())).size,
    revoked: (s.revokedMandates ?? []).length,
    maxPayees: Math.max(0, ...s.mandates.map((m) => Math.max(0, ...m.payload.clauses.filter((c) => c.type === 'payees').map((c) => c.payees.length)))),
    maxTitle: Math.max(...deals.map((d) => d.display.title.length)),
    maxNote: Math.max(0, ...Object.values(s.notes ?? {}).map((n) => n.text.length)),
  };
}

/** The large world's module table, every figure counted from its rows (none typed by hand). */
const CLOSED = ['RECONCILED', 'RECEIPTED', 'CAPTURED', 'WITHDRAWN', 'EXPIRED', 'VOIDED', 'AUTO_VOIDED', 'REFUNDED'];
function moduleFacts(s) {
  const of = (kind) => s.deals.filter((d) => d.deal.kind === kind);
  const n = (ds, p) => ds.filter(p).length;
  const closed = (d) => CLOSED.includes(d.deal.state);
  const st = (...xs) => (d) => xs.includes(d.deal.state);
  const att = (k) => (d) => d.attention?.kind === k;
  const [h, p, c, r] = ['haggle', 'purchase', 'shop_order', 'rescue'].map(of);
  const groups = (s.groups ?? []).map((g) => g.deal_ids.length);
  const held = p.filter(att('gate')).map((d) => d.attention.amount_minor);
  const long = h.reduce((a, d) => (d.transcript.length > (a?.transcript.length ?? -1) ? d : a), null);
  return {
    tables: { n: h.length, gate: n(h, att('gate')), open: n(h, (d) => st('PAIRING', 'LISTED', 'NEGOTIATING', 'AGREED')(d) && !d.attention), mismatch: n(h, st('MISMATCH')), refused: n(h, st('REFUSED')), closed: n(h, closed), groups },
    spend: { n: p.length, held: held.length, heldMax: held.length ? Math.max(...held) : 0, refused: n(p, st('REFUSED')), closed: n(p, closed) },
    counter: { n: c.length, closed: n(c, closed), awaiting: n(c, st('AWAITING_APPROVAL')), quote: n(c, st('LISTED')), held: n(c, att('hold')), checking: n(c, (d) => st('AUTHORIZED')(d) && !d.attention) },
    rescue: { n: r.length, fix: n(r, att('gate')), invoices: n(r, st('AWAITING_APPROVAL')), paid: n(r, st('RECEIPTED')), expired: n(r, st('EXPIRED')), withdrawn: n(r, st('WITHDRAWN')) },
    shield: { paused: n(s.deals, (d) => d.deal.shield === 'HOLD' && d.attention?.module === 'shield'), blocked: n(s.deals, (d) => d.deal.shield === 'BLOCK') },
    sellerSaysPaid: n(h, (d) => d.deal.side === 'buyer' && d.deal.state === 'RECEIPTED'),
    longest: long ? { rounds: long.display.band?.rounds_used ?? 0, steps: long.transcript.length, allows: long.display.band?.max_rounds ?? 0 } : null,
  };
}
const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const said = (k) => words[k] ?? String(k);

function minutes(secs) {
  if (secs === null) return 'none';
  return secs < 3600 ? `${Math.round(secs / 60)} min` : secs < 172800 ? `${(secs / 3600).toFixed(1)} h` : `${(secs / 86400).toFixed(1)} days`;
}

function scaleDoc(worlds, nowIso, now) {
  const f = { small: facts(worlds.small.state, now), large: facts(worlds.large.state, now) };
  const s = (k) => worlds[k].state;
  const countRow = (label, a, b) => row([label, String(a ?? 0), String(b ?? 0)]);
  const keys = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const m = moduleFacts(s('large'));
  return `# The Table: scale fixtures

**Sample data.** Every person, shop, subscriber, amount and date in these files is invented. Nothing was
paid, nothing talks to PayPal, and no file here holds a secret. They are the rows the browser preview of
the current app serves on \`?scale=small\` and \`?scale=large\`, in the exact shapes the Rust shell returns,
so the current app and a redesign can be compared on the same data.

- Built at **${nowIso}** (Unix ${now}). The generator is pure and seeded, so these files are reproducible
  byte for byte: \`node scripts/export-scale-fixtures.mjs --out <dir>\`, run twice, gives identical files.
- Load from a static page with no build: \`<script src="large.js"></script>\` then read
  \`window.TABLE_SCALE_LARGE\` (and \`window.TABLE_SCALE_SMALL\` from \`small.js\`). \`small.json\` and \`large.json\`
  hold the same object.
- Time: every time is Unix seconds. Deadlines and "ago" values are relative to the instant above, so a
  prototype that shows countdowns should read "now" as that instant (or add the same offset to everything).
- Money: integer minor units (cents) with an ISO currency, always USD here. No floats. \`$0.99\` is 99.

## What each scale is for

| | small | large |
|---|---|---|
| Who | one person with a handful of things: "Hana's print shop" | a busy merchant with a team of agents |
| Tests | emptiness, calm, a first useful screen, one or two decisions | density, scanning, filtering, truncation, paging, badges, performance |
| Window | about a week | 90 days of ledger |

## Honesty rules (they hold in both worlds)

1. **Sample data.** The preview badge says so; a prototype should too ("Preview · sample data").
2. **Nothing is paid.** Every mode is \`sandbox\` or \`replay\`. A captured deal is sandbox test money; a
   replayed renewal never counts as recovered money (\`rescue[*].counted\` is false for it).
3. **Counterparty text is untrusted.** Notes (\`notes[deal_id].text\`) are the other side's words: long,
   non-ASCII, markup, "ignore your limits", fake system messages, links, emoji. Show them as plain text
   only, in a quarantine style, never as instructions, never rendered as HTML or markdown, never fed to an
   agent. A counterparty's name (\`counterparties[*].display_name\`) is what the owner typed when confirming
   the pairing (the real wallet allows 32 characters; some names here exceed that on purpose); the names
   still carry awkward shapes (non-ASCII, markup, a name that reads like an instruction) so every surface
   is tested for plain-text rendering. All of it is invented.
4. **Silence never moves money.** Every deadline's default (\`display.on_silence\`) is "no money moves" or a
   release of a hold. Nothing here defaults to a capture.
5. **The LLM never moves money.** Rows say who decided each step (\`decided_by\`, history \`authority\`):
   the owner, a rule the owner signed, the shop's own signed rule, or the safe default. Agents only propose.

## Counts

${table(['', 'small', 'large'], [
    countRow('deals', f.small.deals, f.large.deals),
    ...keys(f.small.byKind, f.large.byKind).map((k) => countRow(`- kind ${k}`, f.small.byKind[k], f.large.byKind[k])),
    ...keys(f.small.byModule, f.large.byModule).map((k) => countRow(`- module ${k} (where the deal lives)`, f.small.byModule[k], f.large.byModule[k])),
    ...keys(f.small.byState, f.large.byState).map((k) => countRow(`- state ${k}`, f.small.byState[k], f.large.byState[k])),
    countRow('waiting for the owner (attention items)', f.small.attention, f.large.attention),
    countRow('- decisions (gates)', f.small.gates, f.large.gates),
    countRow('- holds', f.small.holds, f.large.holds),
    ...keys(f.small.attentionByModule, f.large.attentionByModule).map((k) => countRow(`- waiting ${k}`, f.small.attentionByModule[k], f.large.attentionByModule[k])),
    row(['soonest / latest deadline of those', `${minutes(f.small.soonest)} / ${minutes(f.small.latest)}`, `${minutes(f.large.soonest)} / ${minutes(f.large.latest)}`]),
    countRow('held (on hold at PayPal, or paused by a scam check)', f.small.bead.held, f.large.bead.held),
    countRow('stopped before any money moved (or ended badly)', f.small.bead.stopped, f.large.bead.stopped),
    countRow('in progress with nothing for the owner to decide', s('small').inMotion, s('large').inMotion),
    countRow('paid (settled)', f.small.bead.settled, f.large.bead.settled),
    countRow('withdrawn, expired or released', f.small.bead.off, f.large.bead.off),
    countRow('trading counterparties', f.small.cpTrading, f.large.cpTrading),
    countRow('subscribers (also in counterparties, key starts with sub_)', f.small.cpSubs, f.large.cpSubs),
    countRow('- counterparty names over 32 characters (beyond what a pairing allows, on purpose)', f.small.cpLong, f.large.cpLong),
    countRow('signed rule ids (mandates)', f.small.mandateIds, f.large.mandateIds),
    countRow('- signed rows (all versions)', s('small').mandates.length, s('large').mandates.length),
    countRow('- revoked (retired agents)', f.small.revoked, f.large.revoked),
    countRow('agents (distinct agent keys on signed rules)', f.small.agents, f.large.agents),
    countRow('ledger rows (audit)', s('small').audit?.length, s('large').audit?.length),
    countRow('record steps (deal history)', s('small').history?.length, s('large').history?.length),
    countRow('rescue cases (failed renewals)', Object.keys(s('small').rescue ?? {}).length, Object.keys(s('large').rescue ?? {}).length),
    countRow('watched subscriptions', s('small').rescueWatches?.length, s('large').rescueWatches?.length),
    countRow('counterparty notes (untrusted)', Object.keys(s('small').notes ?? {}).length, Object.keys(s('large').notes ?? {}).length),
    countRow('shop-around groups', s('small').groups?.length, s('large').groups?.length),
    countRow('pending pairings', s('small').pendingPairings?.length, s('large').pendingPairings?.length),
    row(['largest deal / smallest unit price', `${usd(f.small.max)} / ${usd(f.small.min)}`, `${usd(f.large.max)} / ${usd(f.large.min)}`]),
    countRow('longest transcript (steps)', f.small.transcriptMax, f.large.transcriptMax),
    row(['file size (json)', `${worlds.small.bytes} bytes`, `${worlds.large.bytes} bytes`]),
  ])}

Two reading notes. "Needs the owner" in the large world tops out at ${f.large.attention}, so a badge that counts
waiting items never reaches 99+; the lists that do are the deals (${f.large.deals}), the rescue cases (${Object.keys(s('large').rescue ?? {}).length}),
the counterparties (${s('large').counterparties.length}) and the ledger (${s('large').audit?.length}). And ${said(m.sellerSaysPaid)} of the large world's buyer-side haggles read
"Seller says paid" until PayPal's reporting confirms them: they sit under in progress, as in the real
wallet, so the dial shows ${f.large.bead.moving} moving beads (${s('large').inMotion} running plus those ${said(m.sellerSaysPaid)} plus the waiting ones).

### Edge cases on purpose

- **small**: an empty module (Tables: no haggling at all); one failed renewal; one payment held; one blocked by the scam check; a $0.99 order.
- **large**: a haggle with **${m.longest?.rounds} rounds** (${m.longest?.steps} transcript steps, closed under a rule that allows ${m.longest?.allows}); **one signed
  rule with all nine clauses set** (the shop rule "quoting-b", pinned to named counterparties, with a
  fixes clause and price checks); ${f.large.maxPayees} payees on one rule; item titles of 60 to ${f.large.maxTitle} characters; a $48,000.00
  held payment next to $0.99 orders and a $0.80 invoice; names in Polish, Czech, German, Japanese,
  Chinese, Russian, Arabic, and with markup; notes (with emoji, markup and instructions) up to ${f.large.maxNote} characters (the wallet shows 280); deals older than the
  60 days categories were kept for ("not checked" in the what-if); signed rules that were revoked while
  deals under them stayed in the record; three pending pairings, one with a very long name.

## The world, field by field

The object is a \`MockState\` (src/mock/fixtures.ts). Row shapes are the Rust bindings (\`bindings/*.ts\`).

| field | what it is |
|---|---|
| \`settings\` | the wallet's settings snapshot: mode, locked, engines, preferences (\`pinned\`, \`form\`, \`quiet\`, \`dnd\`...), \`first_run\`, \`authority_manifest\` |
| \`deals[]\` | one entry per deal, each \`{ deal, display, evidence, transcript, attention }\` |
| \`deals[].deal\` | the ledger row: \`id\`, \`created_at\`, \`updated_at\`, \`kind\` (haggle, purchase, shop_order, rescue), \`side\` (buyer, seller), \`counterparty\` (a counterparties key), \`terms\` (\`item_ref\`, \`qty\`, \`unit_price\`, \`currency\`, \`delivery\`), \`state\`, \`mandate_id\`, \`mandate_version\`, \`transcript_head\`, \`paypal\` (\`order\`, \`authorization\`, \`capture\`, \`subscription\`), \`mode\`, \`market\` (typical price: \`p25\`, \`median\`, \`p75\`, comparables), \`shield\` (CLEAR, ASK, HOLD, BLOCK), \`shield_rule\`, \`decided_by\` |
| \`deals[].display\` | what the screens show: \`label\` (D-1000...), \`title\`, \`deadline\`, \`on_silence\` (what happens if the owner does nothing), \`band\` (floor, ceiling, \`max_rounds\`, \`rounds_used\`) |
| \`deals[].evidence\` | \`receipt\` (NONE, SELLER_ATTESTED, PAYPAL_VERIFIED), \`reconciliation\`, \`money_check\`, \`fair_price\` |
| \`deals[].transcript[]\` | the signed table: \`seq\`, \`by\` (you, them), \`typ\` (LISTING, OFFER, COUNTER, ACCEPT, WITHDRAW, SETTLE, RECEIPT), \`price\`, \`at\` |
| \`deals[].attention\` | present when the deal waits for the owner: \`kind\` (gate, hold), \`module\`, \`headline\`, \`amount_minor\`, \`deadline\`, \`on_silence\`, \`actions\`, \`clause\`, \`shield_rule\`, \`money_check\` |
| \`counterparties[]\` | \`key_id\`, \`display_name\` (untrusted), \`house\`, \`first_seen\`, \`deals_closed\`, \`pairing\` (words_confirmed, house_pinned, unpaired), \`declared_payee\` |
| \`mandates[]\` | every signed version: \`payload\` (\`id\`, \`version\`, \`agent_key\`, \`clauses[]\`, \`not_before\`, \`expires\`) and \`owner_sig\`; the latest version of an id is the one in force |
| \`mandateSlots\` | which agent slot each rule id belongs to (negotiator, shopper, assistant) |
| \`revokedMandates[]\` | \`"<id>:<version>"\` rows the owner revoked |
| \`pendingPairings[]\` | pairings waiting for the owner to confirm four words: \`pairing_id\`, \`words\`, \`house\`, \`display_context\`, \`expires\` |
| \`pairingResults\`, \`snoozed\` | empty here |
| \`notes\` | the latest signed note per deal id: \`deal_id\`, \`seq\`, \`at\`, \`text\` (untrusted, capped at 280 characters when read) |
| \`audit[]\` | the ledger: \`seq\`, \`at\`, \`actor\`, \`action\`, \`deal_id\`, \`decided_by\`, \`from\`, \`to\`, oldest first |
| \`history[]\` | each deal's steps: \`at\`, \`deal_id\`, \`seq\`, \`kind\`, \`state_after\`, \`authority\`, \`paypal\` (the call made, or none), oldest first |
| \`credentialsStoredAt\`, \`lastReportingPoll\`, \`enginesProbedAt\`, \`engines\`, \`runs\` | owner facts: when credentials were stored, the last PayPal reporting poll, the engines, running agent runs |
| \`stoppedToday\`, \`inMotion\`, \`walletSpendTodayMinor\`, \`engineEstimateTodayUsd\` | the day's meters (minor units; the engine figure is an estimate in dollars) |
| \`categories\` | the category each deal was created with, by deal id (missing = "not checked") |
| \`envelope\` | the owner's signed wallet limits: \`max_out_day\`, \`max_held\`, \`max_deals_day\`, \`expires\` |
| \`rescue\` | each rescue deal's failed renewal and its one fix: \`source\`, \`offer\` (\`cycle\`, \`discount\`, \`invoice\`, \`discount_bp\`), \`text\`, \`failed_payments\`, \`next_retry_at\`, \`recipient\` (masked), \`invoice\`, \`counted\` |
| \`marketChecksToday\` | price checks used today per rule id |
| \`groups[]\` | shop-around groups: one item at several sellers' tables |
| \`rescueWatches[]\`, \`rescueWatchReadsToday\` | subscriptions the wallet watches (at most 20) and today's checks |

### Reading a deal

- **Where it lives**: \`kind\` plus \`shield\` and \`attention.module\`: haggle is Tables, purchase is Spend, shop_order is Counter,
  rescue is Rescue; a deal the scam check paused or blocked is Shield; Book lists them all.
- **Waiting for the owner**: \`attention != null\`. A \`gate\` is a decision (countersign, capture or void, approve a fix);
  a \`hold\` is something the wallet stopped and only opens.
- **Stopped**: state REFUSED, MISMATCH, FAILED, UNCONFIRMED or shield BLOCK. **Held**: AUTHORIZED, or shield HOLD.
- **"Seller says paid"**: RECEIPTED on a buyer-side haggle with receipt SELLER_ATTESTED; PayPal has not confirmed it.

## Module by module (large)

${table(['module', 'deals', 'waiting', 'what is in it'], [
    ['Tables (haggle)', f.large.byKind.haggle, f.large.attentionByModule['tables gate'] + (f.large.attentionByModule['tables hold'] ?? 0), `${m.tables.n} buyer tables: ${m.tables.gate} to countersign, ${m.tables.open} more open, ${m.tables.mismatch} mismatches, ${m.tables.refused} refused, ${m.tables.closed} closed; ${said(m.tables.groups.length)} shop-around group${m.tables.groups.length === 1 ? '' : 's'} of ${m.tables.groups.join(', ')}`],
    ['Spend (purchase)', f.large.byKind.purchase, f.large.attentionByModule['spend gate'], `${m.spend.n} buyer purchases: ${m.spend.held} held payments to capture or void (up to ${usd(m.spend.heldMax)}), ${m.spend.refused} refused, ${m.spend.closed} closed`],
    ['Counter (shop_order)', f.large.byKind.shop_order, f.large.attentionByModule['counter hold'], `${m.counter.n} shop orders: ${m.counter.closed} closed, ${said(m.counter.awaiting)} awaiting its buyer, ${said(m.counter.quote)} quote, ${said(m.counter.held)} held, ${said(m.counter.checking)} being checked with PayPal`],
    ['Rescue', f.large.byKind.rescue, f.large.attentionByModule['rescue gate'], `${m.rescue.n} failed renewals: ${m.rescue.fix} need a fix, ${m.rescue.invoices} invoices out, ${m.rescue.paid} paid, ${m.rescue.expired} expired, ${m.rescue.withdrawn} withdrawn`],
    ['Shield', f.large.byModule.shield ?? 0, f.large.attentionByModule['shield hold'] ?? 0, `${m.shield.paused} payments paused by a scam check (with the rule that paused them) and ${m.shield.blocked} blocked`],
    ['Book', f.large.deals, 0, 'everything above, the ledger, the records'],
  ])}
`;
}

// ---- run ---------------------------------------------------------------------------------------

async function run() {
  const server = await createServer({
    root: CLIENT,
    configFile: resolve(CLIENT, 'vite.config.ts'),
    appType: 'custom',
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  });

  try {
    const { buildScaleState, SCALE_NOW } = await server.ssrLoadModule('/src/mock/scale.ts');
    const nowIso = new Date(SCALE_NOW * 1000).toISOString();
    const worlds = {};
    for (const scale of ['small', 'large']) {
      const state = buildScaleState(scale, SCALE_NOW);
      const json = JSON.stringify(state);
      const global = `TABLE_SCALE_${scale.toUpperCase()}`;
      writeFileSync(resolve(out, `${scale}.json`), json + '\n');
      writeFileSync(resolve(out, `${scale}.js`), `// Sample data: The Table, ${scale} world, built at ${nowIso}. Nothing here is real or paid.\nwindow.${global} = ${json};\n`);
      worlds[scale] = { state, bytes: json.length + 1, global };
    }
    writeFileSync(resolve(out, 'SCALE.md'), scaleDoc(worlds, nowIso, SCALE_NOW));
    for (const [scale, w] of Object.entries(worlds)) console.log(`${scale}: ${w.state.deals.length} deals, ${w.state.audit?.length ?? 0} ledger rows, ${w.bytes} bytes -> ${resolve(out, `${scale}.json`)}`);
  } finally {
    await server.close();
  }
}

await run();

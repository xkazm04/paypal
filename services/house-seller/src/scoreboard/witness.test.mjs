// The scoreboard's head witness: the pure helpers in witness.js, and the page's own check path
// (scoreboard.js run on load against a stubbed fetch and a minimal DOM). Run with
// `node --test services/house-seller/src/scoreboard/witness.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const DIR = new URL('./', import.meta.url);
const source = (name) => readFileSync(new URL(name, DIR), 'utf8');

// ---- test fixtures: a real Ed25519 house key and signed heads and prefixes --------------------

/** RFC 8785 canonical JSON, written here independently of the page's. */
function jcs(v) {
  if (Array.isArray(v)) return `[${v.map(jcs).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
const filled = (n) => Array.from({ length: 32 }, () => n);
const E = filled(7);
const OTHER_EPOCH = filled(8);
const H10 = filled(10);
const H12 = filled(12);
const H14 = filled(14);
const NOT_H10 = filled(99);
const toHex = (a) => a.map((b) => b.toString(16).padStart(2, '0')).join('');

const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const stranger = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const agentKey = Array.from(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
async function sign(domain, value, key = keys.privateKey) {
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(jcs([domain, value])));
  return Array.from(new Uint8Array(sig));
}
const T0 = 1_760_000_000;
async function signedHead(rows, hash, { epoch = E, at = T0 + rows * 60, key } = {}) {
  const head = { epoch, epoch_started: T0, row_count: rows, audit_head: hash, at };
  return { head, signature: await sign('table.house.head.v1', head, key) };
}
async function signedPrefix(rows, hash, within, { key } = {}) {
  const prefix = { epoch: E, row_count: rows, audit_head: hash, within, at: T0 + within * 60 + 5 };
  return { prefix, signature: await sign('table.house.prefix.v1', prefix, key) };
}
const release = { agent_key: agentKey, owner_key: filled(1), owner_signature: filled(2), mandate_commitment: filled(3) };

// ---- the helpers, loaded as the browser loads them (a classic script on the global) ------------

function loadWitness() {
  const context = vm.createContext({ TextEncoder, crypto });
  vm.runInContext(source('witness.js'), context, { filename: 'witness.js' });
  assert.ok(context.TableWitness, 'witness.js puts TableWitness on the global');
  return context.TableWitness;
}

test('compareHeads mirrors table_proto::compare_heads: extends, rewritten, longer', () => {
  const W = loadWitness();
  const kept = { epoch: toHex(E), rows: 10, hash: toHex(H10) };
  const later = { epoch: toHex(E), rows: 14, hash: toHex(H14) };
  const prefix = { epoch: E, row_count: 10, audit_head: H10, within: 14 };
  assert.equal(W.compareHeads(kept, later, prefix), 'extends');
  assert.equal(W.compareHeads(kept, later, { ...prefix, audit_head: NOT_H10 }), 'rewritten');
  assert.equal(W.compareHeads(kept, later, null), 'longer');
  assert.equal(W.compareHeads(kept, later, { ...prefix, within: 15 }), 'longer', 'a prefix read from another head proves nothing here');
  assert.equal(W.compareHeads(kept, later, { ...prefix, row_count: 9 }), 'longer');
});

test('compareHeads: new epoch, shorter, same, and two hashes at one length', () => {
  const W = loadWitness();
  const kept = { epoch: toHex(E), rows: 10, hash: toHex(H10) };
  assert.equal(W.compareHeads(kept, { epoch: toHex(OTHER_EPOCH), rows: 14, hash: toHex(H14) }, null), 'new_epoch');
  assert.equal(W.compareHeads(kept, { epoch: toHex(E), rows: 9, hash: toHex(H14) }, null), 'shorter');
  assert.equal(W.compareHeads(kept, { epoch: toHex(E), rows: 10, hash: toHex(H10) }, null), 'same');
  assert.equal(W.compareHeads(kept, { epoch: toHex(E), rows: 10, hash: toHex(NOT_H10) }, null), 'rewritten');
});

test('prefixToAsk picks the newest shorter look in this epoch, or nothing', () => {
  const W = loadWitness();
  const seen = [{ epoch: 'e', rows: 10, hash: 'a', at: 1 }, { epoch: 'e', rows: 12, hash: 'b', at: 2 }, { epoch: 'x', rows: 13, hash: 'c', at: 3 }];
  assert.equal(W.prefixToAsk(seen, { epoch: 'e', rows: 14 }), 12);
  assert.equal(W.prefixToAsk([{ epoch: 'e', rows: 14, hash: 'a', at: 1 }], { epoch: 'e', rows: 14 }), null);
  assert.equal(W.prefixToAsk([], { epoch: 'e', rows: 14 }), null);
});

test('keptHeadsFrom reads a v2 proof bundle or a bare signed head, and nothing else', async () => {
  const W = loadWitness();
  const receipt = await signedHead(10, H10);
  const check = await signedHead(12, H12);
  const bundle = {
    format: 'table.proof.v2', exported_at: T0,
    house: { release, heads: [{ receipt: false, head: check, prefix: null, kept_at: T0 + 900 }, { receipt: true, head: receipt, prefix: null, kept_at: T0 + 60 }] },
  };
  const fromBundle = W.keptHeadsFrom(JSON.stringify(bundle));
  assert.equal(fromBundle.heads.length, 2);
  assert.equal(fromBundle.heads[0].receipt, true, 'the receipt head first');
  assert.equal(fromBundle.heads[0].head.head.row_count, 10);
  assert.equal(fromBundle.heads[1].receipt, false);
  const bare = W.keptHeadsFrom(JSON.stringify(receipt));
  assert.equal(bare.heads.length, 1);
  assert.equal(bare.heads[0].head.head.row_count, 10);
  for (const text of ['{"format":"table.proof.v2","deal":{}}', '{"hello":1}', 'not json', '[1,2]', `"${'x'.repeat(2 * 1024 * 1024 + 1)}"`]) {
    const r = W.keptHeadsFrom(text);
    assert.equal(r.heads.length, 0, text.slice(0, 40));
    assert.equal(r.reason, 'not_a_head');
  }
});

test('witnessVerdict: a head not signed by this house is bad_signature and asks no prefix', async () => {
  const W = loadWitness();
  const view = { release, head: await signedHead(14, H14) };
  const asked = [];
  const io = { fetchPrefix: async (rows) => { asked.push(rows); return signedPrefix(rows, H10, 14); } };
  const forged = await signedHead(10, H10, { key: stranger.privateKey });
  assert.equal(await W.witnessVerdict({ head: forged }, view, io), 'bad_signature');
  assert.deepEqual(asked, []);
  // The same head signed by the house: one prefix at its row count, and it extends.
  assert.equal(await W.witnessVerdict({ head: await signedHead(10, H10) }, view, io), 'extends');
  assert.deepEqual(asked, [10]);
  // A prefix the house did not sign proves nothing.
  const unsigned = { fetchPrefix: async (rows) => ({ ...(await signedPrefix(rows, NOT_H10, 14, { key: stranger.privateKey })) }) };
  assert.equal(await W.witnessVerdict({ head: await signedHead(10, H10) }, view, unsigned), 'bad_prefix');
  // Rewritten, then grown longer.
  const rewritten = { fetchPrefix: async (rows) => signedPrefix(rows, NOT_H10, 14) };
  assert.equal(await W.witnessVerdict({ head: await signedHead(10, H10) }, view, rewritten), 'rewritten');
  // No answer (the house was busy): longer, not a failure.
  assert.equal(await W.witnessVerdict({ head: await signedHead(10, H10) }, view, { fetchPrefix: async () => null }), 'longer');
});

test('lookToSave exports a signed head the offline checker reads; legacy looks load but do not export', async () => {
  const W = loadWitness();
  const live = await signedHead(14, H14);
  const saved = W.lookToSave(live);
  assert.deepEqual(Object.keys(saved).sort(), ['head', 'signature']);
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), live);
  // A look the page stored keeps its signature and exports the same head.
  const stored = W.lookOf(live);
  assert.deepEqual(JSON.parse(JSON.stringify(W.lookToSave(stored))), live);
  // An old look (before signatures were kept) still loads, compares, and does not export.
  const legacy = { epoch: toHex(E), rows: 10, hash: toHex(H10), at: T0, started: T0 };
  const looks = W.looksFrom(JSON.stringify([legacy, { junk: true }, stored]));
  assert.equal(looks.length, 2);
  assert.equal(W.lookToSave(looks[0]), null);
  assert.equal(W.compareHeads(looks[0], looks[1], null), 'longer');
});

// ---- the page: scoreboard.js's real load path against a stubbed fetch -------------------------

class FakeNode {}
class FakeText extends FakeNode {
  constructor(s) { super(); this.textContent = s; }
}
class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    Object.assign(this, { tag, children: [], attrs: {}, listeners: {}, className: '', hidden: false, value: '', disabled: false, parentElement: null });
  }
  append(...items) {
    for (const x of items) {
      const n = x instanceof FakeNode ? x : new FakeText(String(x));
      n.parentElement = this;
      this.children.push(n);
    }
  }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  set textContent(v) { this.children = [new FakeText(String(v))]; }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  setAttribute(k, v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(type, f) { (this.listeners[type] ||= []).push(f); }
  click() {}
  querySelectorAll() { return []; }
}

/** Runs witness.js then scoreboard.js as the page does, and fires DOMContentLoaded. */
function openPage({ routes, stored }) {
  const ids = new Map();
  const byId = (id) => {
    if (!ids.has(id)) { const el = new FakeElement('div'); el.id = id; el.parentElement = new FakeElement('div'); ids.set(id, el); }
    return ids.get(id);
  };
  const docListeners = {};
  const document = {
    documentElement: new FakeElement('html'),
    hidden: false,
    getElementById: byId,
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    addEventListener: (type, f) => { (docListeners[type] ||= []).push(f); },
  };
  const store = new Map(stored ? [['table-house-heads', JSON.stringify(stored)]] : []);
  const localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, String(v)); } };
  const fetched = [];
  const fetch = async (url) => {
    fetched.push(url);
    for (const [prefix, answer] of routes) {
      if (url.startsWith(prefix)) {
        const a = typeof answer === 'function' ? await answer(url) : answer;
        return { ok: a.status === 200, status: a.status, json: async () => JSON.parse(JSON.stringify(a.body)) };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const context = vm.createContext({
    document, localStorage, fetch, crypto, TextEncoder, Node: FakeNode,
    navigator: {}, URL, Blob,
    setInterval: () => 0, setTimeout, clearTimeout, getComputedStyle: () => ({ colorScheme: 'light' }),
  });
  context.globalThis = context;
  // The page loads whatever scripts index.html names, in order.
  for (const [, name] of source('index.html').matchAll(/<script src="\/house\/([\w.]+)"/g)) {
    vm.runInContext(source(name), context, { filename: name });
  }
  for (const f of docListeners.DOMContentLoaded || []) f();
  return { byId, fetched, store };
}
const text = (n) => n.textContent;
/** The rendered check whose title names removal or rewriting, once the checks have rendered. */
async function headsCheck(page) {
  for (let i = 0; i < 400; i += 1) {
    const items = page.byId('checks').children;
    if (items.length > 1) {
      const li = items.find((c) => /shorter|rewritten/i.test(text(c.children[1] || c)));
      assert.ok(li, 'the record-history check is rendered');
      return { state: li.className.replace('check ', ''), title: text(li.children[1]), detail: text(li.children[2]) };
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`the checks never rendered: ${text(page.byId('checks'))}`);
}
async function ledgerWith(head) {
  return {
    format: 'table.house.ledger.v1', deals: [], more: false, total: 0, head,
    release, mandate: { payload: { agent_key: agentKey, clauses: [] }, owner_sig: filled(4) },
    refusals: { daily_limit: 0, full: 0, other: 0, since: T0 },
  };
}
const earlierLook = { epoch: toHex(E), rows: 10, hash: toHex(H10), at: T0 + 600, started: T0 };

test('page: a record rewritten and then grown longer than this browser’s look reads Rewritten', async () => {
  const view = await ledgerWith(await signedHead(14, H14));
  const page = openPage({
    stored: [earlierLook],
    routes: [['/v1/house/ledger', { status: 200, body: view }], ['/v1/house/prefix?rows=10', { status: 200, body: await signedPrefix(10, NOT_H10, 14) }]],
  });
  const check = await headsCheck(page);
  assert.ok(page.fetched.some((u) => u.startsWith('/v1/house/prefix?rows=10')), `the page asked the house to sign its hash at the earlier look: ${page.fetched}`);
  assert.equal(check.state, 'bad', `${check.title}: ${check.detail}`);
  assert.match(check.detail, /Rewritten/);
});

test('page: a record that extends this browser’s look reads Extends, signed by the house', async () => {
  const view = await ledgerWith(await signedHead(14, H14));
  const page = openPage({
    stored: [earlierLook],
    routes: [['/v1/house/ledger', { status: 200, body: view }], ['/v1/house/prefix?rows=10', { status: 200, body: await signedPrefix(10, H10, 14) }]],
  });
  const check = await headsCheck(page);
  assert.equal(check.state, 'ok', `${check.title}: ${check.detail}`);
  assert.match(check.detail, /Extends/);
  const saved = JSON.parse(page.store.get('table-house-heads'));
  assert.equal(saved.length, 2, 'the new look is kept');
  assert.ok(typeof saved[1].sig === 'string' && saved[1].sig.length === 128, 'with its signature');
});

test('page: a prefix the house key did not sign is a failure, not a pass', async () => {
  const view = await ledgerWith(await signedHead(14, H14));
  const page = openPage({
    stored: [earlierLook],
    routes: [['/v1/house/ledger', { status: 200, body: view }], ['/v1/house/prefix?rows=10', { status: 200, body: await signedPrefix(10, H10, 14, { key: stranger.privateKey }) }]],
  });
  const check = await headsCheck(page);
  assert.equal(check.state, 'bad', `${check.title}: ${check.detail}`);
});

test('page: a busy house (429 on the prefix) leaves the check unconfirmed, never failed', async () => {
  const view = await ledgerWith(await signedHead(14, H14));
  const page = openPage({
    stored: [earlierLook],
    routes: [['/v1/house/ledger', { status: 200, body: view }], ['/v1/house/prefix', { status: 429, body: {} }]],
  });
  const check = await headsCheck(page);
  assert.equal(check.state, 'unknown', `${check.title}: ${check.detail}`);
});

// ---- the page's own words: the check list and the tiles ----------------------------------------

/** One agreed deal at `price` minor units against an ask of `ask`. */
function agreedDeal(id, ask, price) {
  const usd = (minor) => ({ minor, currency: 'USD' });
  return {
    deal_id: id, created_at: T0, updated_at: T0, item_ref: 'monitor', ask: usd(ask), price: usd(price), state: 'CAPTURED',
    guest: 'abcdef012345', rounds: [], refused_intents: 0, paypal_calls: 0, money: [], transcript_head: filled(5),
    closed: [{ attempt: 1, hash: filled(6), open_mandate_hash: filled(3), amount: usd(price), decided_by: { type: 'house_mandate', mandate_hash: filled(3) } }],
    decided_by: null,
  };
}
async function rendered(page, id, from) {
  for (let i = 0; i < 400; i += 1) {
    const t = text(page.byId(id));
    if (t && t !== from) return t;
    await new Promise((r) => setTimeout(r, 5));
  }
  return text(page.byId(id));
}

test('page: every check line voices its result, not only an icon', async () => {
  const view = await ledgerWith(await signedHead(14, H14));
  const page = openPage({ routes: [['/v1/house/ledger', { status: 200, body: view }]] });
  await headsCheck(page);
  const lines = page.byId('checks').children;
  assert.ok(lines.length >= 8, `${lines.length} checks`);
  for (const li of lines) {
    const icon = li.children[0];
    // aria-label on a plain span names nothing (a generic role takes no name): it must be an image.
    assert.equal(icon.attrs.role, 'img', `${text(li.children[1])}: the result icon has a role`);
    assert.match(icon.attrs['aria-label'] || '', /^(Passed|Failed|Note|Not checked here)$/);
  }
});

test('page: a price agreed just above the ask reads as a premium, never as a discount', async () => {
  const view = await ledgerWith(await signedHead(14, H14));
  // 20.10 against 20.00 is 0.5% above the ask.
  view.deals = [agreedDeal('01ARZ3NDEKTSV4RRFFQ69G5FAV', 2000, 2010)];
  view.total = 1;
  const page = openPage({ routes: [['/v1/house/ledger', { status: 200, body: view }]] });
  const shown = await rendered(page, 't-discount', '');
  assert.equal(shown, '−0.5%');
});

// ---- one rule for "shorter", and a tile that means what its caption says -----------------------

test('page: a shorter record reads bad whether or not the new head is signed later than the look', async () => {
  // The house served 10 entries, signed at T0+1000; this browser kept 14 entries at T0+2000 (a
  // clock set back on a restored disk) or at T0+500 (an ordinary later visit). Both are removals.
  for (const at of [T0 + 2000, T0 + 500]) {
    const view = await ledgerWith(await signedHead(10, H10, { at: T0 + 1000 }));
    const page = openPage({
      stored: [{ epoch: toHex(E), rows: 14, hash: toHex(H14), at, started: T0 }],
      routes: [['/v1/house/ledger', { status: 200, body: view }]],
    });
    const check = await headsCheck(page);
    assert.equal(check.state, 'bad', `look at ${at - T0}: ${check.title}: ${check.detail}`);
    assert.match(check.detail, /It had 14 entries/);
  }
});

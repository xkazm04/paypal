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


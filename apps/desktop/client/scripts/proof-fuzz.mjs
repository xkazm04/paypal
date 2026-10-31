#!/usr/bin/env node
// Makes a corpus of random edits to the proof files the browser checker is tested on (the practice deals and
// the files the wallet's own runtime wrote): `node scripts/proof-fuzz.mjs <count> <seed> > fuzz-in.json`.
// Each entry is a source file and one to three edits (set, remove, or add one past the end of a list). Then
// `cargo run -p table-client --features samples --bin fuzz-proofs -- fuzz-in.json src/lib/proof/fuzz.json` applies the edits
// with the wallet's verifier and keeps a digest of what it says about each edited file; `fuzz.test.ts` makes
// the browser checker say the same, byte for byte, about every one.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , countArg, seedArg] = process.argv;
const count = Number(countArg ?? 200);
let seed = Number(seedArg ?? 1) >>> 0;
const rnd = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const pick = (list) => list[Math.floor(rnd() * list.length)];

const proofDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'proof');
const sources = ['real', 'sample'].flatMap((dir) => readdirSync(join(proofDir, dir)).filter((f) => f.endsWith('.tableproof')).map((f) => `${dir}/${f.replace('.tableproof', '')}`));
const load = (source) => JSON.parse(readFileSync(join(proofDir, `${source}.tableproof`), 'utf8'));

const walk = (value, path = '', out = []) => {
  out.push(path);
  if (Array.isArray(value)) value.forEach((x, i) => walk(x, `${path}/${i}`, out));
  else if (value && typeof value === 'object') for (const key of Object.keys(value)) walk(value[key], `${path}/${key}`, out);
  return out;
};
const at = (doc, path) => path.split('/').slice(1).reduce((x, key) => x?.[key], doc);
const isBytes = (v) => Array.isArray(v) && v.length >= 8 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);

/** Applies an edit to the working copy (the same rules the checkers' own `apply` has). */
const apply = (doc, edit) => {
  const cut = edit.path.lastIndexOf('/');
  const parent = at(doc, edit.path.slice(0, cut));
  const key = edit.path.slice(cut + 1);
  if (Array.isArray(parent)) {
    if (edit.op === 'set') parent[Number(key)] = edit.value;
    else parent.splice(Number(key), 1);
  } else if (edit.op === 'set') parent[key] = edit.value;
  else delete parent[key];
};

/** One random edit of the working copy, as an edit; null when the draw has nothing to do. */
const edit = (doc) => {
  const path = pick(walk(doc).filter((p) => p !== ''));
  const value = at(doc, path);
  const set = (v) => ({ op: 'set', path, value: v });
  const kind = Math.floor(rnd() * 11);
  if (kind === 0 && typeof value === 'number') return set(value + pick([1, -1, 1000, 0, -value]));
  if (kind === 1 && typeof value === 'string') return set(value.length > 1 ? value.slice(0, -1) + pick(['x', '0', '"', '']) : `${value}x`);
  if (kind === 2 && typeof value === 'boolean') return set(!value);
  if (kind === 3) return { op: 'remove', path };
  if (kind === 4 && isBytes(value)) {
    const next = [...value];
    const i = Math.floor(rnd() * next.length);
    next[i] = ((next[i] ?? 0) + 1 + Math.floor(rnd() * 254)) % 256;
    return { op: 'set', path: `${path}/${i}`, value: next[i] };
  }
  if (kind === 5 && Array.isArray(value) && value.length > 1) {
    const i = Math.floor(rnd() * value.length);
    const j = Math.floor(rnd() * value.length);
    return i === j ? null : { op: 'set', path: `${path}/${i}`, value: value[j] };
  }
  if (kind === 6 && Array.isArray(value) && value.length > 0) return { op: 'set', path: `${path}/${value.length}`, value: JSON.parse(JSON.stringify(pick(value))) };
  if (kind === 7 && value && typeof value === 'object' && !Array.isArray(value)) return { op: 'set', path: `${path}/zz_extra`, value: 1 };
  if (kind === 8) return set(pick([null, 0, '', [], {}, true, 'x', -1, 1.5]));
  if (kind === 9 && typeof value === 'string' && value.includes('.')) {
    const parts = value.split('.');
    parts[Math.floor(rnd() * parts.length)] = pick(['', 'AAAA', 'e30']);
    return set(parts.join('.'));
  }
  if (kind === 10 && typeof value === 'number') return set(pick([2 ** 53 - 1, -1, 1e21, 4294967296, 256, 65536]));
  return null;
};

const corpus = [];
while (corpus.length < count) {
  const source = pick(sources);
  const doc = load(source);
  const edits = [];
  for (let n = 1 + Math.floor(rnd() * 3); n > 0; n--) {
    const e = edit(doc);
    if (!e) continue;
    apply(doc, e);
    edits.push(e);
  }
  if (edits.length > 0) corpus.push({ source, edits });
}
console.log(JSON.stringify(corpus, null, 1));

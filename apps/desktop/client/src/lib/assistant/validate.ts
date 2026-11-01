// The ONE validation door: every reply, from any engine, passes here before the board sees it.
// Accepts anything (a JSON string, an object, garbage) and never throws. Salvages every valid op,
// drops the rest and COUNTS them with a fixed-word reason (never model text), rebuilds each kept op
// from the registry (fresh objects: unknown keys never survive).
//
// Decisions (documented, tested):
//  - Text fields (`say`, `propose.why`) are CLEANED, not dropped: control and invisible characters,
//    markup, entities, URLs, backticks, braces and brackets are removed, whitespace collapsed, then
//    capped (say 600, why 160). A cleaned field marks the reply `repaired`. A `why` that is empty
//    after cleaning drops its op (a proposal with no stated reason must not be shown).
//  - Identifier fields (deal ids, hash, targets, module, fate) are never repaired: wrong means drop.
//  - An `act` action (ACTION_CLASS) with any key it does not define is dropped, not repaired: the
//    one thing that can change the wallet is never rebuilt from a damaged proposal.
//  - Nullable fields that are omitted count as null (the contract says null, never omitted): repaired.
//  - More than 8 ops: the first 8 are examined, the rest dropped as one count each.
//  - `dropped.reasons` lists each distinct reason once, in first-seen order; `count` counts parts.
import type { ActionRef, PanelSpec, UiOp, ValidatedReply } from './contract';
import { ASSISTANT_V, FATES, MODULE_KEYS, PANEL_KINDS } from './contract';
import { ACTION_CLASS, ACTIONS, AGENT_SLOTS, DEAL_ID_RE, DEAL_ID_MAX, HASH_RE, OPS, OPS_MAX, PANELS, SAY_MAX, SETUP_TARGETS, WHY_MAX, type EntryDef, type FieldDef } from './vocabulary';

export type Known = { dealIds: ReadonlySet<string> };

/** Fixed reason words (the only strings that ever appear in `dropped.reasons`). */
export const DROP_REASONS = [
  'unreadable', 'too_many_ops', 'unknown_op', 'bad_panel', 'bad_action', 'unknown_deal', 'bad_module', 'bad_fate', 'bad_hash', 'bad_why', 'bad_shape', 'bad_say',
] as const;
export type DropReason = (typeof DROP_REASONS)[number];

const INVISIBLE = new RegExp('[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF]', 'g');
const TAGS = /<[^>]*>/g;
const ENTITIES = /&(?:#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,10});/gi;
const URLS = [
  /\b[a-z][a-z0-9+.-]{1,20}:\/\/\S*/gi,
  /\b(?:javascript|data|vbscript|file|mailto|blob|about):\S*/gi,
  /\bwww\.\S+/gi,
  /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*/gi,
  /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|dev|app|xyz|ru|cn|info|co|me|ly|biz|top|tk)\b\S*/gi,
];
const SYMBOLS = /[<>`{}[\]]/g;

/** Plain text only: no control or invisible characters, markup, entities, URLs, backticks, braces or
 *  brackets; whitespace collapsed; at most `max` characters. The single cleaner for the whole feature
 *  (the digest and the scripted engine use it too). */
export function cleanText(raw: string, max: number): string {
  let s = raw.replace(/[\r\n\t\v\f]/g, ' ').replace(INVISIBLE, '');
  s = s.replace(TAGS, ' ').replace(ENTITIES, ' ');
  for (const re of URLS) s = s.replace(re, ' ');
  s = s.replace(SYMBOLS, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max).trimEnd() : s;
}

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const get = (o: Record<string, unknown>, k: string): unknown => (own(o, k) ? o[k] : undefined);

const MAX_INPUT = 200_000;

/** Turn the raw input into an object, or null. `salvaged` is true when text had to be fished out. */
function coerce(raw: unknown): { obj: Record<string, unknown>; salvaged: boolean } | null {
  let value = raw;
  let salvaged = false;
  for (let round = 0; round < 2 && typeof value === 'string'; round++) {
    const text = value.trim();
    if (text.length === 0 || text.length > MAX_INPUT) return null;
    const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(unfenced);
      if (unfenced !== text) salvaged = true;
    } catch {
      const a = unfenced.indexOf('{');
      const b = unfenced.lastIndexOf('}');
      if (a < 0 || b <= a) return null;
      try { parsed = JSON.parse(unfenced.slice(a, b + 1)); } catch { return null; }
      salvaged = true;
    }
    value = parsed;
  }
  return isObj(value) ? { obj: value, salvaged } : null;
}

type Fail = { ok: false; reason: DropReason };
type Ok<T> = { ok: true; value: T; changed: boolean };
type Res<T> = Ok<T> | Fail;
const fail = (reason: DropReason): Fail => ({ ok: false, reason });

/** Check one field against its registry definition. */
function checkField(d: FieldDef, o: Record<string, unknown>, known: Known): Res<unknown> {
  let v = get(o, d.name);
  let changed = false;
  if (v === undefined && d.nullable) { v = null; changed = true; }
  if (v === null && d.nullable) return { ok: true, value: null, changed };
  switch (d.kind) {
    case 'module':
      return typeof v === 'string' && (MODULE_KEYS as readonly string[]).includes(v) ? { ok: true, value: v, changed } : fail('bad_module');
    case 'fate':
      return typeof v === 'string' && (FATES as readonly string[]).includes(v) ? { ok: true, value: v, changed } : fail('bad_fate');
    case 'deal_id':
      return typeof v === 'string' && v.length <= DEAL_ID_MAX && known.dealIds.has(v) ? { ok: true, value: v, changed } : fail('unknown_deal');
    case 'setup_target':
      return typeof v === 'string' && (SETUP_TARGETS as readonly string[]).includes(v) ? { ok: true, value: v, changed } : fail('bad_action');
    case 'agent':
      return typeof v === 'string' && (AGENT_SLOTS as readonly string[]).includes(v) ? { ok: true, value: v, changed } : fail('bad_action');
    case 'hash': {
      if (typeof v !== 'string' || !HASH_RE.test(v)) return fail('bad_hash');
      const deal = v.startsWith('#d=') ? v.slice(3) : null;
      if (deal !== null && !(DEAL_ID_RE.test(deal) && known.dealIds.has(deal))) return fail('unknown_deal');
      return { ok: true, value: v, changed };
    }
    case 'why': {
      if (typeof v !== 'string') return fail('bad_why');
      const cleaned = cleanText(v, WHY_MAX);
      return cleaned ? { ok: true, value: cleaned, changed: changed || cleaned !== v } : fail('bad_why');
    }
    default:
      return fail('bad_shape');
  }
}

/** Rebuild an entry (panel, action or op) from the registry: tag + checked fields, nothing else. */
function checkEntry(
  tag: 'kind' | 'op' | 'action',
  def: EntryDef,
  o: Record<string, unknown>,
  known: Known,
  nested: (d: FieldDef, v: unknown) => Res<unknown> | null,
): Res<Record<string, unknown>> {
  const out: Record<string, unknown> = { [tag]: def.name };
  let changed = Object.keys(o).some((k) => k !== tag && !def.fields.some((d) => d.name === k));
  for (const d of def.fields) {
    const r = d.kind === 'panel' || d.kind === 'action' ? nested(d, get(o, d.name)) : checkField(d, o, known);
    if (!r) return fail('bad_shape');
    if (!r.ok) return r;
    out[d.name] = r.value;
    changed = changed || r.changed;
  }
  return { ok: true, value: out, changed };
}

function checkPanel(v: unknown, known: Known): Res<PanelSpec> {
  if (!isObj(v)) return fail('bad_panel');
  const kind = get(v, 'kind');
  if (typeof kind !== 'string' || !(PANEL_KINDS as readonly string[]).includes(kind)) return fail('bad_panel');
  const r = checkEntry('kind', PANELS[kind as keyof typeof PANELS], v, known, () => null);
  return r.ok ? { ok: true, value: r.value as PanelSpec, changed: r.changed } : r;
}

function checkAction(v: unknown, known: Known): Res<ActionRef> {
  if (!isObj(v)) return fail('bad_action');
  const a = get(v, 'action');
  if (typeof a !== 'string' || !own(ACTIONS, a)) return fail('bad_action');
  // An act changes the wallet: a stray key on it (an amount, an id, a command name) is not trimmed
  // away quietly; the whole proposal is dropped and counted.
  const def = ACTIONS[a as ActionRef['action']];
  if (ACTION_CLASS[a as ActionRef['action']] === 'act' && Object.keys(v).some((k) => k !== 'action' && !def.fields.some((d) => d.name === k))) return fail('bad_action');
  const r = checkEntry('action', ACTIONS[a as ActionRef['action']], v, known, () => null);
  return r.ok ? { ok: true, value: r.value as ActionRef, changed: r.changed } : r;
}

function checkOp(v: unknown, known: Known): Res<UiOp> {
  if (!isObj(v)) return fail('bad_shape');
  const op = get(v, 'op');
  if (typeof op !== 'string' || !own(OPS, op)) return fail('unknown_op');
  const nested = (d: FieldDef, x: unknown): Res<unknown> => (d.kind === 'panel' ? checkPanel(x, known) : checkAction(x, known));
  const r = checkEntry('op', OPS[op as UiOp['op']], v, known, nested);
  return r.ok ? { ok: true, value: r.value as UiOp, changed: r.changed } : r;
}

const unreadable = (): ValidatedReply => ({ say: '', ops: [], dropped: { count: 1, reasons: ['unreadable'] }, repaired: false });

/** The door. Never throws. */
export function validateReply(raw: unknown, known: Known): ValidatedReply {
  try {
    const got = coerce(raw);
    if (!got) return unreadable();
    const o = got.obj;
    const v = get(o, 'v');
    if (v !== undefined && v !== ASSISTANT_V) return unreadable();
    const rawSay = get(o, 'say');
    const rawOps = get(o, 'ops');
    if (typeof rawSay !== 'string' && !Array.isArray(rawOps)) return unreadable();

    let changed = got.salvaged || v === undefined;
    let count = 0;
    const reasons: DropReason[] = [];
    const drop = (r: DropReason, n = 1): void => { count += n; if (!reasons.includes(r)) reasons.push(r); };

    let say = '';
    if (typeof rawSay === 'string') {
      say = cleanText(rawSay, SAY_MAX);
      if (say !== rawSay) changed = true;
    } else if (rawSay !== undefined) {
      drop('bad_say');
    } else changed = true;

    const ops: UiOp[] = [];
    if (Array.isArray(rawOps)) {
      if (rawOps.length > OPS_MAX) drop('too_many_ops', rawOps.length - OPS_MAX);
      for (const item of rawOps.slice(0, OPS_MAX)) {
        const r = checkOp(item, known);
        if (r.ok) { ops.push(r.value); changed = changed || r.changed; } else drop(r.reason);
      }
    } else if (rawOps !== undefined) {
      drop('bad_shape');
    } else changed = true;

    return { say, ops, dropped: { count, reasons }, repaired: changed || count > 0 };
  } catch {
    return unreadable();
  }
}

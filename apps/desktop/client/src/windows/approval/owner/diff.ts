// Signed version vs draft: one entry per changed term, each marked widens (more the agent may do
// without you), restricts, or changes (neither: a different kind, slot or currency). Pure.
import type { AgentSlot } from '@bindings/AgentSlot';
import type { Clause } from '@bindings/Clause';
import type { Currency } from '@bindings/Currency';
import type { Money } from '@bindings/Money';
import { formatMinor, shortId } from '../../../lib/format';
import { CLAUSE_KINDS, CLAUSE_NUMBER, isIncomplete, type ClauseType, type DraftClause } from '../mandateDraft';
import type { ReplayRow } from './preview';

export type Dir = 'widens' | 'restricts' | 'changes';
export type Change = { clause: number; type: ClauseType | 'meta'; term: string; from: string; to: string; dir: Dir; text: string };

export type DiffSide = { clauses: readonly DraftClause[]; agent: AgentSlot; currency: Currency; expires: number | null };

const name = (t: ClauseType) => CLAUSE_KINDS.find((k) => k.type === t)?.name ?? t;
const m = (x: Money | null | undefined) => (x ? formatMinor(x.minor, x.currency) : 'none');
/** Times are typed to the minute (datetime-local), so they compare to the minute. */
const minute = (t: number) => Math.floor(t / 60);
const RANK = { house: 0, pinned: 1, paired: 2 } as const;
const RULE = { house: 'only the house seller', pinned: 'only listed wallets', paired: 'any wallet you connected' } as const;

/** A changed term in plain words (the term itself stays the stable key the tests pin). */
const TERM_WORD: Record<string, string> = {
  'per-deal max': 'limit per deal', 'band ceiling': 'most you’ll pay', 'band floor': 'least you’ll accept', 'max rounds': 'offer limit',
  'band deadline': 'price-range end', 'band items': 'items with a price range', 'money per day': 'daily money limit', 'deals per day': 'deals per day',
  '“you decide over” threshold': 'ask-me limit', 'the payee allowlist': 'approved payees', 'pinned keys': 'listed wallets', 'deal kind': 'what it covers',
  'agent slot': 'agent', roles: 'what agents may do', counterparties: 'who they deal with', categories: 'categories', currency: 'currency', expiry: 'end date',
};
export const termWord = (term: string): string => TERM_WORD[term] ?? term;

function num(out: Change[], c: number, type: ClauseType, term: string, a: number, b: number, fmt: (v: number) => string, upWidens: boolean) {
  if (a === b) return;
  const up = b > a;
  out.push({ clause: c, type, term, from: fmt(a), to: fmt(b), dir: up === upWidens ? 'widens' : 'restricts', text: `${up ? 'Raising' : 'Lowering'} the ${termWord(term)} ${fmt(a)} → ${fmt(b)}` });
}
function members(out: Change[], c: number, type: ClauseType, term: string, a: readonly string[], b: readonly string[], addWidens: boolean) {
  for (const v of b) if (!a.includes(v)) out.push({ clause: c, type, term, from: '—', to: v, dir: addWidens ? 'widens' : 'restricts', text: `Adding ${v} to ${termWord(term)}` });
  for (const v of a) if (!b.includes(v)) out.push({ clause: c, type, term, from: v, to: '—', dir: addWidens ? 'restricts' : 'widens', text: `Removing ${v} from ${termWord(term)}` });
}
function money(out: Change[], c: number, type: ClauseType, term: string, a: Money | null, b: Money | null, upWidens: boolean) {
  if (a && b && a.currency === b.currency) return num(out, c, type, term, a.minor, b.minor, (v) => formatMinor(v, a.currency), upWidens);
  if (a?.minor === b?.minor && a?.currency === b?.currency) return;
  out.push({ clause: c, type, term, from: m(a), to: m(b), dir: 'changes', text: `Setting the ${termWord(term)} ${m(a)} → ${m(b)}` });
}

function clauseDiff(a: Clause, b: Clause, out: Change[]) {
  const c = CLAUSE_NUMBER[a.type];
  if (a.type === 'roles' && b.type === 'roles') members(out, c, 'roles', 'roles', a.roles, b.roles, true);
  else if (a.type === 'counterparties' && b.type === 'counterparties') {
    if (a.rule.type !== b.rule.type) {
      out.push({ clause: c, type: 'counterparties', term: 'counterparties', from: RULE[a.rule.type], to: RULE[b.rule.type], dir: RANK[b.rule.type] > RANK[a.rule.type] ? 'widens' : 'restricts', text: `Changing who they deal with to “${RULE[b.rule.type]}”` });
    } else if (a.rule.type === 'pinned' && b.rule.type === 'pinned') {
      members(out, c, 'counterparties', 'pinned keys', a.rule.keys.map((k) => shortId(k)), b.rule.keys.map((k) => shortId(k)), true);
    }
  } else if (a.type === 'per_deal' && b.type === 'per_deal') {
    if (a.kind !== b.kind) out.push({ clause: c, type: 'per_deal', term: 'deal kind', from: a.kind, to: b.kind, dir: 'changes', text: `Changing what it covers ${a.kind} → ${b.kind}` });
    money(out, c, 'per_deal', 'per-deal max', a.max_amount, b.max_amount, true);
    members(out, c, 'per_deal', 'categories', a.categories, b.categories, true);
  } else if (a.type === 'band' && b.type === 'band') {
    members(out, c, 'band', 'band items', a.item_refs, b.item_refs, true);
    money(out, c, 'band', 'band ceiling', a.ceiling, b.ceiling, true);
    money(out, c, 'band', 'band floor', a.floor, b.floor, false);
    num(out, c, 'band', 'max rounds', a.max_rounds, b.max_rounds, String, true);
    if (minute(a.deadline) !== minute(b.deadline)) num(out, c, 'band', 'band deadline', a.deadline, b.deadline, (v) => new Date(v * 1000).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }), true);
  } else if (a.type === 'velocity' && b.type === 'velocity') {
    num(out, c, 'velocity', 'deals per day', a.max_deals_day, b.max_deals_day, String, true);
    money(out, c, 'velocity', 'money per day', a.max_total_day, b.max_total_day, true);
  } else if (a.type === 'human_present_over' && b.type === 'human_present_over') {
    money(out, c, 'human_present_over', '“you decide over” threshold', a.amount, b.amount, true);
  } else if (a.type === 'payees' && b.type === 'payees') {
    members(out, c, 'payees', 'the payee allowlist', a.payees, b.payees, true);
  }
}

/**
 * Every changed term from `base` (the signed version; null = a new mandate) to `draft`.
 * Incomplete draft clauses are left out: they have field errors and cannot be signed yet.
 */
export function diffPolicy(base: DiffSide | null, draft: DiffSide): Change[] {
  const out: Change[] = [];
  const done = (cs: readonly DraftClause[]) => cs.filter((c): c is Clause => !isIncomplete(c));
  const a = base ? done(base.clauses) : [];
  const b = done(draft.clauses);
  if (base && base.agent !== draft.agent) out.push({ clause: 0, type: 'meta', term: 'agent slot', from: base.agent, to: draft.agent, dir: 'changes', text: `Signing these rules for your ${draft.agent} agent instead of your ${base.agent}` });
  if (base && base.currency !== draft.currency) out.push({ clause: 0, type: 'meta', term: 'currency', from: base.currency, to: draft.currency, dir: 'changes', text: `Changing the currency ${base.currency} → ${draft.currency}` });
  if (base && base.expires !== null && draft.expires !== null && minute(base.expires) !== minute(draft.expires)) {
    const fmt = (v: number) => new Date(v * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    out.push({ clause: 0, type: 'meta', term: 'expiry', from: fmt(base.expires), to: fmt(draft.expires), dir: draft.expires > base.expires ? 'widens' : 'restricts', text: `Moving the end date ${fmt(base.expires)} → ${fmt(draft.expires)}` });
  }
  for (const k of CLAUSE_KINDS) {
    const x = a.find((c) => c.type === k.type);
    const y = b.find((c) => c.type === k.type);
    const n = CLAUSE_NUMBER[k.type];
    if (x && y) clauseDiff(x, y, out);
    else if (x && !y && !draft.clauses.some((c) => c.type === k.type)) out.push({ clause: n, type: k.type, term: name(k.type).toLowerCase(), from: 'signed', to: 'removed', dir: 'widens', text: `Removing “${name(k.type)}”` });
    else if (!x && y) out.push({ clause: n, type: k.type, term: name(k.type).toLowerCase(), from: base ? 'none' : '—', to: 'added', dir: base ? 'restricts' : 'changes', text: `Adding “${name(k.type)}”` });
  }
  return out;
}

/** The signed clauses with only one clause kind taken from the draft, so a consequence can be
 *  pinned to the change that caused it. */
export function oneClauseFromDraft(base: readonly Clause[], draft: readonly DraftClause[], type: ClauseType): DraftClause[] {
  const fromDraft = draft.find((c) => c.type === type);
  const rest = base.filter((c) => c.type !== type);
  return fromDraft ? [...rest, fromDraft] : rest;
}

const join = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** "would have refused 01JD…7Q (cables) …" for the rows whose verdict moved. Empty when none moved. */
export function hitPhrase(rows: readonly ReplayRow[], tag: (r: ReplayRow) => string): string {
  const g = { refused: [] as string[], passed: [] as string[], asked: [] as string[], policy: [] as string[], unknown: [] as string[], other: [] as string[] };
  for (const r of rows) {
    if (!r.moved) continue;
    const t = tag(r);
    const a = r.signed.outcome;
    const b = r.draft.outcome;
    if (b === 'refused' && a !== 'refused') g.refused.push(t);
    else if (a === 'refused' && b !== 'refused' && b !== 'unknown') g.passed.push(t);
    else if (b === 'asks' && a === 'policy') g.asked.push(t);
    else if (b === 'policy' && a === 'asks') g.policy.push(t);
    else if (b === 'unknown' || a === 'unknown') g.unknown.push(t);
    else g.other.push(t);
  }
  const p: string[] = [];
  if (g.refused.length) p.push(`refused ${join(g.refused)} before PayPal was asked`);
  if (g.passed.length) p.push(`let ${join(g.passed)} through`);
  if (g.asked.length) p.push(`asked you about ${join(g.asked)} instead of letting the agent decide`);
  if (g.policy.length) p.push(`let the agent settle ${join(g.policy)} without asking you`);
  if (g.unknown.length) p.push(`changed ${join(g.unknown)} in a way this preview can’t finish (the wallet decides)`);
  if (g.other.length) p.push(`changed the reason on ${join(g.other)}`);
  return p.join('; ');
}

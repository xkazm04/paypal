// Mandate editor drafts: owner-typed strings for the clause kinds (bindings/Clause.ts),
// converted exactly into the Rust shapes. Rust validates and signs; this only shapes input.
import type { AgentSlot } from '@bindings/AgentSlot';
import type { Category } from '@bindings/Category';
import type { Clause } from '@bindings/Clause';
import type { Currency } from '@bindings/Currency';
import type { DealKind } from '@bindings/DealKind';
import type { OpenMandate } from '@bindings/OpenMandate';
import type { Role } from '@bindings/Role';
import { CLAUSE_NUMBER, REASON_WORDS, ruleRefusals, type IncompleteClause } from '../../lib/mandateRules';
import { MAX_MARKET_CHECKS_DAY, productValid } from '../../lib/marketWatch';
import { RULE_NAME } from '../../lib/words';
import { minorToInput, parseMoneyInput } from './model';

export type ClauseDraft =
  | { type: 'roles'; roles: Role[] }
  | { type: 'counterparties'; rule: 'paired' | 'house' | 'pinned' | 'subscribers'; keys: string }
  | { type: 'per_deal'; kind: DealKind; max: string; categories: Category[] }
  | { type: 'band'; items: string; floor: string; ceiling: string; rounds: string; deadline: string }
  | { type: 'velocity'; deals: string; total: string }
  | { type: 'human_present_over'; amount: string }
  | { type: 'payees'; payees: string }
  /** Rescue only: the discount the wallet may offer on one missed cycle (percent and money cap). */
  | { type: 'lever'; percent: string; max: string }
  | { type: 'market_watch'; items: WatchDraft[]; checks: string };

/** One watched item as typed: your item, and the product the market service prices it by. */
export type WatchDraft = { item: string; product: string };

export type ClauseType = ClauseDraft['type'];

export const CLAUSE_KINDS: ReadonlyArray<{ type: ClauseType; name: string; hint: string }> = [
  { type: 'roles', name: RULE_NAME.roles, hint: 'buy, sell, run your shop, rescue renewals' },
  { type: 'counterparties', name: RULE_NAME.counterparties, hint: 'which wallets they may talk to' },
  { type: 'per_deal', name: RULE_NAME.per_deal, hint: 'the most for any single deal' },
  { type: 'band', name: RULE_NAME.band, hint: 'most you’ll pay, least you’ll accept (buyers need the first, sellers the second), and how many offers' },
  { type: 'velocity', name: RULE_NAME.velocity, hint: 'deals and money per day' },
  { type: 'human_present_over', name: RULE_NAME.human_present_over, hint: 'above this amount, you decide' },
  { type: 'payees', name: RULE_NAME.payees, hint: 'who agents may pay on their own' },
  { type: 'lever', name: RULE_NAME.lever, hint: 'rescue only: the most a one-time discount on a missed cycle may take off' },
  { type: 'market_watch', name: RULE_NAME.market_watch, hint: 'check typical prices for your items on its own, a set number of times a day; it never approves anything' },
];

/** Rust's clause numbers (table-core Clause::number), from the one mirror in lib/mandateRules. */
export { CLAUSE_NUMBER };

/** "20" or "12.5" → basis points (2000, 1250); null when it is not a percent above 0 and below 100. */
export function percentToBp(s: string): number | null {
  const t = s.trim().replace(/%$/, '').trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  const bp = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return bp > 0 && bp < 10000 ? bp : null;
}
/** The typed share is not the signed one, read as the wallet reads it ("20%" and "20.0" are 2000). */
export const percentDiffers = (bp: number, typed: string): boolean => percentToBp(typed) !== bp;
/** 2000 → "20", 1250 → "12.5". */
export function bpToPercent(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

export const ROLES: readonly Role[] = ['buy', 'sell', 'shop', 'rescue'];
export const CATEGORIES: readonly Category[] = ['office', 'parts', 'compute', 'service', 'other'];
export const KINDS: readonly DealKind[] = ['purchase', 'haggle', 'shop_order', 'rescue', 'invoice'];

export type MandateDraft = {
  id: string | null;
  agent: AgentSlot;
  currency: Currency;
  notBefore: string;
  expires: string;
  clauses: ClauseDraft[];
};

/** Unix seconds → "YYYY-MM-DDTHH:MM" in local time for <input type="datetime-local">. */
export function toLocalInput(unix: number): string {
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fromLocalInput(s: string): number | null {
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

export function emptyClause(type: ClauseType, now: number): ClauseDraft {
  switch (type) {
    case 'roles': return { type, roles: ['buy'] };
    case 'counterparties': return { type, rule: 'paired', keys: '' };
    case 'per_deal': return { type, kind: 'purchase', max: '', categories: ['office'] };
    case 'band': return { type, items: '', floor: '', ceiling: '', rounds: '6', deadline: toLocalInput(now + 86400) };
    case 'velocity': return { type, deals: '12', total: '' };
    case 'human_present_over': return { type, amount: '' };
    case 'payees': return { type, payees: '' };
    case 'lever': return { type, percent: '20', max: '' };
    case 'market_watch': return { type, items: [{ item: '', product: '' }], checks: '12' };
  }
}

export function newDraft(now: number): MandateDraft {
  return {
    id: null,
    agent: 'negotiator',
    currency: 'USD',
    notBefore: toLocalInput(now),
    expires: toLocalInput(now + 30 * 86400),
    clauses: [emptyClause('roles', now), emptyClause('counterparties', now), emptyClause('human_present_over', now)],
  };
}

function firstCurrency(clauses: Clause[]): Currency {
  for (const c of clauses) {
    if (c.type === 'per_deal') return c.max_amount.currency;
    if (c.type === 'velocity') return c.max_total_day.currency;
    if (c.type === 'human_present_over') return c.amount.currency;
    if (c.type === 'band') return (c.ceiling ?? c.floor)?.currency ?? 'USD';
    if (c.type === 'lever') return c.max_discount.currency;
  }
  return 'USD';
}

/** A new version of an existing mandate starts from its signed clauses and, when mandate_list
 *  reported it (MandateListEntry.agent), the agent slot it is bound to. */
export function draftFrom(m: OpenMandate & { agent?: AgentSlot }, now: number): MandateDraft {
  const cur = firstCurrency(m.payload.clauses);
  return {
    id: m.payload.id,
    agent: m.agent ?? 'negotiator',
    currency: cur,
    notBefore: toLocalInput(Math.max(now, m.payload.not_before)),
    expires: toLocalInput(m.payload.expires),
    clauses: m.payload.clauses.map((c) => clauseDraft(c, cur)),
  };
}

/** A typed rule set carried from The Table (approval_open's `rules` draft: what the owner said in one
 *  sentence) as a new draft in the editor's own strings. It starts no earlier than the editor opened.
 *  Nothing in it is signed; the editor checks it like anything the owner types. */
export function draftFromRules(seed: { agent: AgentSlot; not_before: number; expires: number; clauses: Clause[] }, now: number): MandateDraft {
  const cur = firstCurrency(seed.clauses);
  return {
    id: null,
    agent: seed.agent,
    currency: cur,
    notBefore: toLocalInput(Math.max(now, seed.not_before)),
    expires: toLocalInput(seed.expires),
    clauses: seed.clauses.map((c) => clauseDraft(c, cur)),
  };
}

/** One signed or carried clause as the editor's typed strings. */
function clauseDraft(c: Clause, cur: Currency): ClauseDraft {
  const money = (minor: number | undefined) => (minor === undefined ? '' : minorToInput(minor, cur));
  switch (c.type) {
    case 'roles': return { type: 'roles', roles: [...c.roles] };
    case 'counterparties': return { type: 'counterparties', rule: c.rule.type, keys: c.rule.type === 'pinned' ? c.rule.keys.join(', ') : '' };
    case 'per_deal': return { type: 'per_deal', kind: c.kind, max: money(c.max_amount.minor), categories: [...c.categories] };
    case 'band': return { type: 'band', items: c.item_refs.join(', '), floor: money(c.floor?.minor), ceiling: money(c.ceiling?.minor), rounds: String(c.max_rounds), deadline: toLocalInput(c.deadline) };
    case 'velocity': return { type: 'velocity', deals: String(c.max_deals_day), total: money(c.max_total_day.minor) };
    case 'human_present_over': return { type: 'human_present_over', amount: money(c.amount.minor) };
    case 'payees': return { type: 'payees', payees: c.payees.join(', ') };
    case 'lever': return { type: 'lever', percent: bpToPercent(c.max_discount_bp), max: money(c.max_discount.minor) };
    case 'market_watch': return { type: 'market_watch', items: c.items.map((i) => ({ item: i.item_ref, product: i.product_id })), checks: String(c.max_refreshes_day) };
  }
}

export const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const int = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

/** Rust's text ids (table-core ids.rs text_id!: ItemRef, PayeeRef, KeyId): 1-128 letters, digits
 *  or `-_.:@+`. Rust refuses any other name when it reads the arguments, before validate(). */
export const isTextId = (s: string): boolean => /^[A-Za-z0-9\-_.:@+]{1,128}$/.test(s);
const ID_CHARS = 'use letters, digits and - _ . : @ + only, no spaces';

export type Built = { ok: true; clauses: Clause[]; notBefore: number; expires: number } | { ok: false; errors: string[] };

/** A draft clause that cannot be converted yet (an empty or malformed field). The preview shows
 *  its check as unknown; signing stays blocked until it converts. */
export type Incomplete = IncompleteClause;
export type DraftClause = Clause | Incomplete;
export const isIncomplete = (c: DraftClause): c is Incomplete => 'incomplete' in c;

/** Convert one draft clause into its exact Rust shape, or explain what is missing. `n` prefixes
 *  the messages ("clause 3"). */
export function buildClause(c: ClauseDraft, cur: Currency, n: string): { clause: Clause | null; errors: string[] } {
  const errors: string[] = [];
  const money = (s: string, what: string, required: boolean) => {
    if (!s.trim()) {
      if (required) errors.push(`${what}: enter an amount`);
      return null;
    }
    const m = parseMoneyInput(s, cur);
    if (m === null) {
      errors.push(`${what}: “${s}” is not an amount in ${cur}`);
      return null;
    }
    return { minor: m, currency: cur };
  };
  let clause: Clause | null = null;
  switch (c.type) {
    case 'roles':
      if (!c.roles.length) errors.push(`${n}: choose at least one`);
      clause = { type: 'roles', roles: c.roles };
      break;
    case 'counterparties': {
      const keys = splitList(c.keys);
      if (c.rule === 'pinned' && !keys.length) errors.push(`${n}: list at least one wallet`);
      const badKey = c.rule === 'pinned' ? keys.find((k) => !isTextId(k)) : undefined;
      if (badKey !== undefined) errors.push(`${n}: “${badKey}” isn’t a wallet key: ${ID_CHARS}`);
      clause = { type: 'counterparties', rule: c.rule === 'pinned' ? { type: 'pinned', keys } : { type: c.rule } };
      break;
    }
    case 'per_deal': {
      const max = money(c.max, `${n} per deal`, true);
      if (max) clause = { type: 'per_deal', kind: c.kind, max_amount: max, categories: c.categories };
      break;
    }
    case 'band': {
      const floor = money(c.floor, `${n} band floor`, false);
      const ceiling = money(c.ceiling, `${n} band ceiling`, false);
      const rounds = int(c.rounds);
      const deadline = fromLocalInput(c.deadline);
      if (!floor && !ceiling) errors.push(`${n}: set the most you’ll pay, the least you’ll accept, or both`);
      if (floor && ceiling && floor.minor > ceiling.minor) errors.push(`${n}: the least you’ll accept is above the most you’ll pay`);
      if (rounds === null || rounds < 1 || rounds > 255) errors.push(`${n}: offers must be 1–255`);
      if (deadline === null) errors.push(`${n}: choose an end date`);
      const badItem = splitList(c.items).find((x) => !isTextId(x));
      if (badItem !== undefined) errors.push(`${n}: “${badItem}” isn’t an item code: ${ID_CHARS}`);
      if (rounds !== null && deadline !== null) clause = { type: 'band', item_refs: splitList(c.items), floor, ceiling, max_rounds: rounds, deadline };
      break;
    }
    case 'velocity': {
      const deals = int(c.deals);
      const total = money(c.total, `${n} velocity total`, true);
      if (deals === null) errors.push(`${n}: deals per day must be a whole number`);
      if (deals !== null && total) clause = { type: 'velocity', max_deals_day: deals, max_total_day: total };
      break;
    }
    case 'human_present_over': {
      const amount = money(c.amount, `${n} you decide over`, true);
      if (amount) clause = { type: 'human_present_over', amount };
      break;
    }
    case 'payees': {
      const payees = splitList(c.payees);
      if (!payees.length) errors.push(`${n}: list at least one payee`);
      const badPayee = payees.find((p) => !isTextId(p));
      if (badPayee !== undefined) errors.push(`${n}: “${badPayee}” isn’t a payee name: ${ID_CHARS}`);
      clause = { type: 'payees', payees };
      break;
    }
    case 'lever': {
      const bp = percentToBp(c.percent);
      const max = money(c.max, `${n} most off a cycle`, true);
      if (bp === null) errors.push(`${n}: the discount must be a percent above 0 and below 100`);
      if (bp !== null && max) clause = { type: 'lever', levers: ['DISCOUNT_THIS_CYCLE'], max_discount_bp: bp, max_discount: max };
      break;
    }
    case 'market_watch': {
      const items = c.items.map((i) => ({ item_ref: i.item.trim(), product_id: i.product.trim() })).filter((i) => i.item_ref || i.product_id);
      const checks = int(c.checks);
      if (!items.length) errors.push(`${n}: name at least one item`);
      if (items.some((i) => !i.item_ref)) errors.push(`${n}: every price-service product needs your item`);
      const badRef = items.find((i) => i.item_ref && !isTextId(i.item_ref));
      if (badRef) errors.push(`${n}: “${badRef.item_ref}” isn’t an item code: ${ID_CHARS}`);
      const bad = items.find((i) => i.item_ref && !productValid(i.product_id));
      if (bad) errors.push(`${n}: “${bad.product_id || bad.item_ref}” needs a product code made of letters, digits, - or _`);
      if (checks === null || checks < 1 || checks > MAX_MARKET_CHECKS_DAY) errors.push(`${n}: checks a day must be 1–${MAX_MARKET_CHECKS_DAY}`);
      if (checks !== null) clause = { type: 'market_watch', items, max_refreshes_day: checks };
      break;
    }
  }
  return { clause: errors.length ? null : clause, errors };
}

/** Convert the draft into the exact Rust shapes, or explain what is missing. */
export function buildMandate(d: MandateDraft): Built {
  const errors: string[] = [];
  const clauses: Clause[] = [];
  d.clauses.forEach((c, i) => {
    const r = buildClause(c, d.currency, CLAUSE_KINDS.find((k) => k.type === c.type)?.name ?? `rule ${i + 1}`);
    errors.push(...r.errors);
    if (r.clause) clauses.push(r.clause);
  });
  const notBefore = fromLocalInput(d.notBefore);
  const expires = fromLocalInput(d.expires);
  if (notBefore === null) errors.push('start: choose a time');
  if (expires === null) errors.push('end: choose a time');
  // Rust's validate() also refuses a start before 1970 and an end past Number.MAX_SAFE_INTEGER.
  if (notBefore !== null && notBefore < 0) errors.push('start: choose a date from 1970 on');
  if (expires !== null && expires > Number.MAX_SAFE_INTEGER) errors.push('end: choose an earlier date');
  if (notBefore !== null && expires !== null && expires <= notBefore) errors.push('the end must be after the start');
  if (!d.clauses.length) errors.push('add at least one rule');
  if (errors.length || notBefore === null || expires === null) return { ok: false, errors };
  return { ok: true, clauses, notBefore, expires };
}

/** The draft as the preview reads it: every clause that converts, the rest marked incomplete. */
export function previewClauses(d: MandateDraft): DraftClause[] {
  return d.clauses.map((c) => buildClause(c, d.currency, '').clause ?? { type: c.type, incomplete: true });
}

export type RuleProblem = { clause: number; why: string };

/**
 * Why Rust's MandatePayload::validate would refuse the draft's clauses, in the editor's words
 * (lib/mandateRules, the client's one mirror). When any hold, Rust refuses to sign and check()
 * refuses every intent. Incomplete clauses are skipped (their field errors already block
 * signing). Rust re-checks on sign.
 */
export function ruleProblems(clauses: readonly DraftClause[], notBefore: number | null, expires: number | null): RuleProblem[] {
  return ruleRefusals(clauses, notBefore, expires).map(({ clause, why }) => ({ clause, why }));
}

/** A REFUSED from mandate_sign or band_set ("mandate clause 4: …"), as one plain sentence. */
export function refusalWords(message: string): string {
  const why = (REASON_WORDS as Record<string, string | undefined>)[message.replace(/^mandate clause \d+: /, '')];
  return why ? `These rules can’t be signed: ${why}.` : 'These rules can’t be signed: they don’t fit what the wallet accepts.';
}

/** Before band_set: the side this deal plays needs its bound, in the editor's words; null when it has it. */
export function bandMissingSide(side: 'buyer' | 'seller', floor: unknown, ceiling: unknown): string | null {
  if (side === 'buyer' && !ceiling) return 'Agents that buy need a most-you’ll-pay. Without one, the wallet refuses to sign rules that only buy.';
  if (side === 'seller' && !floor) return 'Agents that sell need a least-you’ll-accept. Without one, the wallet refuses to sign rules that only sell.';
  return null;
}

/** Why the range form cannot be signed yet, in plain words (undefined = not a valid amount, null = left empty). */
export function bandInputProblem(floor: { minor: number } | null | undefined, ceiling: { minor: number } | null | undefined): string | null {
  if (floor === undefined) return 'The least you’ll accept isn’t an amount. Type it like 120 or 120.50.';
  if (ceiling === undefined) return 'The most you’ll pay isn’t an amount. Type it like 120 or 120.50.';
  if (floor === null && ceiling === null) return 'Fill in at least one amount.';
  if (floor && ceiling && floor.minor > ceiling.minor) return 'The least you’ll accept can’t be higher than the most you’ll pay.';
  return null;
}

/** Clause kinds the draft does not have yet (Rust allows one of each). */
export function missingKinds(d: MandateDraft): ClauseType[] {
  // The fixes rule belongs to rules for rescuing renewals only: offered once that job is allowed.
  const rescue = d.clauses.some((c) => c.type === 'roles' && c.roles.includes('rescue'));
  return CLAUSE_KINDS.map((k) => k.type).filter((t) => !d.clauses.some((c) => c.type === t) && (t !== 'lever' || rescue));
}

/** Replace clause `i` (keeps the rest untouched). */
export function withClause(d: MandateDraft, i: number, c: ClauseDraft): MandateDraft {
  return { ...d, clauses: d.clauses.map((x, j) => (j === i ? c : x)) };
}

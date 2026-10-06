// Mandate editor drafts: owner-typed strings for the seven clause kinds (bindings/Clause.ts),
// converted exactly into the Rust shapes. Rust validates and signs; this only shapes input.
import type { AgentSlot } from '@bindings/AgentSlot';
import type { Category } from '@bindings/Category';
import type { Clause } from '@bindings/Clause';
import type { Currency } from '@bindings/Currency';
import type { DealKind } from '@bindings/DealKind';
import type { OpenMandate } from '@bindings/OpenMandate';
import type { Role } from '@bindings/Role';
import { minorToInput, parseMoneyInput } from './model';

export type ClauseDraft =
  | { type: 'roles'; roles: Role[] }
  | { type: 'counterparties'; rule: 'paired' | 'house' | 'pinned'; keys: string }
  | { type: 'per_deal'; kind: DealKind; max: string; categories: Category[] }
  | { type: 'band'; items: string; floor: string; ceiling: string; rounds: string; deadline: string }
  | { type: 'velocity'; deals: string; total: string }
  | { type: 'human_present_over'; amount: string }
  | { type: 'payees'; payees: string };

export type ClauseType = ClauseDraft['type'];

export const CLAUSE_KINDS: ReadonlyArray<{ type: ClauseType; name: string; hint: string }> = [
  { type: 'roles', name: 'What agents may do', hint: 'buy, sell, run your shop, rescue renewals' },
  { type: 'counterparties', name: 'Who they deal with', hint: 'which wallets they may talk to' },
  { type: 'per_deal', name: 'Limit per deal', hint: 'the most for any single deal' },
  { type: 'band', name: 'Price range', hint: 'most you’ll pay, least you’ll accept, and how many offers' },
  { type: 'velocity', name: 'Daily limit', hint: 'deals and money per day' },
  { type: 'human_present_over', name: 'Ask me above', hint: 'above this amount, you decide' },
  { type: 'payees', name: 'Approved payees', hint: 'who agents may pay on their own' },
];

/** Rust's clause numbers (table-core Clause::number). */
export const CLAUSE_NUMBER: Record<ClauseType, number> = { roles: 1, counterparties: 2, per_deal: 3, band: 4, velocity: 5, human_present_over: 6, payees: 7 };

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
  }
  return 'USD';
}

/** A new version of an existing mandate starts from its signed clauses and, when mandate_list
 *  reported it (MandateListEntry.agent), the agent slot it is bound to. */
export function draftFrom(m: OpenMandate & { agent?: AgentSlot }, now: number): MandateDraft {
  const cur = firstCurrency(m.payload.clauses);
  const money = (minor: number | undefined) => (minor === undefined ? '' : minorToInput(minor, cur));
  return {
    id: m.payload.id,
    agent: m.agent ?? 'negotiator',
    currency: cur,
    notBefore: toLocalInput(Math.max(now, m.payload.not_before)),
    expires: toLocalInput(m.payload.expires),
    clauses: m.payload.clauses.map((c): ClauseDraft => {
      switch (c.type) {
        case 'roles': return { type: 'roles', roles: [...c.roles] };
        case 'counterparties': return { type: 'counterparties', rule: c.rule.type, keys: c.rule.type === 'pinned' ? c.rule.keys.join(', ') : '' };
        case 'per_deal': return { type: 'per_deal', kind: c.kind, max: money(c.max_amount.minor), categories: [...c.categories] };
        case 'band': return { type: 'band', items: c.item_refs.join(', '), floor: money(c.floor?.minor), ceiling: money(c.ceiling?.minor), rounds: String(c.max_rounds), deadline: toLocalInput(c.deadline) };
        case 'velocity': return { type: 'velocity', deals: String(c.max_deals_day), total: money(c.max_total_day.minor) };
        case 'human_present_over': return { type: 'human_present_over', amount: money(c.amount.minor) };
        case 'payees': return { type: 'payees', payees: c.payees.join(', ') };
      }
    }),
  };
}

export const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const int = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

export type Built = { ok: true; clauses: Clause[]; notBefore: number; expires: number } | { ok: false; errors: string[] };

/** A draft clause that cannot be converted yet (an empty or malformed field). The preview shows
 *  its check as unknown; signing stays blocked until it converts. */
export type Incomplete = { type: ClauseType; incomplete: true };
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
      clause = { type: 'payees', payees };
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
 * A mirror of Rust's MandatePayload::validate (table-core mandate.rs) over the draft's clauses.
 * When any of these hold, Rust refuses to sign and check() refuses every intent. Incomplete
 * clauses are skipped (their field errors already block signing). Rust re-checks on sign.
 */
export function ruleProblems(clauses: readonly DraftClause[], notBefore: number | null, expires: number | null): RuleProblem[] {
  const out: RuleProblem[] = [];
  const seen = new Set<number>();
  const sorted = [...clauses].sort((a, b) => CLAUSE_NUMBER[a.type] - CLAUSE_NUMBER[b.type]);
  for (const c of sorted) {
    const n = CLAUSE_NUMBER[c.type];
    if (seen.has(n)) out.push({ clause: n, why: 'it appears twice; there can be only one of each kind' });
    seen.add(n);
    if (isIncomplete(c)) continue;
    switch (c.type) {
      case 'roles':
        if (!c.roles.length) out.push({ clause: 1, why: 'nothing is allowed' });
        break;
      case 'counterparties':
        if (c.rule.type === 'pinned' && !c.rule.keys.length) out.push({ clause: 2, why: 'no wallets listed' });
        break;
      case 'per_deal':
        if (!c.categories.length) out.push({ clause: 3, why: 'no categories' });
        break;
      case 'band':
        if (!c.item_refs.length) out.push({ clause: 4, why: 'it names no item' });
        if (c.max_rounds === 0) out.push({ clause: 4, why: 'it allows 0 offers' });
        if (!c.floor && !c.ceiling) out.push({ clause: 4, why: 'it has no most-you’ll-pay and no least-you’ll-accept' });
        if (expires !== null && c.deadline > expires) out.push({ clause: 4, why: 'it ends after the rules themselves end' });
        if (notBefore !== null && c.deadline <= notBefore) out.push({ clause: 4, why: 'it ends before the rules start' });
        break;
      case 'velocity':
        if (c.max_deals_day === 0) out.push({ clause: 5, why: 'it allows 0 deals a day' });
        break;
      case 'payees':
        if (!c.payees.length) out.push({ clause: 7, why: 'no payees' });
        break;
      default:
        break;
    }
  }
  for (const n of [1, 2, 3, 5, 6, 7]) {
    if (seen.has(n)) continue;
    const kind = CLAUSE_KINDS.find((k) => CLAUSE_NUMBER[k.type] === n);
    out.push({ clause: n, why: `“${kind?.name ?? `rule ${n}`}” is required` });
  }
  const banded = clauses.some((c) => c.type === 'per_deal' && !isIncomplete(c) && (c.kind === 'haggle' || c.kind === 'shop_order'));
  if (banded && !seen.has(4)) out.push({ clause: 4, why: 'haggles and shop orders need a price range' });
  return out;
}

/** Clause kinds the draft does not have yet (Rust allows one of each). */
export function missingKinds(d: MandateDraft): ClauseType[] {
  return CLAUSE_KINDS.map((k) => k.type).filter((t) => !d.clauses.some((c) => c.type === t));
}

/** Replace clause `i` (keeps the rest untouched). */
export function withClause(d: MandateDraft, i: number, c: ClauseDraft): MandateDraft {
  return { ...d, clauses: d.clauses.map((x, j) => (j === i ? c : x)) };
}

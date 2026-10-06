// What-if preview: this week's deals replayed through a mandate's clauses, in the client.
//
// There is no mandate_preview command yet, so this is a LOCAL PREVIEW and labelled as one. It
// mirrors Rust's MandatePayload::check (crates/table-core/src/mandate.rs) and the intent the
// wallet assembles for it (crates/table-app/src/agent.rs mandate_check_rounds), but runs only the
// checks it can compute EXACTLY from fields the bindings carry:
//
//   exact   role (from side + kind), counterparty rule (counterparty_list lists exactly the
//           word-confirmed counterparties, with the HOUSE flag), per-deal kind / currency / amount,
//           band item / bound / currency / a deadline already passed, velocity's money cap when the
//           deal alone is over it, the human-present threshold, "band missing" for haggles.
//   unknown category (not on the deal record), payee (not on the deal record), band rounds used,
//           velocity's daily usage, a band deadline that fell during the deal, an incomplete
//           draft clause, and the counterparty rule when counterparty_list is unreadable.
//
// An unknown check is never shown as passed: an intent with one is UNKNOWN unless an exact check
// already refuses it. Validity dates (not_before / expires) are not replayed: this is a what-if on
// the terms. Rust re-checks everything on sign and on every intent.
import type { Clause } from '@bindings/Clause';
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import type { Deal } from '@bindings/Deal';
import type { DealKind } from '@bindings/DealKind';
import type { Role } from '@bindings/Role';
import type { Side } from '@bindings/Side';
import { formatMinor, shortId } from '../../../lib/format';
import { ruleNameOf } from '../../../lib/words';
import { CLAUSE_NUMBER, isIncomplete, type DraftClause, type RuleProblem } from '../mandateDraft';

export type CheckState = 'pass' | 'fail' | 'ask' | 'unknown';
export type Check = { clause: number; what: string; state: CheckState; why: string };
export type Outcome = 'refused' | 'asks' | 'policy' | 'unknown';
export type Verdict = {
  outcome: Outcome;
  /** Refusing clause (0 = no mandate), 6 when it asks you, null for policy / unknown. */
  clause: number | null;
  /** false when an unknown check runs before the refusing one: Rust may refuse at that earlier clause. */
  clauseExact: boolean;
  /** For an unknown outcome: what it becomes if every unknown check passes. */
  ifPass: 'asks' | 'policy' | null;
  checks: Check[];
};

/** A mandate as the preview reads it. null = no mandate (revoked, or none signed yet). */
export type Policy = { clauses: readonly DraftClause[]; invalid: RuleProblem | null } | null;

export type PreviewContext = {
  /** The replay's clock (Unix seconds): a band deadline after it had not passed for any past check. */
  now: number;
  /** counterparty_list (word-confirmed counterparties only), or null when unreadable. */
  counterparties: readonly CounterpartyDisplay[] | null;
};

export const OUTCOME_LABEL: Record<Outcome, string> = { refused: 'refused', asks: 'asks you', policy: 'agent may', unknown: 'unknown' };
export const OUTCOMES: readonly Outcome[] = ['refused', 'asks', 'policy', 'unknown'];

/** agent.rs: the role the wallet claims for a deal. */
export function roleFor(side: Side, kind: DealKind): Role {
  if (side === 'buyer') return 'buy';
  if (kind === 'shop_order') return 'shop';
  if (kind === 'rescue') return 'rescue';
  return 'sell';
}
/** mandate.rs role_ok: a role may only act on its own side and kinds. */
export function roleMatches(role: Role, side: Side, kind: DealKind): boolean {
  switch (role) {
    case 'buy': return side === 'buyer' && (kind === 'purchase' || kind === 'haggle' || kind === 'invoice');
    case 'sell': return side === 'seller' && (kind === 'haggle' || kind === 'invoice');
    case 'shop': return side === 'seller' && kind === 'shop_order';
    case 'rescue': return side === 'seller' && kind === 'rescue';
  }
}

const ALL_CATEGORIES = 5;
const money = (minor: number, cur: Deal['terms']['currency']) => formatMinor(minor, cur);

/** The deal's total in minor units (terms.amount()), or null when Rust would call the terms invalid. */
export function dealAmount(d: Deal): number | null {
  const t = d.terms;
  if (t.qty === 0 || t.unit_price.minor === 0 || t.currency !== t.unit_price.currency) return null;
  const total = t.unit_price.minor * t.qty;
  return Number.isSafeInteger(total) ? total : null;
}

function verdictOf(checks: Check[]): Verdict {
  const failAt = checks.findIndex((c) => c.state === 'fail');
  if (failAt >= 0) {
    const f = checks[failAt]!;
    return { outcome: 'refused', clause: f.clause, clauseExact: !checks.slice(0, failAt).some((c) => c.state === 'unknown'), ifPass: null, checks };
  }
  const asks = checks.some((c) => c.state === 'ask');
  if (checks.some((c) => c.state === 'unknown')) return { outcome: 'unknown', clause: null, clauseExact: false, ifPass: asks ? 'asks' : 'policy', checks };
  return asks ? { outcome: 'asks', clause: 6, clauseExact: true, ifPass: null, checks } : { outcome: 'policy', clause: null, clauseExact: true, ifPass: null, checks };
}

function checkClause(c: Clause, d: Deal, amount: number, ctx: PreviewContext): Check {
  const n = CLAUSE_NUMBER[c.type];
  const cur = d.terms.currency;
  const pass = (what: string, why: string): Check => ({ clause: n, what, state: 'pass', why });
  const fail = (what: string, why: string): Check => ({ clause: n, what, state: 'fail', why });
  const unknown = (what: string, why: string): Check => ({ clause: n, what, state: 'unknown', why });
  switch (c.type) {
    case 'roles': {
      const role = roleFor(d.side, d.kind);
      return c.roles.includes(role) ? pass('role', `${role} is allowed`) : fail('role', `role ${role} is not in this mandate`);
    }
    case 'counterparties': {
      const rule = c.rule;
      if (rule.type === 'pinned' && !rule.keys.includes(d.counterparty)) return fail('counterparty', `${shortId(d.counterparty)} is not a pinned key`);
      if (!ctx.counterparties) return unknown('counterparty', 'your connected wallets can’t be read here');
      const cp = ctx.counterparties.find((x) => x.key_id === d.counterparty);
      if (!cp) return fail('counterparty', `${shortId(d.counterparty)} is not a wallet you connected`);
      if (rule.type === 'house' && !cp.house) return fail('counterparty', `${cp.display_name} is not the house seller`);
      return pass('counterparty', rule.type === 'house' ? 'the house seller, connected' : rule.type === 'pinned' ? 'a listed wallet, connected' : 'a wallet you connected');
    }
    case 'per_deal': {
      if (c.kind !== d.kind) return fail('deal kind', `this mandate allows ${c.kind}, not ${d.kind}`);
      if (c.max_amount.currency !== cur) return fail('currency', `${cur} is not ${c.max_amount.currency}`);
      if (amount > c.max_amount.minor) return fail('per-deal max', `${money(amount, cur)} is above the ${money(c.max_amount.minor, cur)} limit per deal`);
      if (new Set(c.categories).size >= ALL_CATEGORIES) return pass('per-deal max', `${money(amount, cur)} within ${money(c.max_amount.minor, cur)}; every category allowed`);
      return unknown('category', `${money(amount, cur)} is within ${money(c.max_amount.minor, cur)}; the category is not on the deal record`);
    }
    case 'band': {
      if (!c.item_refs.includes(d.terms.item_ref)) return fail('band item', `${d.terms.item_ref} has no price range (only ${c.item_refs.join(', ') || 'none'})`);
      if (d.created_at !== undefined && c.deadline <= d.created_at) return fail('band deadline', 'the price range had ended when this deal began');
      const bound = d.side === 'buyer' ? c.ceiling : c.floor;
      const price = d.terms.unit_price;
      if (!bound) return fail('band', d.side === 'buyer' ? 'no most-you’ll-pay is set for buying' : 'no least-you’ll-accept is set for selling');
      if (bound.currency !== price.currency) return fail('band', `${price.currency} is not the price range’s ${bound.currency}`);
      if (d.side === 'buyer' && price.minor > bound.minor) return fail('band ceiling', `${money(price.minor, price.currency)} is above the most you’ll pay, ${money(bound.minor, bound.currency)}`);
      if (d.side === 'seller' && price.minor < bound.minor) return fail('band floor', `${money(price.minor, price.currency)} is below the least you’ll accept, ${money(bound.minor, bound.currency)}`);
      const inside = `${money(price.minor, price.currency)} is inside the price range`;
      if (c.deadline <= ctx.now) return unknown('band deadline', `${inside}; the range ended during this deal`);
      return unknown('band rounds', `${inside}; offers used can’t be read here`);
    }
    case 'velocity':
      if (c.max_total_day.currency !== cur) return fail('velocity', `${cur} is not ${c.max_total_day.currency}`);
      if (amount > c.max_total_day.minor) return fail('velocity', `${money(amount, cur)} alone is over the ${money(c.max_total_day.minor, cur)} daily limit`);
      return unknown('velocity', 'today’s spending can’t be read here');
    case 'human_present_over':
      if (c.amount.currency !== cur) return fail('threshold', `threshold currency ${c.amount.currency} is not ${cur}`);
      return amount > c.amount.minor
        ? { clause: n, what: 'you decide over', state: 'ask', why: `${money(amount, cur)} is over ${money(c.amount.minor, cur)}, so you’re asked` }
        : pass('you decide over', `${money(amount, cur)} is not over ${money(c.amount.minor, cur)}`);
    case 'payees':
      return unknown('payee', 'the payee isn’t on the deal record');
  }
}

/** Replay one deal through a policy. */
export function previewDeal(policy: Policy, d: Deal, ctx: PreviewContext): Verdict {
  if (!policy) return verdictOf([{ clause: 0, what: 'rules', state: 'fail', why: 'no rules in force · refused before PayPal is asked' }]);
  if (policy.invalid) return verdictOf([{ clause: policy.invalid.clause, what: 'rules', state: 'fail', why: `this draft can’t be signed: ${policy.invalid.why}` }]);
  const amount = dealAmount(d);
  if (amount === null) return verdictOf([{ clause: 3, what: 'terms', state: 'fail', why: 'invalid terms or amount' }]);
  const role = roleFor(d.side, d.kind);
  if (!roleMatches(role, d.side, d.kind)) return verdictOf([{ clause: 1, what: 'role', state: 'fail', why: `a ${d.side} cannot act on a ${d.kind}` }]);
  const checks: Check[] = [...policy.clauses]
    .sort((a, b) => CLAUSE_NUMBER[a.type] - CLAUSE_NUMBER[b.type])
    .map((c) => (isIncomplete(c)
      ? { clause: CLAUSE_NUMBER[c.type], what: 'draft', state: 'unknown' as const, why: `“${ruleNameOf(CLAUSE_NUMBER[c.type])}” isn’t filled in yet` }
      : checkClause(c, d, amount, ctx)));
  if ((d.kind === 'haggle' || d.kind === 'shop_order') && !policy.clauses.some((c) => c.type === 'band')) {
    checks.push({ clause: 4, what: 'band', state: 'fail', why: 'a haggle or shop order needs a price range' });
  }
  return verdictOf(checks);
}

/** Did the verdict move between two policies (outcome, refusing clause, or what an unknown becomes)? */
export function moved(a: Verdict, b: Verdict): boolean {
  if (a.outcome !== b.outcome) return true;
  if (a.outcome === 'refused') return a.clause !== b.clause && a.clause !== 0 && b.clause !== 0;
  if (a.outcome === 'unknown') return a.ifPass !== b.ifPass;
  return false;
}

export type ReplayRow = { deal: Deal; amount: number | null; signed: Verdict; draft: Verdict; moved: boolean };

export const WEEK_SECONDS = 7 * 86400;

/** This week's deals under one mandate id (all deals of the week for a new mandate). A deal
 *  without created_at is kept: the ledger may not report it, and leaving it out would hide it. */
export function weekDeals(deals: readonly Deal[], mandateId: string | null, now: number): Deal[] {
  return deals
    .filter((d) => (mandateId === null || d.mandate_id === mandateId) && (d.created_at === undefined || d.created_at >= now - WEEK_SECONDS))
    .sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
}

export function replay(deals: readonly Deal[], signed: Policy, draft: Policy, ctx: PreviewContext): ReplayRow[] {
  return deals.map((deal) => {
    const s = previewDeal(signed, deal, ctx);
    const v = previewDeal(draft, deal, ctx);
    return { deal, amount: dealAmount(deal), signed: s, draft: v, moved: moved(s, v) };
  });
}

export function counts(rows: readonly ReplayRow[], side: 'signed' | 'draft'): Record<Outcome, number> {
  const out: Record<Outcome, number> = { refused: 0, asks: 0, policy: 0, unknown: 0 };
  for (const r of rows) out[r[side].outcome] += 1;
  return out;
}

/** One-line reason for a verdict ("clause 3: amount … above max …"). */
export function verdictWhy(v: Verdict): string {
  if (v.outcome === 'refused') {
    const f = v.checks.find((c) => c.state === 'fail');
    return f ? `${f.clause ? `${ruleNameOf(f.clause)}${v.clauseExact ? '' : ' (or an earlier unknown one)'}: ` : ''}${f.why}` : 'refused';
  }
  if (v.outcome === 'unknown') {
    const u = [...new Set(v.checks.filter((c) => c.state === 'unknown').map((c) => ruleNameOf(c.clause).toLowerCase()))];
    return `can’t be worked out here (${u.join(', ')}); if those pass: ${OUTCOME_LABEL[v.ifPass ?? 'policy']}`;
  }
  if (v.outcome === 'asks') return v.checks.find((c) => c.state === 'ask')?.why ?? 'asks you';
  return 'every rule passes · the agent may do it on its own';
}

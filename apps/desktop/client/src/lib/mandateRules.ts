// The client's one mirror of Rust's MandatePayload::validate (crates/table-core/src/mandate.rs,
// DECISIONS §5). Rust decides: it re-validates on every sign and every check. This mirror only lets
// the editor say early why rules cannot be signed, and lets the browser mock refuse what the wallet
// refuses. mandateRules.test.ts reads mandate.rs and fails when Rust gains a reason or a clause
// number this file does not know. Nothing here moves money.
import type { Clause } from '@bindings/Clause';
import type { Currency } from '@bindings/Currency';
import type { DealKind } from '@bindings/DealKind';
import type { MandatePayload } from '@bindings/MandatePayload';
import type { Money } from '@bindings/Money';
import type { Role } from '@bindings/Role';
import type { Side } from '@bindings/Side';
import { MAX_MARKET_CHECKS_DAY, MAX_WATCHED_ITEMS, marketWatchRefusal } from './marketWatch';
import { RULE_NAME, RULE_NUMBER } from './words';

export type ClauseType = Clause['type'];
/** Rust's clause numbers (Clause::number), one table for the whole client. */
export const CLAUSE_NUMBER: Readonly<Record<ClauseType, number>> = RULE_NUMBER;

/** Every reason validate() refuses with, and its clause (null: the clause it was found in). */
export const VALIDATE_REASONS = [
  { clause: 1, reason: 'invalid mandate version or validity' },
  { clause: null, reason: 'duplicate clause' },
  { clause: 1, reason: 'empty roles' },
  { clause: 2, reason: 'empty pinned keys' },
  { clause: 3, reason: 'empty categories' },
  { clause: 4, reason: 'invalid band' },
  { clause: 4, reason: 'invalid floor/ceiling' },
  { clause: 5, reason: 'empty velocity allowance' },
  { clause: 7, reason: 'empty payee allowance' },
  { clause: 8, reason: 'empty or repeated fix list' },
  { clause: 8, reason: 'only the discount this cycle is available' },
  { clause: 8, reason: 'discount must be above 0% and below 100%' },
  { clause: 8, reason: 'empty discount allowance' },
  { clause: 9, reason: 'invalid market watch' },
  { clause: 9, reason: 'invalid price check allowance' },
  { clause: 9, reason: 'invalid market product' },
  { clause: 9, reason: 'item watched twice' },
  { clause: null, reason: 'required clause missing' },
  { clause: null, reason: 'currency differs across clauses' },
  { clause: 8, reason: 'the rescue role and the fixes clause go together' },
  { clause: 2, reason: 'rescue deals only with your own subscribers, in a mandate of its own' },
  { clause: 4, reason: 'band required for haggle and shop orders' },
  { clause: 1, reason: 'no role in the roles clause can act on the per-deal kind' },
  { clause: 4, reason: 'band lacks the side the allowed roles use' },
] as const satisfies ReadonlyArray<{ clause: number | null; reason: string }>;
export type ValidateReason = (typeof VALIDATE_REASONS)[number]['reason'];

/** Rust's reasons in the editor's words, so no rule number or internal term shows. */
export const REASON_WORDS: Record<ValidateReason, string> = {
  'invalid mandate version or validity': 'the end must be after the start',
  'duplicate clause': 'a rule appears twice; there can be only one of each kind',
  'empty roles': 'nothing is allowed',
  'empty pinned keys': 'no wallets listed',
  'empty categories': 'no categories',
  'invalid band': 'the price range is incomplete or ends at the wrong time',
  'invalid floor/ceiling': 'the least you’ll accept is above the most you’ll pay',
  'empty velocity allowance': 'it allows 0 deals a day',
  'empty payee allowance': 'no payees',
  'required clause missing': 'a required rule is missing',
  'currency differs across clauses': 'the amounts are in different currencies',
  'band required for haggle and shop orders': 'haggles and shop orders need a price range',
  'no role in the roles clause can act on the per-deal kind': 'none of what you allowed agents to do fits this kind of deal, so nothing would ever be allowed',
  'band lacks the side the allowed roles use': 'agents that buy need a most-you’ll-pay, and agents that sell need a least-you’ll-accept',
  'empty or repeated fix list': 'the fixes rule names no fix',
  'only the discount this cycle is available': 'only a discount on one cycle can be offered for now',
  'discount must be above 0% and below 100%': 'the discount must be above 0% and below 100%',
  'empty discount allowance': 'it allows no discount',
  'the rescue role and the fixes clause go together': 'rescuing renewals and “Fixes for failed renewals” go together',
  'rescue deals only with your own subscribers, in a mandate of its own': 'rescuing renewals deals only with your own subscribers, in rules of its own',
  'invalid market watch': `it names no item, or more than ${MAX_WATCHED_ITEMS}`,
  'invalid price check allowance': `checks a day must be 1–${MAX_MARKET_CHECKS_DAY}`,
  'invalid market product': 'a product code can only use letters, digits, - or _',
  'item watched twice': 'an item is listed twice',
};

/** One refusal: Rust's clause and reason, and `why`, the editor's detailed words for it. */
export type RuleRefusal = { clause: number; reason: ValidateReason; why: string };
/** A clause the editor cannot convert yet: it counts as present, its content is not checked. */
export type IncompleteClause = { type: ClauseType; incomplete: true };
type RuleClause = Clause | IncompleteClause;
const complete = (c: RuleClause): c is Clause => !('incomplete' in c);
const first = <T extends ClauseType>(clauses: readonly RuleClause[], type: T) =>
  clauses.find((c): c is Extract<Clause, { type: T }> => c.type === type && complete(c));

/** role_acts in mandate.rs: the one table of which (role, side, kind) may act. */
export function roleActs(role: Role, side: Side, kind: DealKind): boolean {
  switch (role) {
    case 'buy': return side === 'buyer' && (kind === 'purchase' || kind === 'haggle' || kind === 'invoice');
    case 'sell': return side === 'seller' && (kind === 'haggle' || kind === 'invoice');
    case 'shop': return side === 'seller' && kind === 'shop_order';
    case 'rescue': return side === 'seller' && kind === 'rescue';
  }
}
/** role_side in mandate.rs: the side a role always plays. */
export const roleSide = (role: Role): Side => (role === 'buy' ? 'buyer' : 'seller');

/**
 * validate()'s clause checks, every one that fails, in the order Rust checks them, so the first is
 * the one Rust refuses with. Validity (version, start, end) is checked by validateRules; here a null
 * start or end skips the band's date checks. Incomplete clauses are skipped.
 */
export function ruleRefusals(clauses: readonly RuleClause[], notBefore: number | null, expires: number | null): RuleRefusal[] {
  const out: RuleRefusal[] = [];
  const refuse = (clause: number, reason: ValidateReason, why: string = REASON_WORDS[reason]) => out.push({ clause, reason, why });
  const seen = new Set<number>();
  for (const c of [...clauses].sort((a, b) => CLAUSE_NUMBER[a.type] - CLAUSE_NUMBER[b.type])) {
    const n = CLAUSE_NUMBER[c.type];
    if (seen.has(n)) refuse(n, 'duplicate clause', 'it appears twice; there can be only one of each kind');
    seen.add(n);
    if (!complete(c)) continue;
    switch (c.type) {
      case 'roles':
        if (!c.roles.length) refuse(1, 'empty roles');
        break;
      case 'counterparties':
        if (c.rule.type === 'pinned' && !c.rule.keys.length) refuse(2, 'empty pinned keys');
        break;
      case 'per_deal':
        if (!c.categories.length) refuse(3, 'empty categories');
        break;
      case 'band':
        if (!c.item_refs.length) refuse(4, 'invalid band', 'it names no item');
        if (c.max_rounds === 0) refuse(4, 'invalid band', 'it allows 0 offers');
        if (!c.floor && !c.ceiling) refuse(4, 'invalid band', 'it has no most-you’ll-pay and no least-you’ll-accept');
        if (expires !== null && c.deadline > expires) refuse(4, 'invalid band', 'it ends after the rules themselves end');
        if (notBefore !== null && c.deadline <= notBefore) refuse(4, 'invalid band', 'it ends before the rules start');
        if (c.floor && c.ceiling && (c.floor.currency !== c.ceiling.currency || c.floor.minor > c.ceiling.minor)) refuse(4, 'invalid floor/ceiling');
        break;
      case 'velocity':
        if (c.max_deals_day === 0) refuse(5, 'empty velocity allowance');
        break;
      case 'payees':
        if (!c.payees.length) refuse(7, 'empty payee allowance');
        break;
      case 'lever':
        if (!c.levers.length || c.levers.some((l, i) => c.levers.indexOf(l) !== i)) refuse(8, 'empty or repeated fix list');
        if (c.levers.some((l) => l !== 'DISCOUNT_THIS_CYCLE')) refuse(8, 'only the discount this cycle is available');
        if (c.max_discount_bp <= 0 || c.max_discount_bp >= 10000) refuse(8, 'discount must be above 0% and below 100%');
        if (c.max_discount.minor <= 0) refuse(8, 'empty discount allowance');
        break;
      case 'market_watch': {
        const why = marketWatchRefusal(c) as ValidateReason | null;
        if (why) refuse(9, why, REASON_WORDS[why] ?? why);
        break;
      }
      default:
        break;
    }
  }
  for (const n of [1, 2, 3, 5, 6, 7]) {
    if (seen.has(n)) continue;
    const type = (Object.keys(CLAUSE_NUMBER) as ClauseType[]).find((t) => CLAUSE_NUMBER[t] === n);
    refuse(n, 'required clause missing', `“${type ? RULE_NAME[type] : `rule ${n}`}” is required`);
  }
  // A policy check() could never allow: amounts in clause order, the first that differs.
  let currency: Currency | null = null;
  currencies: for (const c of clauses) {
    if (!complete(c)) continue;
    const amounts: Money[] =
      c.type === 'per_deal' ? [c.max_amount]
        : c.type === 'band' ? [c.floor, c.ceiling].filter((m): m is Money => !!m)
          : c.type === 'velocity' ? [c.max_total_day]
            : c.type === 'human_present_over' ? [c.amount]
              : c.type === 'lever' ? [c.max_discount] : [];
    for (const m of amounts) {
      currency ??= m.currency;
      if (m.currency !== currency) {
        refuse(CLAUSE_NUMBER[c.type], 'currency differs across clauses');
        break currencies;
      }
    }
  }
  // Rescue is a set of rules of its own: the rescue job, "your own subscribers" and the fixes rule
  // come together or not at all.
  const roles = first(clauses, 'roles');
  const rescue = !!roles?.roles.includes('rescue');
  const subscribers = clauses.some((c) => c.type === 'counterparties' && complete(c) && c.rule.type === 'subscribers');
  if (rescue !== seen.has(8)) {
    refuse(8, 'the rescue role and the fixes clause go together', rescue ? 'rescuing renewals needs “Fixes for failed renewals”' : '“Fixes for failed renewals” is only for rescuing renewals');
  }
  if (subscribers !== rescue || (rescue && (roles?.roles.length ?? 0) !== 1)) refuse(2, 'rescue deals only with your own subscribers, in a mandate of its own');
  const banded = clauses.some((c) => c.type === 'per_deal' && complete(c) && (c.kind === 'haggle' || c.kind === 'shop_order'));
  if (banded && !seen.has(4)) refuse(4, 'band required for haggle and shop orders');
  // Roles and the per-deal kind must let one role act, and a band must bound the side it uses.
  const perDeal = first(clauses, 'per_deal');
  const band = first(clauses, 'band');
  if (roles && roles.roles.length && perDeal) {
    const acting = roles.roles.filter((r) => roleActs(r, roleSide(r), perDeal.kind));
    if (!acting.length) {
      refuse(1, 'no role in the roles clause can act on the per-deal kind');
    } else if (band && (band.floor || band.ceiling) && !acting.some((r) => (roleSide(r) === 'buyer' ? band.ceiling : band.floor))) {
      refuse(4, 'band lacks the side the allowed roles use', acting.includes('buy') ? 'agents that buy need a most-you’ll-pay' : 'agents that sell need a least-you’ll-accept');
    }
  }
  return out;
}

/** MandatePayload::validate() over a payload: every refusal, the first being the one Rust gives. */
export function validateRules(p: MandatePayload): RuleRefusal[] {
  const out: RuleRefusal[] = [];
  if (p.version === 0 || p.expires <= p.not_before || p.not_before < 0 || p.expires > Number.MAX_SAFE_INTEGER) {
    const reason = 'invalid mandate version or validity';
    out.push({ clause: 1, reason, why: REASON_WORDS[reason] });
  }
  return [...out, ...ruleRefusals(p.clauses, p.not_before, p.expires)];
}

// Browser mock of mandate_simulate (T12). The shell answers with Rust's own MandatePayload::check;
// this mirror exists only so the browser preview can show the what-if. It follows check() clause
// by clause (crates/table-core/src/mandate.rs) and the intent the wallet rebuilds from a recorded
// deal (crates/table-runtime/src/simulate.rs): kept minimal, and simulate.test.ts pins it to the
// card's cases. A fact the mock does not hold (a category) makes the line not simulated.
import type { Category } from '@bindings/Category';
import type { Currency } from '@bindings/Currency';
import type { Deal } from '@bindings/Deal';
import type { MandatePayload } from '@bindings/MandatePayload';
import type { Role } from '@bindings/Role';
import type { SimulatedVerdict } from '@bindings/SimulatedVerdict';
import { exponent } from '../lib/format';
import { CLAUSE_NUMBER as NUMBER, roleActs, validateRules } from '../lib/mandateRules';

export type Refusal = { clause: number; reason: string };
export type MockIntent = {
  deal: Deal;
  category: Category;
  paired: boolean;
  house: boolean;
  /** The counterparty's declared payee (a buyer's settlement payee). */
  declaredPayee: string | null;
  roundsUsed: number;
};
export type MockUsage = { dealsToday: number; totalToday: number };

/** Money::decimal(): "11960.00". */
function decimal(minor: number, currency: Currency): string {
  const exp = exponent(currency);
  if (!exp) return String(minor);
  const s = Math.abs(minor).toString().padStart(exp + 1, '0');
  return `${minor < 0 ? '-' : ''}${s.slice(0, -exp)}.${s.slice(-exp)}`;
}

/** The role the wallet claims for a deal (table-app mandate_check_rounds). */
export function roleOf(d: Deal): Role {
  if (d.side === 'buyer') return 'buy';
  if (d.kind === 'shop_order') return 'shop';
  if (d.kind === 'rescue') return 'rescue';
  return 'sell';
}

/** MandatePayload::validate(), with Rust's own reasons: the first refusal of the client's one
 *  mirror (lib/mandateRules), as Rust returns it. */
export function mockValidate(p: MandatePayload): Refusal | null {
  const bad = validateRules(p)[0];
  return bad ? { clause: bad.clause, reason: bad.reason } : null;
}

/** MandatePayload::check() on one rebuilt intent, at the moment the payload is (or comes) in force. */
export function mockCheck(p: MandatePayload, i: MockIntent, usage: MockUsage, now: number): SimulatedVerdict {
  const refuse = (clause: number, reason: string): SimulatedVerdict => ({ type: 'refuse', clause, reason });
  const d = i.deal;
  // A seller is paid to the one payee its mandate names; without exactly one, nothing is guessed.
  const sole = p.clauses.find((c) => c.type === 'payees');
  const payee = d.side === 'buyer' ? i.declaredPayee : sole && sole.payees.length === 1 ? sole.payees[0]! : null;
  if (payee === null) return { type: 'not_simulated' };
  const bad = mockValidate(p);
  if (bad) return refuse(bad.clause, bad.reason);
  const at = Math.max(now, p.not_before);
  if (at < p.not_before || at >= p.expires) return refuse(1, 'mandate is not active');
  const t = d.terms;
  if (t.qty === 0 || t.unit_price.minor === 0 || t.currency !== t.unit_price.currency) return refuse(3, 'invalid terms or amount');
  const amount = { minor: t.unit_price.minor * t.qty, currency: t.currency };
  const role = roleOf(d);
  if (!roleActs(role, d.side, d.kind)) return refuse(1, 'role does not match the deal side/kind');
  let decision: SimulatedVerdict = { type: 'allow' };
  for (const c of [...p.clauses].sort((a, b) => NUMBER[a.type] - NUMBER[b.type])) {
    switch (c.type) {
      case 'roles':
        if (!c.roles.includes(role)) return refuse(1, 'role not allowed');
        break;
      case 'counterparties': {
        const ok = c.rule.type === 'pinned' ? i.paired && c.rule.keys.includes(d.counterparty) : c.rule.type === 'paired' ? i.paired : i.paired && i.house;
        if (!ok) return refuse(2, 'counterparty is not pinned/paired as required');
        break;
      }
      case 'per_deal': {
        if (c.kind !== d.kind) return refuse(3, 'deal kind not allowed');
        if (c.max_amount.currency !== amount.currency) return refuse(3, 'currency not allowed');
        const over = amount.minor > c.max_amount.minor;
        const badCategory = !c.categories.includes(i.category);
        if (over || badCategory) {
          const max = c.max_amount.currency === 'USD' && c.max_amount.minor % 100 === 0 ? `$${c.max_amount.minor / 100}` : `${decimal(c.max_amount.minor, c.max_amount.currency)} ${c.max_amount.currency}`;
          return refuse(3, badCategory ? `max_amount ${max} per deal; category ${i.category} not allowed` : `amount ${decimal(amount.minor, amount.currency)} above max_amount ${max} per deal`);
        }
        break;
      }
      case 'band': {
        if (!c.item_refs.includes(t.item_ref)) return refuse(4, 'item outside band');
        if (at >= c.deadline) return refuse(4, 'deadline reached');
        if (i.roundsUsed >= c.max_rounds) return refuse(4, 'max_rounds reached');
        const bound = d.side === 'buyer' ? c.ceiling : c.floor;
        if (!bound) return refuse(4, 'required side of band missing');
        if (bound.currency !== t.unit_price.currency) return refuse(4, 'currency outside band');
        const price = t.unit_price;
        if (d.side === 'buyer' && price.minor > bound.minor) return refuse(4, `price ${decimal(price.minor, price.currency)} above ceiling ${decimal(bound.minor, bound.currency)}`);
        if (d.side === 'seller' && price.minor < bound.minor) return refuse(4, `price ${decimal(price.minor, price.currency)} below floor ${decimal(bound.minor, bound.currency)}`);
        break;
      }
      case 'velocity':
        if (usage.dealsToday >= c.max_deals_day) return refuse(5, 'max_deals_day reached');
        if (c.max_total_day.currency !== amount.currency || usage.totalToday + amount.minor > c.max_total_day.minor) return refuse(5, 'max_total_day exceeded');
        break;
      case 'human_present_over':
        if (c.amount.currency !== amount.currency) return refuse(6, 'threshold currency mismatch');
        if (amount.minor > c.amount.minor) decision = { type: 'ask', clause: 6 };
        break;
      case 'payees':
        if (!c.payees.includes(payee)) return refuse(7, 'payee not allowed');
        break;
      // Reading market prices grants nothing: no intent is allowed, asked or refused by it.
      case 'market_watch':
        break;
    }
  }
  if ((d.kind === 'haggle' || d.kind === 'shop_order') && !p.clauses.some((c) => c.type === 'band')) return refuse(4, 'band missing');
  return decision;
}

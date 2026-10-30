// The owner's signed rules, as far as a checker needs them: whether the payload is one the wallet
// would have signed (`MandatePayload::validate`), and its hash. Both read the payload exactly as
// the file writes it.
import { type Bytes, sha256 } from './bytes';
import { canonicalBytes } from './jcs';
import { type Clause, MAX_SAFE, type Money, type Payload, readMoney } from './bundle';

type Rec = Record<string, unknown>;
const clauseNumber: Record<string, number> = {
  roles: 1, counterparties: 2, per_deal: 3, band: 4, velocity: 5, human_present_over: 6, payees: 7, lever: 8, market_watch: 9,
};
const money = (value: unknown): Money | null => {
  try {
    return readMoney(value);
  } catch {
    return null;
  }
};
const items = (value: unknown): unknown[] | null => (Array.isArray(value) ? value : null);
const productValid = (id: unknown): boolean => typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[A-Za-z0-9_-]+$/.test(id);

type Role = 'buy' | 'sell' | 'shop' | 'rescue';
const roleActs = (role: string, side: string, kind: string): boolean =>
  (role === 'buy' && side === 'buyer' && ['purchase', 'haggle', 'invoice'].includes(kind)) ||
  (role === 'sell' && side === 'seller' && ['haggle', 'invoice'].includes(kind)) ||
  (role === 'shop' && side === 'seller' && kind === 'shop_order') ||
  (role === 'rescue' && side === 'seller' && kind === 'rescue');
const roleSide = (role: Role): string => (role === 'buy' ? 'buyer' : 'seller');

/** Why the wallet would refuse to sign this payload, or null when it would sign it. */
export function invalidPayload(p: Payload): string | null {
  if (p.version === 0 || p.expires <= p.not_before || p.not_before < 0 || p.expires > MAX_SAFE) return 'invalid mandate version or validity';
  const seen = new Set<number>();
  const sorted = [...p.clauses].sort((a, b) => (clauseNumber[a.type] ?? 0) - (clauseNumber[b.type] ?? 0));
  for (const clause of sorted) {
    const number = clauseNumber[clause.type] ?? 0;
    if (seen.has(number)) return 'duplicate clause';
    seen.add(number);
    const c = clause as Rec;
    switch (clause.type) {
      case 'roles':
        if ((items(c.roles)?.length ?? 0) === 0) return 'empty roles';
        break;
      case 'counterparties': {
        const rule = c.rule as Rec | null;
        if (rule?.type === 'pinned' && (items(rule.keys)?.length ?? 0) === 0) return 'empty pinned keys';
        break;
      }
      case 'per_deal': {
        if ((items(c.categories)?.length ?? 0) === 0) return 'empty categories';
        const max = money(c.max_amount);
        if (!max || max.minor <= 0) return 'a money limit of zero allows nothing';
        break;
      }
      case 'band': {
        const floor = c.floor === null || c.floor === undefined ? null : money(c.floor);
        const ceiling = c.ceiling === null || c.ceiling === undefined ? null : money(c.ceiling);
        if (
          (items(c.item_refs)?.length ?? 0) === 0 || c.max_rounds === 0 || typeof c.deadline !== 'number' ||
          c.deadline > p.expires || c.deadline <= p.not_before || (!floor && !ceiling)
        ) return 'invalid band';
        if (floor && ceiling && (floor.currency !== ceiling.currency || floor.minor > ceiling.minor)) return 'invalid floor/ceiling';
        if (ceiling && ceiling.minor <= 0) return 'a money limit of zero allows nothing';
        break;
      }
      case 'velocity': {
        if (c.max_deals_day === 0) return 'empty velocity allowance';
        const total = money(c.max_total_day);
        if (!total || total.minor <= 0) return 'a money limit of zero allows nothing';
        break;
      }
      case 'payees':
        if ((items(c.payees)?.length ?? 0) === 0) return 'empty payee allowance';
        break;
      case 'lever': {
        const levers = items(c.levers) ?? [];
        const discount = money(c.max_discount);
        if (levers.length === 0 || levers.some((l, i) => levers.indexOf(l) !== i)) return 'empty or repeated fix list';
        if (levers.some((l) => l !== 'DISCOUNT_THIS_CYCLE')) return 'only the discount this cycle is available';
        if (typeof c.max_discount_bp !== 'number' || c.max_discount_bp === 0 || c.max_discount_bp >= 10000) return 'discount must be above 0% and below 100%';
        if (!discount || discount.minor === 0) return 'empty discount allowance';
        break;
      }
      case 'market_watch': {
        const watched = (items(c.items) ?? []) as Rec[];
        if (watched.length === 0 || watched.length > 20) return 'invalid market watch';
        if (typeof c.max_refreshes_day !== 'number' || c.max_refreshes_day === 0 || c.max_refreshes_day > 200) return 'invalid price check allowance';
        if (watched.some((w) => !productValid(w?.product_id))) return 'invalid market product';
        if (watched.some((w, i) => watched.slice(0, i).some((s) => s?.item_ref === w?.item_ref))) return 'item watched twice';
        break;
      }
      default:
    }
  }
  for (const number of [1, 2, 3, 5, 6, 7]) if (!seen.has(number)) return 'required clause missing';
  let currency: string | null = null;
  for (const clause of p.clauses) {
    const c = clause as Rec;
    const amounts: unknown[] =
      clause.type === 'per_deal' ? [c.max_amount]
      : clause.type === 'band' ? [c.floor, c.ceiling]
      : clause.type === 'velocity' ? [c.max_total_day]
      : clause.type === 'human_present_over' ? [c.amount]
      : clause.type === 'lever' ? [c.max_discount]
      : [];
    for (const raw of amounts) {
      const m = raw === null || raw === undefined ? null : money(raw);
      if (!m) continue;
      currency ??= m.currency;
      if (currency !== m.currency) return 'currency differs across clauses';
    }
  }
  const roles = (p.clauses.find((c) => c.type === 'roles') as Rec | undefined)?.roles as Role[] | undefined;
  const rescue = roles?.includes('rescue') ?? false;
  const subscribers = p.clauses.some((c) => c.type === 'counterparties' && (c.rule as Rec | null)?.type === 'subscribers');
  if (rescue !== seen.has(8)) return 'the rescue role and the fixes clause go together';
  if (subscribers !== rescue || (rescue && roles?.length !== 1)) return 'rescue deals only with your own subscribers, in a mandate of its own';
  const perDeal = p.clauses.find((c) => c.type === 'per_deal') as Rec | undefined;
  if ((perDeal?.kind === 'haggle' || perDeal?.kind === 'shop_order') && !seen.has(4)) return 'band required for haggle and shop orders';
  if (perDeal && roles) {
    const acting = roles.filter((role) => roleActs(role, roleSide(role), String(perDeal.kind)));
    if (acting.length === 0) return 'no role in the roles clause can act on the per-deal kind';
    const band = p.clauses.find((c) => c.type === 'band') as Rec | undefined;
    if (band && !acting.some((role) => (roleSide(role) === 'buyer' ? band.ceiling != null : band.floor != null))) return 'band lacks the side the allowed roles use';
  }
  return null;
}

/** The mandate hash (what a closed mandate and a seller-rule decision name), or null when the payload
 *  is not one the wallet would sign. */
export async function payloadHash(p: Payload): Promise<Bytes | null> {
  if (invalidPayload(p) !== null) return null;
  return sha256(canonicalBytes(p.json));
}

export const clauseOf = (p: Payload, type: string): Clause | undefined => p.clauses.find((c) => c.type === type);

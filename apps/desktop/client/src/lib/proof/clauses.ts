// The owner's rules, read as strictly as the wallet reads them: each clause has exactly its fields, of the
// right kinds. A clause that does not read makes the file "not a proof file" (the wallet refuses it too),
// so an odd file is never judged on a loose reading.
import { readMoney } from './money';
import { bytes, label, list, maybe, oneOf, rec, refuse, text, whole } from './read';

export const ROLES = ['buy', 'sell', 'shop', 'rescue'] as const;
export const CATEGORIES = ['office', 'parts', 'compute', 'service', 'other'] as const;
export const LEVERS = ['DISCOUNT_THIS_CYCLE', 'PAUSE', 'RETRY_AFTER_FIX', 'DOWNGRADE'] as const;
export const SHIELD_VERDICTS = ['CLEAR', 'ASK', 'HOLD', 'BLOCK'] as const;
export const SHIELD_RULES = ['payee_mismatch', 'friends_and_family', 'no_market_reference', 'price_over_market', 'new_counterparty_over_threshold', 'model_caution'] as const;
const DEAL_KINDS = ['purchase', 'haggle', 'shop_order', 'rescue', 'invoice'] as const;
export const CLAUSE_TYPES = ['roles', 'counterparties', 'per_deal', 'band', 'velocity', 'human_present_over', 'payees', 'lever', 'market_watch'] as const;

function readRule(value: unknown): void {
  const type = oneOf((value as { type?: unknown } | null)?.type, ['pinned', 'paired', 'house', 'subscribers'] as const);
  if (type === 'pinned') list(rec(value, ['type', 'keys']).keys).forEach(label);
  else rec(value, ['type']);
}

/** Checks one clause of the rules has exactly the fields the wallet writes; returns it as it was. */
export function readClause(value: unknown): { type: string; [field: string]: unknown } {
  const type = oneOf((value as { type?: unknown } | null)?.type, CLAUSE_TYPES);
  switch (type) {
    case 'roles':
      list(rec(value, ['type', 'roles']).roles).forEach((r) => oneOf(r, ROLES));
      break;
    case 'counterparties':
      readRule(rec(value, ['type', 'rule']).rule);
      break;
    case 'per_deal': {
      const r = rec(value, ['type', 'kind', 'max_amount', 'categories']);
      oneOf(r.kind, DEAL_KINDS);
      readMoney(r.max_amount);
      list(r.categories).forEach((c) => oneOf(c, CATEGORIES));
      break;
    }
    case 'band': {
      const r = rec(value, ['type', 'item_refs', 'max_rounds', 'deadline'], ['floor', 'ceiling']);
      list(r.item_refs).forEach(label);
      maybe(r.floor, readMoney);
      maybe(r.ceiling, readMoney);
      whole(r.max_rounds, 0, 255);
      whole(r.deadline);
      break;
    }
    case 'velocity': {
      const r = rec(value, ['type', 'max_deals_day', 'max_total_day']);
      whole(r.max_deals_day, 0, 65535);
      readMoney(r.max_total_day);
      break;
    }
    case 'human_present_over':
      readMoney(rec(value, ['type', 'amount']).amount);
      break;
    case 'payees':
      list(rec(value, ['type', 'payees']).payees).forEach(label);
      break;
    case 'lever': {
      const r = rec(value, ['type', 'levers', 'max_discount_bp', 'max_discount']);
      list(r.levers).forEach((l) => oneOf(l, LEVERS));
      whole(r.max_discount_bp, 0, 65535);
      readMoney(r.max_discount);
      break;
    }
    case 'market_watch': {
      const r = rec(value, ['type', 'items', 'max_refreshes_day']);
      list(r.items).forEach((i) => {
        const x = rec(i, ['item_ref', 'product_id']);
        label(x.item_ref);
        text(x.product_id);
      });
      whole(r.max_refreshes_day, 0, 65535);
      break;
    }
    default:
      return refuse();
  }
  return value as { type: string };
}

/** The optional records of a deal the checks do not read but the wallet's reader insists on. */
export function readDealExtras(r: Record<string, unknown>): void {
  maybe(r.shield, (v) => oneOf(v, SHIELD_VERDICTS));
  maybe(r.shield_rule, (v) => oneOf(v, SHIELD_RULES));
  maybe(r.shield_release, (v) => {
    const x = rec(v, ['terms_hash', 'rules', 'at']);
    list(x.rules).forEach((rule) => oneOf(rule, SHIELD_RULES));
    whole(x.at);
    bytes(x.terms_hash, 32);
    return true;
  });
  const paypal = rec(r.paypal, [], ['order', 'authorization', 'capture', 'subscription']);
  for (const key of ['order', 'authorization', 'capture', 'subscription']) maybe(paypal[key], text);
}

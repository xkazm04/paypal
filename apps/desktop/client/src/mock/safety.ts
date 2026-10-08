// Mock of Runtime::safety_record ("Your safety record"): counted from the same week the mock's
// deal_history serves, so the sheet, the Rewind and the deals agree. Rust counts money steps from
// each deal's operations and refusals from its intent.refused rows; here a money step is a history
// step with a money call at PayPal, and a refusal is an agent refusal step (a refused intent, or a
// deal your rules refused at the agent's request). Preview only: `?records=broken` shows a broken
// chain (as audit_page does) and `?safety=violation` an authority-less capture on the dock order.
import type { H256 } from '@bindings/H256';
import type { HistoryStep } from '@bindings/HistoryStep';
import type { SafetyMoney } from '@bindings/SafetyMoney';
import type { SafetyRecord } from '@bindings/SafetyRecord';
import type { SafetyRefusalCount } from '@bindings/SafetyRefusalCount';
import type { SafetyRefusalFamily } from '@bindings/SafetyRefusalFamily';
import { fakeHash, fakeUlid, type MockState } from './fixtures';

/** As table_client::SAFETY_DEALS: the newest deals checked at most. */
export const SAFETY_DEALS = 1000;
const MONEY = new Set(['create_order', 'authorize', 'capture', 'void', 'create_invoice', 'send_invoice']);
const FAMILY_ORDER: readonly SafetyRefusalFamily[] = ['your_rules', 'scam_check', 'out_of_turn', 'not_allowed', 'unusable', 'older'];

/** An agent request the wallet refused, and the kind of reason (a clause = a rule you signed;
 *  none = a tool or deal the agent has no business with, the only other kind the fixtures play). */
function refusalFamily(s: HistoryStep): SafetyRefusalFamily | null {
  if (s.kind === 'intent_refused') return s.authority.type === 'signed_rule' && s.authority.clause != null ? 'your_rules' : 'not_allowed';
  if (s.kind === 'refused' && s.authority.type === 'signed_rule') return 'your_rules';
  return null;
}

export function safetyRecordOf(state: MockState, history: readonly HistoryStep[], now: number, preview: { broken?: boolean; violation?: boolean } = {}): SafetyRecord {
  // The bookkeeping entries the history leaves out (signed rules, deadlines) are on the chain too.
  const records = history.length + (state.audit ?? []).filter((r) => r.action === 'mandate.signed' || r.action === 'deadline.set').length;
  const money: SafetyMoney = { owner: 0, signed_rule: 0, shop_rules: 0, house_rules: 0, safe_default: 0, safe_default_voids: 0 };
  const empty: SafetyRecord = {
    checked_at: now, records, head: null, intact: false, deals_total: state.deals.length, deals_checked: 0, transcripts_verified: 0,
    money, refusals: 0, refusal_families: [], refused_deals: 0, refused_deal_calls: 0,
    violations: [{ deal_id: null, kind: 'chain_broken', detail: 'the audit chain does not verify: ledger integrity failure: audit sequence/previous hash' }],
    violations_total: 1,
  };
  if (preview.broken) return empty;

  const deals = state.deals.slice(-SAFETY_DEALS);
  const ids = new Set(deals.map((d) => d.deal.id));
  const steps = history.filter((s) => ids.has(s.deal_id));
  for (const s of steps) {
    if (s.paypal.type !== 'call' || !MONEY.has(s.paypal.method)) continue;
    switch (s.authority.type) {
      case 'owner': money.owner++; break;
      case 'signed_rule': money.signed_rule++; break;
      case 'seller_mandate': money.shop_rules++; break;
      case 'house_mandate': money.house_rules++; break;
      case 'safe_default': money.safe_default++; if (s.paypal.method === 'void') money.safe_default_voids++; break;
      default: break;
    }
  }
  const families = new Map<SafetyRefusalFamily, number>();
  for (const s of steps) {
    const f = refusalFamily(s);
    if (f) families.set(f, (families.get(f) ?? 0) + 1);
  }
  const refusal_families: SafetyRefusalCount[] = FAMILY_ORDER.flatMap((family) => (families.get(family) ? [{ family, count: families.get(family) ?? 0 }] : []));
  const refused = deals.filter((d) => d.deal.state === 'REFUSED').map((d) => d.deal.id);
  const refused_deal_calls = steps.filter((s) => refused.includes(s.deal_id) && s.paypal.type === 'call').length;
  const dock = fakeUlid('D-0190');
  const violations: SafetyRecord['violations'] = preview.violation && ids.has(dock)
    ? [{ deal_id: dock, kind: 'authority', detail: `Purchase deal ${dock}: capture (attempt 1, decided_by SafeDefault): a safe default decided a capture; it may only void` }]
    : [];
  if (preview.violation) { money.safe_default++; }
  const head: H256 = fakeHash(`chain:${records}:${history[history.length - 1]?.seq ?? 0}`);
  return {
    checked_at: now, records, head, intact: true, deals_total: state.deals.length, deals_checked: deals.length, transcripts_verified: deals.length,
    money, refusals: refusal_families.reduce((n, f) => n + f.count, 0), refusal_families,
    refused_deals: refused.length, refused_deal_calls, violations, violations_total: violations.length,
  };
}

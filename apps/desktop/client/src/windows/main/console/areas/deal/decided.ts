// "Who decided" as pure functions (moved from deal/WhoDecided.tsx by rebuild WP3c; rewind.test.ts
// reads them): which steps of a deal's verified record are decisions, and the line saying who
// decided each one (you, a rule you signed, your shop rules after the buyer approved, or the safe
// default) and whether PayPal was called. A refusal says PayPal was never asked.
import type { HistoryStep } from '@bindings/HistoryStep';
import { DEAL_DECIDED } from '../../../../../lib/words';
import { isMoneyCall, isRefusal, whoDecided } from '../../../logic';

/** "You · PayPal call", "Your rules · no PayPal call", "Refused · PayPal never asked". */
export function decidedLine(s: HistoryStep): string {
  if (isRefusal(s)) return DEAL_DECIDED.refused;
  const call = s.paypal.type === 'call' ? (isMoneyCall(s) ? DEAL_DECIDED.call : DEAL_DECIDED.checked) : DEAL_DECIDED.noCall;
  return [whoDecided(s.authority), call].filter(Boolean).join(' · ');
}

/** The steps worth a line: every decision, every money call and every refusal. */
export function decisionSteps(steps: readonly HistoryStep[]): HistoryStep[] {
  return steps.filter((s) => isMoneyCall(s) || isRefusal(s) || s.kind === 'approved_by_buyer' || s.kind === 'checking_with_paypal'
    || (s.authority.type !== 'none' && s.authority.type !== 'agent_intent'));
}

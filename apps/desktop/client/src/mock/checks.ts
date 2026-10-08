// Browser mock of the wallet's approval checklist (Rust: crates/table-app/src/checks.rs). Same six
// lines, same order, same Layer-1 words, from the mock's fixtures instead of the ledger; the
// Layer-2 detail says what the mock stood in for. The hash is a fake digest of the list, so a
// changed list changes it exactly as the real one does.
import type { ApprovalCheck } from '@bindings/ApprovalCheck';
import type { ApprovalCheckId } from '@bindings/ApprovalCheckId';
import type { ApprovalCheckStatus } from '@bindings/ApprovalCheckStatus';
import type { Deal } from '@bindings/Deal';
import type { H256 } from '@bindings/H256';
import type { Money } from '@bindings/Money';
import type { OpenMandate } from '@bindings/OpenMandate';
import type { RescueView } from '@bindings/RescueView';
import type { ShieldRule } from '@bindings/ShieldRule';
import type { CounterpartyDisplay, TranscriptStep } from '../lib/pending';
import { formatMoney, lineTotal } from '../lib/format';
import { percentWords, shieldReleased } from '../lib/words';
import { fakeHash } from './fixtures';

/** table-app checks.rs `shield_rule_words`, verbatim (the approval checklist's shield line). */
export const SHIELD_RULE_WORDS: Record<ShieldRule, string> = {
  payee_mismatch: 'The money would go to another payee than the one you agreed',
  friends_and_family: 'It asks to be paid as friends and family, which has no buyer protection',
  no_market_reference: 'There is no recent usual price to compare it with',
  price_over_market: 'The price is far above the usual price',
  new_counterparty_over_threshold: 'A new payee is asking for a large amount',
  model_caution: 'A second look asked for caution',
};

export type MockCheckInput = {
  deal: Deal;
  transcript: readonly TranscriptStep[];
  counterparty: CounterpartyDisplay | undefined;
  /** The active version of the deal's mandate, if any (revoked or replaced reads as undefined). */
  mandate: OpenMandate | undefined;
  /** Amount already committed today under the mandate (minor units), for the daily limit. */
  spentTodayMinor: number;
  now: number;
  /** The wallet limits' refusal of this deal (src/mock/exposure.ts), checked after the mandate. */
  limitRefusal?: string | null;
  /** On a rescue deal: its stored failure and fix (rescue_book's row), if the wallet has one. */
  rescue?: RescueView;
};

const line = (id: ApprovalCheckId, status: ApprovalCheckStatus, text: string, detail: string): ApprovalCheck => ({ id, status, text, detail });
const RULE: Record<number, string> = { 1: 'what agents may do', 2: 'who they deal with', 3: 'the limit per deal', 4: 'the price range', 5: 'the daily limit', 6: 'ask me above', 7: 'approved payees', 8: 'fixes for failed renewals', 0: 'your wallet limits' };
const code = (m: Money) => formatMoney(m, { code: true });
const ORDER_EXPECTED = new Set<Deal['state']>(['AGREED', 'SETTLING']);

type Settle = { amount: Money } | null;
type MandateFact = { k: 'allow'; perDeal: Money | null } | { k: 'ask'; threshold: Money } | { k: 'refused'; clause: number; reason: string } | { k: 'retired' };

/** The latest payment request: the seller's signed SETTLE, or the order this wallet made. */
function settleOf(i: MockCheckInput): Settle {
  // A refused request is never stored by the wallet, so a mismatched deal has none to read.
  if (i.deal.state === 'MISMATCH') return null;
  for (let n = i.transcript.length - 1; n >= 0; n--) {
    const s = i.transcript[n]!;
    if (s.typ === 'SETTLE' && s.price) return { amount: s.price };
  }
  return i.deal.paypal.order ? { amount: lineTotal(i.deal.terms.unit_price, i.deal.terms.qty) } : null;
}

function mandateFact(i: MockCheckInput, payee: string | null): MandateFact {
  const m = i.mandate;
  const d = i.deal;
  if (!m || m.payload.version !== d.mandate_version || i.now < m.payload.not_before || i.now >= m.payload.expires) return { k: 'retired' };
  const total = lineTotal(d.terms.unit_price, d.terms.qty);
  let ask: Money | null = null;
  let perDeal: Money | null = null;
  for (const c of m.payload.clauses) {
    switch (c.type) {
      case 'counterparties':
        // A subscriber has no wallet: "your own subscribers" allows rescue only (Rust CpRule::Subscribers).
        if (c.rule.type === 'subscribers' ? d.kind !== 'rescue' : d.kind === 'rescue' || !i.counterparty || i.counterparty.pairing === 'unpaired')
          return { k: 'refused', clause: 2, reason: 'counterparty is not pinned/paired as required' };
        break;
      case 'per_deal':
        if (c.kind !== d.kind) return { k: 'refused', clause: 3, reason: 'deal kind not allowed' };
        if (total.minor > c.max_amount.minor) return { k: 'refused', clause: 3, reason: `amount above max_amount ${code(c.max_amount)} per deal` };
        perDeal = c.max_amount;
        break;
      case 'band': {
        if (!c.item_refs.includes(d.terms.item_ref)) return { k: 'refused', clause: 4, reason: 'item outside band' };
        if (c.deadline <= i.now) return { k: 'refused', clause: 4, reason: 'deadline reached' };
        const bound = d.side === 'buyer' ? c.ceiling : c.floor;
        if (bound && (d.side === 'buyer' ? d.terms.unit_price.minor > bound.minor : d.terms.unit_price.minor < bound.minor))
          return { k: 'refused', clause: 4, reason: `price outside the band (${code(bound)})` };
        break;
      }
      case 'velocity':
        if (total.minor + i.spentTodayMinor > c.max_total_day.minor) return { k: 'refused', clause: 5, reason: 'max_total_day exceeded' };
        break;
      case 'human_present_over':
        if (total.minor > c.amount.minor) ask = c.amount;
        break;
      case 'payees':
        if (!payee || !c.payees.includes(payee)) return { k: 'refused', clause: 7, reason: 'payee not allowed' };
        break;
      case 'roles':
        if (d.kind === 'rescue' && !c.roles.includes('rescue')) return { k: 'refused', clause: 1, reason: 'role not allowed' };
        break;
      case 'lever':
        // Its bounds are checked on the fix itself (Rust rescue::check_offer).
        break;
      // Keeping prices fresh grants nothing and refuses nothing.
      case 'market_watch':
        break;
    }
  }
  if (d.kind === 'rescue' && !m.payload.clauses.some((c) => c.type === 'lever')) return { k: 'refused', clause: 8, reason: 'fixes clause missing' };
  // The wallet limits sit above every mandate and only ever refuse (Rust: clause 0).
  if (i.limitRefusal) return { k: 'refused', clause: 0, reason: i.limitRefusal };
  return ask ? { k: 'ask', threshold: ask } : { k: 'allow', perDeal };
}

/** The six lines, in the wallet's order. */
export function mockChecks(i: MockCheckInput): ApprovalCheck[] {
  const d = i.deal;
  const total = lineTotal(d.terms.unit_price, d.terms.qty);
  const T = formatMoney(total);
  const settle = settleOf(i);
  const signed = `signed terms ${d.terms.qty} × ${code(d.terms.unit_price)} = ${code(total)} (mock)`;
  const approved = i.mandate?.payload.clauses.find((c) => c.type === 'payees');
  const approvedList = approved?.type === 'payees' ? approved.payees : null;
  const own = d.side === 'seller';
  const payee = own ? (approvedList?.length === 1 ? approvedList[0]! : null) : i.counterparty?.declared_payee ?? null;
  const paired = own || (!!i.counterparty && i.counterparty.pairing !== 'unpaired');
  const out: ApprovalCheck[] = [];

  // amount
  if (d.state === 'MISMATCH') out.push(line('amount', 'fail', `The payment request didn’t match the ${T} you agreed.`, `deal state MISMATCH: the payment request disagreed with the ${signed}; a refused request is never stored`));
  else if (settle && (settle.amount.minor !== total.minor || settle.amount.currency !== total.currency))
    out.push(line('amount', 'fail', `The payment request asks ${formatMoney(settle.amount)}, but you agreed ${T}.`, `SETTLE amount ${code(settle.amount)} (attempt 1) ≠ ${signed}`));
  else if (settle) out.push(line('amount', 'pass', `The payment request is for ${T}, the amount you agreed.`, `SETTLE amount ${code(settle.amount)} (attempt 1, intent AUTHORIZE) = ${signed}`));
  else if (d.side === 'buyer' && d.kind === 'haggle' && d.state === 'NEGOTIATING' && i.transcript.at(-1)?.by === 'them' && i.transcript.at(-1)?.typ === 'COUNTER') {
    const offer = i.transcript.at(-1)!.price;
    out.push(offer && offer.minor === d.terms.unit_price.minor
      ? line('amount', 'pass', `Their latest offer is ${T}, the price you’re approving.`, `latest inbound COUNTER terms = ${signed}`)
      : line('amount', 'fail', 'Their latest offer isn’t the price shown here.', `latest inbound COUNTER terms ≠ ${signed}`));
  } else out.push(line('amount', 'wait', 'Checked when the PayPal order is made, before any money moves.', `no payment request yet; making the order verifies its amount against the ${signed} and stops the deal as MISMATCH otherwise`));

  // payee
  const rule = approvedList ? `clause 7 approved payees [${approvedList.join(', ')}]` : 'no approved-payees rule (clause 7)';
  if (!payee) out.push(line('payee', 'fail', 'Who gets paid can’t be confirmed.', 'settlement payee unreadable (no single approved payee in your rules, or no counterparty record)'));
  else if (approvedList && !approvedList.includes(payee)) out.push(line('payee', 'fail', 'Who gets paid isn’t on your approved payees.', `payee ${payee} is not on ${rule}`));
  else if (own) out.push(line('payee', 'pass', 'Paid to your own payee from your rules.', `order payee ${payee} = the single payee on ${rule}`));
  else if (paired) out.push(line('payee', 'pass', 'Paid only to the payee their wallet declared when you connected.', `settlement payee ${payee} = declared payee of the paired key ${d.counterparty}; ${rule}`));
  else if (approvedList) out.push(line('payee', 'pass', 'Paid only to a payee on your approved payees.', `settlement payee ${payee} (key ${d.counterparty} not paired) is on ${rule}`));
  else out.push(line('payee', 'fail', 'This wallet isn’t one you connected, so who gets paid can’t be confirmed.', `key ${d.counterparty} has no confirmed pairing words and its declared payee ${payee} is not approved; ${rule}`));

  // host and invoice (the mock's links and order numbers are always the wallet's own)
  if (settle) {
    out.push(d.mode === 'replay'
      ? line('host', 'fail', 'A replay never opens PayPal.', 'approve link refused: replay mode never opens PayPal (mock)')
      : line('host', 'pass', 'The PayPal link goes to PayPal’s own sandbox site.', 'approve link host www.sandbox.paypal.com over https; allowlist www.sandbox.paypal.com (mock)'));
    out.push(line('invoice', 'pass', 'The order number is new for this try (1 of 3), so an old order can’t be reused.', `invoice_id ${d.id}-1 = deal id + attempt 1`));
  } else if (ORDER_EXPECTED.has(d.state)) {
    out.push(line('host', 'wait', 'The PayPal link is checked when the order is made.', 'no approval link yet; making the order verifies the link is on the allowlist (www.sandbox.paypal.com)'));
    out.push(line('invoice', 'wait', 'The order number is set when the order is made.', `invoice_id ${d.id}-1 is bound into the order and the countersign when the order is made`));
  } else {
    out.push(line('host', 'not_applicable', 'No PayPal link is used for this step.', 'no SETTLE: no approval link exists for this deal'));
    out.push(line('invoice', 'not_applicable', 'No PayPal order is used for this step.', 'no SETTLE: no order exists for this deal'));
  }

  // shield (the mock runs no rules: an unset verdict reads as the rules finding nothing). The rule
  // that decided it is Rust's recorded one (Deal.shield_rule), worded as checks.rs words it.
  const shieldRule = d.shield_rule ?? null;
  const why = shieldRule ? ` ${SHIELD_RULE_WORDS[shieldRule]}.` : '';
  const ruleName = shieldRule ?? 'none';
  if (d.shield === 'ASK' && shieldReleased(d)) {
    out.push(line('shield', 'pass', `Scam check: you let this go on after a pause.${why} Your decision is the check.`, `shield verdict HOLD (rule ${ruleName}) released by the owner for these terms: judged as ASK`));
  } else {
    switch (d.shield ?? 'CLEAR') {
      case 'CLEAR': out.push(line('shield', 'pass', 'Scam check: looks safe.', 'shield verdict CLEAR (rules re-run now, combined with any stored verdict)')); break;
      case 'ASK': out.push(line('shield', 'pass', `Scam check: check with you.${why} Your decision is the check.`, `shield verdict ASK (rule ${ruleName}): only an owner decision (or the house release) passes it`)); break;
      case 'HOLD': out.push(line('shield', 'fail', `Scam check: paused for you.${why} Unpause it first.`, `shield verdict HOLD (rule ${ruleName}) stops every money step under every authority`)); break;
      case 'BLOCK': out.push(line('shield', 'fail', `Scam check: blocked.${why} It can’t be released.`, `shield verdict BLOCK (rule ${ruleName}) stops every money step; no release exists`)); break;
    }
  }

  // mandate
  const which = `mandate ${d.mandate_id} v${d.mandate_version}`;
  const m = mandateFact(i, payee);
  switch (m.k) {
    case 'allow': out.push(line('mandate', 'pass', m.perDeal ? `Inside your rules: up to ${formatMoney(m.perDeal)} per deal.` : 'Inside your rules.', `${which}: allowed${m.perDeal ? `; clause 3 limit per deal ${code(m.perDeal)}` : ''}`)); break;
    case 'ask': out.push(line('mandate', 'pass', `Above your ask-me limit of ${formatMoney(m.threshold)}, so it’s your call.`, `${which}: clause 6 asks the owner above ${code(m.threshold)}; the owner decision satisfies it`)); break;
    case 'refused': out.push(line('mandate', 'fail', `Outside your rules: ${RULE[m.clause] ?? 'a rule'}.`, `${which}: clause ${m.clause} refuses: ${m.reason}`)); break;
    case 'retired': out.push(line('mandate', 'fail', 'These rules are no longer in force.', `${which} is not active (revoked, replaced, expired or not yet in force)`)); break;
  }
  return d.kind === 'rescue' ? rescueLines(i, out, m) : out;
}

/** Rust compose_rescue: the fix's amount against the signed fixes rule, no PayPal link, one
 *  invoice this cycle, and the rescue rules in place of the amount, host, invoice and mandate lines. */
function rescueLines(i: MockCheckInput, lines: ApprovalCheck[], m: MandateFact): ApprovalCheck[] {
  const d = i.deal;
  const v = i.rescue;
  const o = v?.offer;
  const lever = i.mandate?.payload.clauses.find((c): c is Extract<typeof c, { type: 'lever' }> => c.type === 'lever');
  const out = [...lines];
  out[0] = o && d.terms.qty === 1 && o.invoice.minor === d.terms.unit_price.minor && o.invoice.currency === d.terms.currency
    ? line('amount', 'pass', `The invoice asks ${formatMoney(o.invoice)}: ${percentWords(o.discount_bp)} off this cycle’s ${formatMoney(o.cycle)}.`,
      `rescue offer ${o.lever}: cycle ${code(o.cycle)} − discount ${code(o.discount)} = invoice ${code(o.invoice)} = signed terms (qty 1) (mock)`)
    : line('amount', 'fail', 'The fix’s amount can’t be confirmed.', 'no rescue row, or its offer is not what the deal\'s terms invoice');
  out[2] = line('host', 'not_applicable', 'No PayPal link is opened: PayPal emails the invoice to your subscriber.', 'Invoicing v2: POST /v2/invoicing/invoices then …/{id}/send; no approve link');
  out[3] = v
    ? line('invoice', 'pass', d.mode === 'replay' ? 'A replayed failure: the invoice is real, but what it brings in is not counted as recovered.' : 'This subscriber gets one invoice for this cycle.',
      `one rescue per subscription per failed cycle; invoice number ${d.id}-1 (attempt 1)${d.paypal.order ? `; PayPal invoice ${d.paypal.order}` : ''} (mock)`)
    : line('invoice', 'fail', 'The failed renewal behind this fix can’t be read.', 'no rescue row for this deal');
  if ((m.k === 'allow' || m.k === 'ask') && lever) {
    out[5] = line('mandate', 'pass', `Inside your rescue rules: at most ${percentWords(lever.max_discount_bp)} or ${formatMoney(lever.max_discount)} off a cycle.`,
      `mandate ${d.mandate_id} v${d.mandate_version}: clauses 1-7 allow; clause 8 allows DISCOUNT_THIS_CYCLE up to ${lever.max_discount_bp} bp and ${code(lever.max_discount)}`);
  }
  return out;
}

/** Stand-in for the domain-separated checks hash: any change to any line changes it. */
export function mockChecksHash(checks: readonly ApprovalCheck[]): H256 {
  return fakeHash(`table.approval-checks.v1|${JSON.stringify(checks)}`);
}

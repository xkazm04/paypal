// Pure words for the deal story (docs/ux/ROUND-1.md): the one-sentence answer, the decision's
// question / reason / option consequences, the rule checks, the thread order and the right-hand
// "where it stands" facts. No React, no IPC; unit-tested in story.test.ts. Display only: nothing
// here decides, gates or moves money.
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import type { DisplayBand } from '@bindings/DisplayBand';
import type { MoneyCheck } from '@bindings/MoneyCheck';
import type { RescueOffer } from '@bindings/RescueOffer';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import { formatMoney } from '../../../lib/format';
import { headlineWords, houseWords, MONEY_CHECK_PARKED, marketWords, percentWords, moneyCheckStep, ruleNameOf, shieldRuleWord, sellerSaysOnly, stateWord } from '../../../lib/words';
import { dealTotal, decidedBy, isTerminal } from '../logic';
import { latestText, timelineRows, type ClauseReading, type Reading, type TimelineRow } from './model';

export type AnswerTone = 'calm' | 'need' | 'alert' | 'done';
export type DealAnswer = { tone: AnswerTone; title: string; sub: string | null };

export const CLOSED = 'This deal is closed. Nothing here can move money.';

type AnswerDeal = Pick<Deal, 'state' | 'kind' | 'side' | 'shield' | 'terms'> & Partial<Pick<Deal, 'decided_by' | 'shield_rule'>>;

export type AnswerCtx = {
  need: Pick<AttentionItem, 'headline' | 'actions'> | undefined;
  /** Their first name ("Dan"). */
  them: string;
  /** The newest signed message, if the deal has a conversation. */
  latest: TranscriptStep | null;
  /** How the price-range rule reads against the latest price (null when the deal has none). */
  band: Reading | null;
  mayWithdraw: boolean;
  /** A money step whose PayPal answer was lost and is being checked with PayPal. */
  check?: MoneyCheck | null;
};

/** What the price range says about the offer, as the second half of the answer. */
function bandPhrase(r: Reading | null): string {
  if (r === 'within') return ' It’s inside your price range; you decide.';
  if (r === 'outside') return ' It’s outside your price range; you decide.';
  return ' Your call.';
}

/** The page's answer in one sentence. Closed deals are calm, a stop is an alert, a wait is gold. */
export function dealAnswer(d: AnswerDeal, c: AnswerCtx): DealAnswer {
  const amt = formatMoney(dealTotal(d));
  const w = stateWord(d.state, { side: d.side, kind: d.kind });
  const who = decidedBy(d);
  const decided = who.who === 'none' ? '' : ` · decided by ${who.text}`;
  const latest = c.latest ? latestText([c.latest], c.them) : null;

  // Stops first: a mismatch never offers a pay action, a refusal never reached PayPal.
  if (d.state === 'MISMATCH') {
    return { tone: 'alert', title: `${c.them} asked for a different amount than you agreed, so nothing can be paid.`, sub: `${c.need ? headlineWords(c.need.headline) : 'The payment request did not match the signed deal'}. ${CLOSED}` };
  }
  if (d.state === 'REFUSED') {
    return d.shield === 'BLOCK'
      ? { tone: 'alert', title: 'A scam check stopped this for good. Nothing was sent to PayPal.', sub: d.shield_rule ? `${shieldRuleWord(d.shield_rule).means} ${CLOSED}` : CLOSED }
      : { tone: 'alert', title: 'Your rules refused this before PayPal was asked. Nothing moved.', sub: who.who === 'none' ? CLOSED : `Refused by ${who.text}. ${CLOSED}` };
  }
  if (d.state === 'DISPUTED') return { tone: 'alert', title: 'There is an open dispute at PayPal.', sub: CLOSED };
  if (d.state === 'UNCONFIRMED') return { tone: 'alert', title: w.means, sub: CLOSED };
  if (d.state === 'FAILED') return { tone: 'alert', title: d.kind === 'rescue' ? 'The invoice was cancelled at PayPal. Nothing was recovered.' : 'The payment failed at PayPal.', sub: CLOSED };

  if (isTerminal(d)) {
    const settled = (d.state === 'CAPTURED' || d.state === 'RECEIPTED' || d.state === 'RECONCILED') && !sellerSaysOnly(d);
    // A deal the deadline ended was not walked away from: say that nobody acted in time.
    const lapsed = who.who === 'default' && (d.state === 'WITHDRAWN' || d.state === 'EXPIRED') ? 'Nobody acted before the deadline, so it ended. No money moved.' : null;
    return { tone: settled ? 'done' : 'calm', title: CLOSED, sub: `${settled ? `${w.text} · ${amt}` : lapsed ?? w.means}${decided}` };
  }

  // Not paid and not failed: PayPal's own record decides which, and nothing moves until then.
  if (c.check) {
    const step = moneyCheckStep(c.check.step);
    return c.check.state === 'parked'
      ? { tone: 'need', title: MONEY_CHECK_PARKED, sub: `PayPal’s answer about ${step} for ${amt} didn’t arrive. It is not paid and not failed until PayPal says which: at the deadline the wallet asks PayPal, and what PayPal shows decides.` }
      : { tone: 'need', title: `Checking ${step} for ${amt} with PayPal.`, sub: 'PayPal’s answer didn’t arrive. Nothing more is sent until PayPal confirms what happened.' };
  }

  if (c.need) {
    if (d.state === 'AUTHORIZED') return { tone: 'need', title: `${amt} for ${c.them} is on hold at PayPal. Pay it or release it; you decide.`, sub: null };
    if (d.shield === 'HOLD') return { tone: 'need', title: `${c.them}’s ${amt} request was paused for your check. Nothing was sent to PayPal.`, sub: d.shield_rule ? shieldRuleWord(d.shield_rule).means : null };
    if (d.kind === 'rescue') return { tone: 'need', title: `${c.them.charAt(0).toUpperCase()}${c.them.slice(1)}’s renewal didn’t go through. You choose the fix: a ${amt} invoice for this cycle.`, sub: null };
    if (d.kind === 'haggle') return { tone: 'need', title: `${latest ?? `${c.them} has an offer`}.${bandPhrase(c.band)}`, sub: null };
    return { tone: 'need', title: `${headlineWords(c.need.headline)} with ${c.them}. Your call.`, sub: null };
  }

  if (d.state === 'APPROVED' || d.state === 'SETTLING' || d.state === 'AWAITING_APPROVAL') {
    return { tone: 'calm', title: `Nothing for you to decide: ${c.them} acts next.`, sub: w.means };
  }
  return {
    tone: 'calm',
    title: `${latest ? `${latest}. ` : ''}Nothing needs you right now.`,
    sub: `${w.means}${c.mayWithdraw ? ' You can withdraw any time; withdrawing can’t move money.' : ''}`,
  };
}

// ---- the decision ---------------------------------------------------------------------------------

type QDeal = Pick<Deal, 'state' | 'kind' | 'side' | 'shield' | 'terms'>;

/** The decision as a question about people and money. */
export function decisionQuestion(d: QDeal, need: Pick<AttentionItem, 'headline'>, them: string): string {
  const amt = formatMoney(dealTotal(d));
  if (d.state === 'AUTHORIZED') return `Pay ${them} ${amt}, or release the hold?`;
  // A live pause is released (or refused) by the owner, as on the Shield page; a closed one can only be withdrawn.
  if (d.shield === 'HOLD') return isTerminal(d) ? `Withdraw ${them}’s paused ${amt} request?` : `Let this ${amt} payment to ${them} go ahead?`;
  if (d.kind === 'rescue') return `Approve a ${amt} invoice to fix ${them}’s failed renewal?`;
  if (d.kind === 'haggle') return d.side === 'buyer' ? `Accept ${them}’s ${formatMoney(d.terms.unit_price)}?` : `Sell to ${them} for ${formatMoney(d.terms.unit_price)}?`;
  return `${headlineWords(need.headline)} with ${them}?`;
}

/** Why the owner is asked: the rule that hands it to them, or the check that paused it. */
export function decisionWhy(d: Pick<Deal, 'shield'>, need: Pick<AttentionItem, 'clause'>, readings: readonly ClauseReading[], mandateId: string): string | null {
  const n = need.clause && need.clause.mandate_id === mandateId ? need.clause.number : null;
  const r = n !== null ? readings.find((x) => x.n === n) : undefined;
  if (r) return `Because of your rule “${r.title}” (${houseWords(r.rule)}).`;
  if (need.clause) return `Because of your rule “${ruleNameOf(need.clause.number)}”.`;
  if (d.shield === 'HOLD') return 'A scam check paused this before PayPal was asked.';
  return null;
}

/** What "Review & approve" will do, without ever saying it moves money from this window. */
export function reviewMeans(d: QDeal, locked: boolean): string {
  const unlock = locked ? ' You unlock with Windows Hello first.' : '';
  const base = d.state === 'AUTHORIZED' ? 'Opens the approval window, where you can pay the held amount or release it.'
    : d.kind === 'rescue' ? 'Opens the approval window to pick a fix.'
      : d.kind === 'haggle' ? `Opens the approval window to accept ${formatMoney(d.terms.unit_price)}.`
        : 'Opens the approval window.';
  return `${base} Nothing moves until you confirm there.${unlock}`;
}

// ---- your rules -------------------------------------------------------------------------------------

export type RuleCheck = { key: string; n: number; name: string; state: 'pass' | 'ask' | 'fail' | 'unknown'; value: string; title: string };
const STATE_OF: Record<Exclude<Reading, 'na'>, RuleCheck['state']> = { within: 'pass', asks: 'ask', outside: 'fail', unknown: 'unknown' };

/** One check per rule that applies to this deal; "does not apply" rules are left out. */
export function ruleChecks(readings: readonly ClauseReading[]): RuleCheck[] {
  return readings.filter((r) => r.reading !== 'na').map((r) => ({
    key: r.key, n: r.n, name: r.title, state: STATE_OF[r.reading as Exclude<Reading, 'na'>], value: r.fact, title: `You signed: ${r.rule}`,
  }));
}

/** The small badge on the "Your rules" tab: only an exception earns one. */
export function rulesBadge(checks: readonly RuleCheck[]): { tone: 'gold' | 'red'; text: string } | null {
  const fail = checks.filter((c) => c.state === 'fail').length;
  if (fail) return { tone: 'red', text: fail === 1 ? '1 outside' : `${fail} outside` };
  const ask = checks.filter((c) => c.state === 'ask').length;
  return ask ? { tone: 'gold', text: ask === 1 ? '1 asks you' : `${ask} ask you` } : null;
}

// ---- what happened ----------------------------------------------------------------------------------

export type ThreadRow = TimelineRow | { kind: 'event'; key: string; text: string };

/**
 * The thread, oldest first, newest at the bottom: the deal's creation, the signed messages, then
 * what exists at PayPal (only from the ids the deal holds, never with an invented time), and
 * last the deal's current state.
 */
export function threadRows(steps: readonly TranscriptStep[], d: Pick<Deal, 'created_at' | 'updated_at' | 'state' | 'paypal'> & Partial<Pick<Deal, 'kind' | 'side'>>): ThreadRow[] {
  const all = timelineRows(steps, d).reverse();
  const now = all.filter((r) => r.kind === 'ledger' && r.key === 'updated');
  const rest = all.filter((r) => !(r.kind === 'ledger' && r.key === 'updated'));
  const sellerSays = d.kind === 'haggle' && d.side === 'buyer';
  const events: ThreadRow[] = [];
  if (d.paypal.order) events.push({ kind: 'event', key: 'pp-order', text: 'PayPal order created' });
  if (d.paypal.authorization) events.push({ kind: 'event', key: 'pp-hold', text: 'Money put on hold at PayPal' });
  if (d.paypal.capture) events.push({ kind: 'event', key: 'pp-pay', text: sellerSays ? 'The seller reports the payment' : 'Payment recorded at PayPal' });
  return [...rest, ...events, ...now];
}

export type Fact = { k: string; v: string; tone?: 'ok' | 'gold' | 'red' | 'dim' };

/** The right-hand "where it stands" facts: numbers only, from the signed terms and the band. */
export function standingFacts(d: Pick<Deal, 'kind' | 'side' | 'terms' | 'market'>, band: DisplayBand | null, latest: TranscriptStep | null, them: string, offer?: RescueOffer | null): Fact[] {
  const out: Fact[] = [];
  if (d.kind === 'rescue' && offer) {
    // The same two figures as Rescue and the approval window: what failed, and what the fix invoices.
    out.push({ k: 'Renewal that failed', v: formatMoney(offer.cycle) });
    out.push({ k: 'This fix invoices', v: formatMoney(offer.invoice) });
    out.push({ k: 'Discount', v: `${percentWords(offer.discount_bp)} off this cycle only` });
  } else if (d.kind === 'haggle') {
    if (latest?.price) out.push({ k: latest.by === 'them' ? `${them}’s latest` : 'Your latest', v: formatMoney(latest.price) });
    const limit = band ? (d.side === 'buyer' ? band.ceiling : band.floor) : null;
    if (limit) out.push({ k: d.side === 'buyer' ? 'Most you’ll pay' : 'Least you’ll accept', v: formatMoney(limit) });
    if (band) out.push({ k: 'Offers used', v: `${band.rounds_used} of ${band.max_rounds}` });
  } else {
    out.push({ k: d.terms.qty > 1 ? 'Price each' : 'Price', v: formatMoney(d.terms.unit_price) });
    if (d.terms.qty > 1) out.push({ k: 'Quantity', v: String(d.terms.qty) });
  }
  const m = d.market;
  if (m && m.median.currency === d.terms.unit_price.currency) {
    const mw = marketWords(d.terms.unit_price.minor, m.p25.minor, m.median.minor, m.p75.minor);
    out.push({ k: 'Typical price', v: `${formatMoney(m.p25)} – ${formatMoney(m.p75)}` });
    out.push({ k: 'This price is', v: mw.text, tone: mw.tone === 'ok' ? 'ok' : mw.tone === 'gold' ? 'gold' : mw.tone === 'red' ? 'red' : undefined });
  }
  return out;
}

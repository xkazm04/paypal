// Display derivations for the approval card. Pure functions over Rust-owned data: they decide
// what to SAY, never what is allowed (that is gating.ts, which only narrows Rust's flags).
import type { ApprovalCheck } from '@bindings/ApprovalCheck';
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import type { Clause } from '@bindings/Clause';
import type { Currency } from '@bindings/Currency';
import type { Deal } from '@bindings/Deal';
import type { DealKind } from '@bindings/DealKind';
import type { DealState } from '@bindings/DealState';
import type { Side } from '@bindings/Side';
import type { Delivery } from '@bindings/Delivery';
import type { MarketRef } from '@bindings/MarketRef';
import type { Money } from '@bindings/Money';
import type { OpenMandate } from '@bindings/OpenMandate';
import { exponent, formatMinor, formatMoney, lineTotal } from '../../lib/format';
import { ruleSentence, stateWord as plainState } from '../../lib/words';
import { isTerminal } from './gating';

// ---------------------------------------------------------------------------------------------
// money input (owner-typed amounts for band and mandate clauses) - exact, no floats

/** "340", "340.5", "1,200.00" → minor units for the currency; null when not a valid amount. */
export function parseMoneyInput(text: string, currency: Currency): number | null {
  const t = text.trim().replace(/[,\s]/g, '').replace(/^[$€£]/, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const exp = exponent(currency);
  const [whole = '0', frac = ''] = t.split('.');
  if (frac.length > exp) return null;
  const minor = Number(whole + frac.padEnd(exp, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Minor units → the plain editable string ("340.00"), no symbol, no grouping. */
export function minorToInput(minor: number, currency: Currency): string {
  return formatMinor(minor, currency, { code: true }).replace(/,/g, '').replace(/\s[A-Z]{3}$/, '');
}

// ---------------------------------------------------------------------------------------------
// deal facts

export function dealTotal(deal: Deal): Money {
  return lineTotal(deal.terms.unit_price, deal.terms.qty);
}

/** Where a price sits in the retrieved market band, as a display-only percentile (p1..p99). */
export function marketPercentile(price: Money, m: MarketRef): number | null {
  if (price.currency !== m.p25.currency) return null;
  const v = price.minor;
  const [a, b, c] = [m.p25.minor, m.median.minor, m.p75.minor];
  let p: number;
  if (v <= b) p = b === a ? 50 : 25 + ((v - a) / (b - a)) * 25;
  else p = c === b ? 50 : 50 + ((v - b) / (c - b)) * 25;
  return Math.max(1, Math.min(99, Math.round(p)));
}

export function marketLine(deal: Deal): string {
  const m = deal.market;
  if (!m) return 'no market price for this item · the price check was skipped, not passed';
  const unit = deal.terms.unit_price;
  const pct = marketPercentile(unit, m);
  const range = `${formatMoney(m.p25)}–${formatMoney(m.p75)}`;
  const where = pct === null ? 'in another currency than' : `p${pct} of`;
  return `${formatMoney(unit)} is ${where} ${range} · median ${formatMoney(m.median)}${m.cached ? ' · cached' : ''}`;
}

export function deliveryText(d: Delivery): string {
  switch (d.type) {
    case 'digital_now': return 'digital, now';
    case 'ship_then_capture': return `ship then capture · ${d.days} d`;
    case 'pickup_local': return 'local pickup';
    case 'service_on_date': return `service on ${new Date(d.unix_day * 86400 * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  }
}

/** A deal state in plain words (lib/words.ts). */
export const stateWord = (s: DealState, ctx?: { side?: Side; kind?: DealKind }): string => plainState(s, ctx).text;

// ---------------------------------------------------------------------------------------------
// the checklist: composed by the wallet from the predicates that gate the decision. The window
// renders each line verbatim and never adds, drops or re-words one (READY = no line fails).

/** How many lines read each way, for the folded "N of M passed" line. */
export function checksTally(checks: readonly ApprovalCheck[]): { pass: number; fail: number; wait: number; total: number } {
  return {
    pass: checks.filter((c) => c.status === 'pass').length,
    fail: checks.filter((c) => c.status === 'fail').length,
    wait: checks.filter((c) => c.status === 'wait').length,
    total: checks.filter((c) => c.status !== 'not_applicable').length,
  };
}

// ---------------------------------------------------------------------------------------------
// phases and the state strip

export type Phase = 'checking' | 'ready' | 'locked' | 'in_browser' | 'waiting' | 'done' | 'hold' | 'block' | 'mismatch' | 'stopped';

export function derivePhase(summary: ApprovalSummary | undefined, o: { locked: boolean; inBrowser: boolean; revealed: boolean }): Phase {
  if (!summary || !o.revealed) return 'checking';
  const d = summary.deal;
  if (d.state === 'MISMATCH') return 'mismatch';
  if (d.shield === 'BLOCK') return 'block';
  if (d.state === 'RECEIPTED' || d.state === 'RECONCILED' || d.state === 'CAPTURED') return 'done';
  if (isTerminal(d.state)) return 'stopped';
  if (d.shield === 'HOLD') return 'hold';
  if (o.inBrowser && d.state === 'AWAITING_APPROVAL') return 'in_browser';
  if (o.locked) return 'locked';
  if (d.state === 'SETTLING' || (d.side === 'buyer' && d.kind !== 'purchase' && (d.state === 'APPROVED' || d.state === 'AGREED'))) return 'waiting';
  if (d.side === 'seller' && (d.state === 'AWAITING_APPROVAL' || d.state === 'APPROVED')) return 'waiting';
  return 'ready';
}

export type Step = { label: string; status: 'done' | 'cur' | 'todo' | 'bad' | 'ok' };

/** Step names on the approval path, in plain words. `browser` marks the in-browser wait. */
export const STEP = {
  checking: 'Checking', ready: 'Ready for you', locked: 'Locked', yours: 'Your approval', youApproved: 'You approved',
  browser: 'On PayPal', approved: 'Approved on PayPal', held: 'On hold', paid: 'Paid', sellerPaid: 'Seller says paid',
  receipt: 'Receipt saved', buyer: 'Buyer approves', terms: 'Agreed terms', blocked: 'Blocked', paused: 'Paused for you',
  fix: 'Fix approved', recovered: 'Recovered', invoiceSent: 'Invoice sent', subscriberPaid: 'Subscriber paid',
} as const;

const PRE: ReadonlySet<DealState> = new Set<DealState>(['PAIRING', 'LISTED', 'NEGOTIATING', 'AGREED', 'SETTLING']);

export function buildStrip(summary: ApprovalSummary | undefined, phase: Phase, locked: boolean): Step[] {
  if (!summary) return [STEP.checking, STEP.ready, STEP.browser, STEP.approved, STEP.receipt].map((label, i) => ({ label, status: i === 0 ? 'cur' : 'todo' }));
  const d = summary.deal;
  const s = d.state;
  if (phase === 'mismatch' || phase === 'stopped' || phase === 'block') {
    const end = phase === 'block' ? STEP.blocked : stateWord(s, d);
    return [{ label: STEP.checking, status: 'done' }, { label: STEP.terms, status: 'done' }, { label: end, status: 'bad' }];
  }
  if (d.kind === 'rescue') {
    // Checking · your approval · invoice with the subscriber · paid (counted only when PayPal shows it).
    const labels = [STEP.checking, s === 'AGREED' ? (locked ? STEP.locked : STEP.ready) : STEP.fix, STEP.invoiceSent, STEP.subscriberPaid];
    const at = s === 'AGREED' ? 1 : s === 'SETTLING' || s === 'AWAITING_APPROVAL' ? 2 : 3;
    return labels.map((label, i) => ({ label, status: i < at ? 'done' : i === at ? (i === labels.length - 1 ? 'ok' : 'cur') : 'todo' }));
  }
  const ready = locked ? STEP.locked : STEP.ready;
  let labels: string[];
  let at: number;
  if (d.side === 'seller') {
    labels = [STEP.checking, s === 'AGREED' ? (locked ? STEP.locked : STEP.yours) : STEP.youApproved, STEP.buyer, STEP.held, STEP.paid, STEP.receipt];
    at = PRE.has(s) && s !== 'SETTLING' ? 1 : s === 'SETTLING' || s === 'AWAITING_APPROVAL' || s === 'APPROVED' ? 2 : s === 'AUTHORIZED' ? 3 : s === 'CAPTURED' ? 4 : 5;
    if (PRE.has(s) && s !== 'AGREED') labels[1] = stateWord(s, d);
  } else {
    const purchase = d.kind === 'purchase';
    labels = [STEP.checking, ready, STEP.browser, STEP.approved, purchase ? STEP.held : STEP.sellerPaid, purchase ? STEP.paid : STEP.receipt];
    if (PRE.has(s)) {
      at = 1;
      labels[1] =
        purchase && s === 'AGREED'
          ? locked ? STEP.locked : STEP.yours
          : !purchase && s === 'NEGOTIATING' && summary.can_owner_accept === true
            ? locked ? STEP.locked : STEP.yours
            : stateWord(s, d);
    } else if (s === 'AWAITING_APPROVAL') at = phase === 'in_browser' ? 2 : 1;
    else if (s === 'APPROVED') at = 3;
    else if (s === 'AUTHORIZED') at = purchase ? 4 : 3;
    else if (s === 'CAPTURED') at = purchase ? 5 : 4;
    else at = 5;
    if (!purchase && at < 5 && summary.evidence.receipt === 'SELLER_ATTESTED') at = 4;
  }
  if (phase === 'hold') labels[1] = STEP.paused;
  return labels.map((label, i) => ({
    label,
    status: i < at ? 'done' : i === at ? (phase === 'hold' ? 'bad' : i === labels.length - 1 ? 'ok' : 'cur') : 'todo',
  }));
}

// ---------------------------------------------------------------------------------------------
// mandate clauses in owner words

/** One rule as a short sentence (lib/words.ts). */
export const clauseText = (c: Clause): string => ruleSentence(c);

export function isMandateActive(m: OpenMandate, now: number): boolean {
  return m.payload.not_before <= now && m.payload.expires > now;
}

// ---------------------------------------------------------------------------------------------
// what the window says right after the owner decides

export type DecisionCmd = 'deal_owner_accept' | 'deal_countersign' | 'deal_capture' | 'deal_void' | 'shield_release' | 'rescue_approve';

export function outcomeText(cmd: DecisionCmd, deal: Deal, cp: string): string {
  const st = stateWord(deal.state, deal);
  const pp = deal.paypal;
  switch (cmd) {
    case 'deal_owner_accept':
      return deal.state === 'AGREED'
        ? `Approved. You and ${cp} agreed ${formatMoney(dealTotal(deal))}. No money moved. Paying opens here once their payment request is checked.`
        : `Your approval is recorded (${st.toLowerCase()}). No money moved; the deal is agreed once ${cp}’s wallet answers.`;
    case 'deal_countersign':
      return deal.state === 'AUTHORIZED'
        ? 'Approved. The money is on hold at PayPal, not paid yet.'
        : `Approved (${st.toLowerCase()})${pp.order ? ' · the PayPal order is made' : ''}. No money moved yet.`;
    case 'deal_capture':
      // A buyer pays out; a seller collects money that comes in.
      return deal.side === 'seller'
        ? `Payment collected · ${st.toLowerCase()}${pp.capture ? ' · confirmed by PayPal' : ''}.`
        : `Payment sent · ${st.toLowerCase()}${pp.capture ? ' · confirmed by PayPal' : ''}.`;
    case 'deal_void':
      return deal.state === 'VOIDED' ? 'Hold released. Nothing was paid.' : `Release requested (${st.toLowerCase()}).`;
    case 'shield_release':
      return `Unpaused (${deal.shield === 'ASK' ? 'now checks with you' : st.toLowerCase()}). Nothing was paid.`;
    case 'rescue_approve':
      return deal.state === 'AWAITING_APPROVAL'
        ? 'Approved. PayPal sent the invoice to the subscriber. Nothing is paid until they pay it.'
        : `Approved. PayPal is making the invoice (${st.toLowerCase()}); nothing more is sent until the wallet knows it was made.`;
  }
}

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
import type { MarketRef } from '@bindings/MarketRef';
import type { Money } from '@bindings/Money';
import type { OpenMandate } from '@bindings/OpenMandate';
import { exponent, formatMinor, formatMoney, lineTotal } from '../../lib/format';
import { CHECK_FAILED, REACHED_PAYPAL, ruleSentence, stateWord as plainState, STEP_NOT_CONFIRMED, SUMMARY_CHANGED, VOID_REACHED_PAYPAL } from '../../lib/words';
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

/** The message DealReview gives its own INVALID when the counter has not arrived. */
export const OFFER_NOT_HERE = 'their latest offer hasn’t arrived yet';

/** A refusal of a decision (decide, open PayPal, withdraw) in plain words. Every one says nothing moved,
 *  except the three wallet sentences about a PayPal step that is not confirmed (REACHED_PAYPAL,
 *  VOID_REACHED_PAYPAL, STEP_NOT_CONFIRMED): they never say nothing was done.
 *  Five wallet sentences pass through unchanged (those three, SUMMARY_CHANGED and CHECK_FAILED);
 *  the rest are replaced (the code chip still shows). */
export function refusalText(error: { code: string; message: string }): string {
  if (error.message === SUMMARY_CHANGED || error.message === CHECK_FAILED || reachedPaypal(error)) return error.message;
  switch (error.code) {
    case 'LOCKED':
      return 'The wallet is locked, so nothing was done. Unlock it with Windows Hello, then try again.';
    case 'PERMISSION':
      return 'This window isn’t allowed to do that right now, so nothing was done.';
    case 'UNSUPPORTED':
      return 'Windows Hello isn’t set up on this computer, so nothing was done.';
    case 'UNAVAILABLE':
      return 'The wallet couldn’t be reached, so nothing was done. Try again in a moment.';
    case 'NOT_FOUND':
      return 'The wallet can’t find this deal any more, so nothing was done.';
    case 'LEDGER_TRUST':
      return 'The wallet’s records failed a safety check, so nothing was done.';
    case 'INVALID':
      return error.message === OFFER_NOT_HERE
        ? 'Their latest offer hasn’t arrived yet, so nothing was done.'
        : 'This request is out of date, so nothing was done. Look at the deal again.';
    default:
      return 'The wallet refused this, so nothing was done.';
  }
}

/** The wallet's own text never reaches the footer notices: per code, plain words and a remedy that is true.
 *  Reading a deal, getting this window's permission to approve, and unlocking each fail in their own way. */
export type FooterNotice = 'read' | 'token' | 'unlock' | 'pairing' | 'pairing_read';

export function footerNoticeText(kind: FooterNotice, error: { code: string }): string {
  switch (kind) {
    case 'read':
      switch (error.code) {
        case 'LOCKED':
          return 'The wallet is locked, so this deal can’t be shown yet. Unlock it with Windows Hello.';
        case 'NOT_FOUND':
          return 'The wallet can’t find this deal any more.';
        case 'LEDGER_TRUST':
          return 'The wallet’s records failed a safety check, so this deal isn’t shown.';
        case 'PERMISSION':
          return 'This window isn’t allowed to read this deal right now. Close it and open the deal again.';
        default:
          return 'The wallet couldn’t read this deal yet. Close this window and open the deal again.';
      }
    case 'token':
      switch (error.code) {
        case 'UNAVAILABLE':
          return 'The wallet couldn’t be reached, so this window can’t approve anything yet. Money stays where it is. Close this window and open it again.';
        case 'PERMISSION':
          return 'This window isn’t allowed to approve right now. Money stays where it is.';
        default:
          return 'This window can’t approve anything right now. Money stays where it is. Close this window and open it again.';
      }
    case 'pairing':
      // The codes pairing_confirm returns (table-runtime pairing.rs): INVALID (no such waiting connection,
      // the words differ, it lapsed, or the name is unusable), PERMISSION (this key is already known and
      // does not match), NOT_FOUND and LEDGER_TRUST (the wallet's records), and the gate's LOCKED and UNAVAILABLE.
      switch (error.code) {
        case 'INVALID':
          return 'This connection can’t be made any more: it lapsed or no longer matches. Nothing is connected. Start again in The Table.';
        case 'NOT_FOUND':
          return 'The wallet can’t find this waiting connection any more. Nothing is connected.';
        case 'PERMISSION':
          return 'This agent doesn’t match the one the wallet already knows, so nothing is connected.';
        case 'LOCKED':
          return 'The wallet is locked, so nothing is connected. Unlock it with Windows Hello, then confirm again.';
        case 'UNAVAILABLE':
          return 'The wallet couldn’t be reached, so nothing is connected. Try again in a moment.';
        case 'LEDGER_TRUST':
          return 'The wallet’s records failed a safety check, so nothing is connected.';
        default:
          return 'The wallet refused this, so nothing is connected.';
      }
    case 'pairing_read':
      // The codes approval_pairing can return (dispatcher.rs allowed(): PERMISSION; actor.rs execute_local:
      // UNAVAILABLE when the wallet has stopped, INVALID when its answer can't be read). It needs no unlock.
      switch (error.code) {
        case 'PERMISSION':
          return 'This window isn’t allowed to look for a waiting connection right now. Nothing is connected. Close it and open the connection again from The Table.';
        case 'UNAVAILABLE':
          return 'The wallet couldn’t be reached, so a waiting connection can’t be shown yet. Nothing is connected. Close this window and open it again.';
        default:
          return 'A waiting connection couldn’t be read yet. Nothing is connected. Close this window and open the connection again from The Table.';
      }
    case 'unlock':
      switch (error.code) {
        case 'UNSUPPORTED':
          return 'Windows Hello isn’t set up on this computer, so the wallet stays locked.';
        case 'UNAVAILABLE':
          return 'Windows Hello isn’t ready right now, so the wallet stays locked. Unlock again in a moment.';
        case 'PERMISSION':
          return 'Windows Hello didn’t confirm it was you, so the wallet stays locked. Unlock again when you’re ready.';
        default:
          return 'The wallet stays locked. Unlock it again with Windows Hello.';
      }
  }
}

/** The unlock heading names no cause: the wallet reports a cancel, a failed scan and a timeout alike
 *  (PERMISSION "did not verify"), so nothing tells a cancel apart. */
export const UNLOCK_HEADING = 'Still locked';

/** Whether a decision's failure is one of the wallet's "a PayPal step is not confirmed" answers:
 *  that this step may have reached PayPal, or that an earlier step is still open and this one was not sent. */
export const reachedPaypal = (error: { message: string }): boolean =>
  error.message === REACHED_PAYPAL || error.message === VOID_REACHED_PAYPAL || error.message === STEP_NOT_CONFIRMED;

/** The heading of a decision that reached PayPal and is not confirmed: true for the step, never "Not paid".
 *  When the answer is that an earlier step is open, the heading names no step: whatever is open, this one was not sent. */
export function unconfirmedHeading(cmd: DecisionCmd, deal: Pick<Deal, 'side' | 'state'>, error?: { message: string }): string {
  if (error?.message === STEP_NOT_CONFIRMED) return 'Not sent: an earlier step isn’t confirmed yet';
  switch (cmd) {
    case 'deal_capture':
      return deal.side === 'seller' ? 'Collection not confirmed yet' : 'Payment not confirmed yet';
    case 'deal_countersign':
      return deal.state === 'APPROVED' ? 'Hold not confirmed yet' : 'Order not confirmed yet';
    case 'rescue_approve':
      return 'Sending the fix isn’t confirmed yet';
    case 'deal_void':
      return 'Release not confirmed yet';
    default:
      return 'Not confirmed yet';
  }
}

/** Whether a failure notice still shows. An unconfirmed step shows only while the refetched deal is
 *  still in the state the decision started from; once the deal moved, the window's own sentence stands. */
export function failureShown(failure: { error: { message: string }; from: string | null }, state: string): boolean {
  return !reachedPaypal(failure.error) || failure.from === state;
}

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
        ? `Collected ${formatMoney(dealTotal(deal))} · ${st.toLowerCase()}${pp.capture ? ' · confirmed by PayPal' : ''}.`
        : `Paid ${formatMoney(dealTotal(deal))} to ${cp} · ${st.toLowerCase()}${pp.capture ? ' · confirmed by PayPal' : ''}.`;
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

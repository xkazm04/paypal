// The one plain sentence under the approval title ("what exactly am I approving, and is it safe?"),
// and the mapping from The Diff's rows onto the checks summary. Pure and display-only: nothing
// here decides what is allowed (gating.ts) or what a row reads (diff.ts); it only chooses words
// from facts the wallet already reported. A sentence never promises more than the facts say:
// an amount that was not compared is said to be uncompared, never "matching".
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import type { Deal } from '@bindings/Deal';
import type { Money } from '@bindings/Money';
import { formatMoney } from '../../../lib/format';
import { percentWords, reconWord, receiptWord, stateWord } from '../../../lib/words';
import type { CheckState, IconName, StoryTone } from '../../../shared/ui';
import type { Phase } from '../model';
import type { DiffKind, DiffRow, Twin } from './diff';

/** What the window is asking the owner to do, from which controls exist (gating.ts decides if they work). */
export type Intent = 'accept' | 'countersign' | 'open' | 'capture' | 'release' | 'rescue' | null;

export type Says = { tone: StoryTone; icon: IconName; text: string; sub?: string };

export type SaysInput = {
  kind: DiffKind;
  phase: Phase;
  deal: Deal;
  summary: ApprovalSummary;
  /** The short counterparty name ("Dan"). */
  who: string;
  /** The signed total, formatted ("$329.00"). */
  total: string;
  /** The amount the seller's signed payment request asked for, when the transcript carries it. */
  settle: Money | null;
  twin: Twin;
  act: Intent;
  /** The owner pressed "Open PayPal" in this window. */
  inBrowser?: boolean;
};

// ---- sentences for the phases that have no decision --------------------------------------------

export function waitingText(d: Deal, cp: string): string {
  if (d.kind === 'rescue') {
    if (d.state === 'SETTLING') return 'PayPal is making and sending the invoice you approved. Nothing is paid until the subscriber pays it.';
    return d.mode === 'replay'
      ? 'The invoice is with the subscriber. Nothing is charged unless they pay it, and this replayed failure is never counted as recovered.'
      : 'The invoice is with the subscriber. Nothing is charged unless they pay it; it counts as recovered once PayPal shows it paid.';
  }
  if (d.state === 'AGREED') return `Agreed. ${cp}’s wallet now makes the PayPal order; paying opens here once the wallet has checked it. No money has moved.`;
  if (d.state === 'SETTLING') return `${cp}’s wallet is making the PayPal order. Paying opens here once the wallet has checked it.`;
  if (d.side === 'seller' && d.state === 'AWAITING_APPROVAL') return `The order is ready. ${cp} approves it on PayPal’s page, and the wallet checks with PayPal. No money has moved.`;
  if (d.side === 'seller' && d.state === 'APPROVED') return 'PayPal says the buyer approved. Putting the money on hold is next, and needs your approval.';
  return `PayPal itself confirms you approved. ${cp}’s wallet now collects the payment; nothing is final until their signed receipt arrives.`;
}

export function stoppedText(d: Deal): string {
  switch (d.state) {
    case 'WITHDRAWN': return 'Withdrawn. No money moved.';
    case 'EXPIRED': return 'Expired. The deadline passed and no money moved.';
    case 'REFUSED': return 'Refused by your rules. No money moved.';
    case 'VOIDED': return 'Hold released. Nothing was paid.';
    case 'AUTO_VOIDED': return 'The hold ran out after 3 days and released itself. Nothing was paid.';
    case 'FAILED': return d.kind === 'rescue' ? 'The invoice was cancelled at PayPal. Nothing was recovered.' : 'Failed. The wallet stopped this deal; no money moved from this window.';
    case 'REFUNDED': return 'Refunded on PayPal.';
    case 'DISPUTED': return 'Disputed on PayPal. The proof is in The Table.';
    default: return `${stateWord(d.state, d).text}.`;
  }
}

function evidenceSub(s: ApprovalSummary): string {
  const ev = s.evidence;
  const parts = [receiptWord(ev.receipt).text, ev.reconciliation === 'not_applicable' ? '' : reconWord(ev.reconciliation).text.toLowerCase()].filter(Boolean);
  return `${parts.join(' · ')}. Reference numbers are under Details.`;
}

// ---- the summary sentence ---------------------------------------------------------------------

export function summarySentence(i: SaysInput): Says {
  const { kind, phase, deal: d, who, total, settle, twin } = i;
  // While locked Rust withholds "can accept", but the question on the table is the same: the owner
  // is being asked to accept this offer, and unlocking is what is missing.
  const act: Intent = i.act ?? (kind === 'accept' ? 'accept' : null);

  if (phase === 'mismatch') {
    return {
      tone: 'alert', icon: 'block',
      text: settle ? `${who} asked ${formatMoney(settle)} instead of the agreed ${total}. Nothing can be paid.` : `${who}’s payment request doesn’t match the ${total} you agreed. Nothing can be paid.`,
    };
  }
  if (phase === 'block') {
    return { tone: 'alert', icon: 'block', text: `A scam check blocked this payment to ${who}. It can’t be released, and no money moved.` };
  }
  if (phase === 'hold') {
    return {
      tone: 'need', icon: 'pause',
      text: `A scam check paused a ${total} payment to ${who} before PayPal was asked. Unpausing doesn’t pay anything; it only lets the request go on.`,
    };
  }
  if (phase === 'in_browser') {
    return { tone: 'calm', icon: 'link', text: `PayPal is open in your browser. Approve ${total} there; this window is watching and updates by itself.` };
  }
  if (phase === 'waiting' && act !== 'rescue') return { tone: 'calm', icon: 'clock', text: waitingText(d, who) };
  if (phase === 'done') {
    if (d.kind === 'rescue') {
      const counted = i.summary.rescue?.counted === true;
      return { tone: 'done', icon: 'check', text: `The subscriber paid the ${total} invoice.`, sub: counted ? 'PayPal shows it paid and the receipt is saved, so it counts as money you got back.' : d.mode === 'replay' ? 'This failure was replayed, so it is never counted as money you got back.' : evidenceSub(i.summary) };
    }
    if (d.side === 'seller') return { tone: 'done', icon: 'check', text: `You collected ${total} from ${who}.`, sub: evidenceSub(i.summary) };
    // Only PayPal's own confirmation says "paid"; a seller's word alone is reported as theirs.
    if (i.summary.evidence.receipt !== 'PAYPAL_VERIFIED') {
      return { tone: 'calm', icon: 'clock', text: `${who} says the ${total} was paid. Your own proof from PayPal is still on its way.`, sub: evidenceSub(i.summary) };
    }
    return { tone: 'done', icon: 'check', text: `Paid ${who} ${total}. PayPal confirmed it.`, sub: evidenceSub(i.summary) };
  }
  if (phase === 'stopped') {
    return { tone: d.state === 'REFUSED' || d.state === 'FAILED' || d.state === 'DISPUTED' ? 'alert' : 'calm', icon: d.state === 'REFUSED' || d.state === 'FAILED' || d.state === 'DISPUTED' ? 'alert' : 'check', text: stoppedText(d) };
  }

  // READY or LOCKED: the decision the owner is being asked for, said as people and money.
  switch (act) {
    case 'accept': {
      const limit = twin.left.v;
      const inside = twin.op === '≥';
      const over = twin.op === '<';
      const range = limit ? (inside ? `, inside your ${limit} limit` : over ? `, above your ${limit} limit` : '') : '';
      return {
        tone: 'need', icon: 'you',
        text: `${who} offers ${total}${range}. Approving accepts that price; you pay later on PayPal.`,
        ...(over ? { sub: 'This is above the most you said you’d pay, so look closely before you accept.' } : {}),
      };
    }
    case 'open': {
      if (twin.op === '=') return { tone: 'need', icon: 'you', text: `${who}’s payment request matches the ${total} you agreed. Next you approve it on PayPal’s own page; nothing is paid before that.` };
      if (twin.op === '≠') return { tone: 'alert', icon: 'alert', text: `${who}’s request differs from the ${total} you agreed, so PayPal won’t open.` };
      return { tone: 'need', icon: 'you', text: `${who} asks for ${total}. This window hasn’t compared it with your deal yet. Nothing is paid until you approve on PayPal.`, sub: i.summary.locked ? 'Unlock to check it.' : undefined };
    }
    case 'capture':
      return d.side === 'seller'
        ? { tone: 'need', icon: 'hold', text: `Collect ${total} from the payment ${who} has on hold. Releasing cancels the hold and nothing is collected.` }
        : { tone: 'need', icon: 'hold', text: `Pay ${who} ${total} now from the money on hold. Releasing cancels the hold and nothing is paid.` };
    case 'countersign':
      return d.state === 'APPROVED'
        ? { tone: 'need', icon: 'you', text: `${who} approved ${total} on PayPal. Approving puts the money on hold; collecting it is a separate step.` }
        : { tone: 'need', icon: 'you', text: `You and ${who} agreed ${total}. Approving creates the PayPal order; ${d.side === 'seller' ? 'no money moves until they approve it on PayPal.' : 'no money moves yet.'}` };
    case 'rescue': {
      const o = i.summary.rescue?.offer;
      const fix = o ? `${percentWords(o.discount_bp)} off this cycle’s ${formatMoney(o.cycle)}` : 'a discount on this cycle';
      return d.mode === 'replay'
        ? { tone: 'need', icon: 'renew', text: `Approving sends one ${total} PayPal invoice, ${fix}. The failure is a replay, so what it brings in is never counted.` }
        : { tone: 'need', icon: 'renew', text: `Approving sends one ${total} PayPal invoice to this subscriber, ${fix}. Nothing is charged until they pay it.` };
    }
    case 'release':
      return { tone: 'need', icon: 'pause', text: `Unpausing lets ${who}’s ${total} request go on. It doesn’t pay anything.` };
    default:
      return { tone: 'calm', icon: 'check', text: 'Nothing needs your decision here right now.', sub: `${who} · ${total}` };
  }
}

// ---- diff rows → checks ------------------------------------------------------------------------

/** Words on a row that mean "this is your call", not a pass and not a failure. */
const ASKS = new Set(['asks you', 'your call', 'so you’re asked', 'paused']);

/** How a Diff row reads in the checks summary. Unknown stays unknown, never a pass. */
export function checkStateOf(r: Pick<DiffRow, 'rel' | 'tone' | 'word'>): CheckState {
  if (r.rel === '?') return 'unknown';
  switch (r.tone) {
    case 'ok': return 'pass';
    case 'bad': return 'fail';
    case 'hold': return 'ask';
    case 'wait': return 'unknown';
    case 'info': return r.rel === '∉' || (r.word !== undefined && ASKS.has(r.word)) ? 'ask' : 'unknown';
  }
}

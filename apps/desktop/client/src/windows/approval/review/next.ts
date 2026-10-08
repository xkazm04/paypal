// "What happens next" (docs/ux/ROUND-2.md; approved and permanent): the two or three steps that follow
// the decision the window is asking for, as people and money. Pure and display-only: it reads the
// deal kind, side, state and the controls that exist, and it only says what the existing state
// machine does (model.ts buildStrip, says.ts, the notes in DealReview). It never promises a result:
// a step that depends on someone else is worded as theirs ("Dan's wallet sends ...").
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import type { Deal } from '@bindings/Deal';
import type { Phase } from '../model';
import type { DiffKind } from './diff';
import type { Intent } from './says';

/** Who does the step: you (teal), the other side (coral), PayPal or your wallet (neutral), or a stop (red). */
export type NextBy = 'you' | 'them' | 'paypal' | 'wallet' | 'stop';
export type NextStep = { text: string; by: NextBy; /** The step the window is on right now. */ now?: boolean };

export type NextInput = {
  kind: DiffKind;
  phase: Phase;
  deal: Deal;
  summary: Pick<ApprovalSummary, 'can_release' | 'unavailable_reason'>;
  /** The short counterparty name ("Dan"). */
  who: string;
  /** The signed total, formatted ("$329.00"). */
  total: string;
  /** Which control exists (gating decides whether it works). */
  act: Intent;
};

const you = (text: string, now?: boolean): NextStep => ({ text, by: 'you', ...(now ? { now } : {}) });
const them = (text: string, now?: boolean): NextStep => ({ text, by: 'them', ...(now ? { now } : {}) });
const paypal = (text: string, now?: boolean): NextStep => ({ text, by: 'paypal', ...(now ? { now } : {}) });
const wallet = (text: string, now?: boolean): NextStep => ({ text, by: 'wallet', ...(now ? { now } : {}) });
const stop = (text: string): NextStep => ({ text, by: 'stop' });

/** The path after this decision, or null when there is nothing left to decide or nothing to promise. */
export function nextSteps(i: NextInput): NextStep[] | null {
  const { kind, phase, deal: d, who, total } = i;
  // Same rule as the answer sentence: while locked Rust withholds "can accept", the question is unchanged.
  const act: Intent = i.act ?? (kind === 'accept' ? 'accept' : null);
  const purchase = d.kind === 'purchase';

  if (phase === 'checking' || phase === 'done' || phase === 'stopped') return null;

  // A mismatch is a terminal state: the only honest "next" is that nothing moves (the answer above says why).
  if (phase === 'mismatch') return [stop('No money moved'), stop('This deal stays stopped'), wallet('A different price takes a new agreed deal')];
  if (phase === 'block') return [stop('A blocked payment can’t be released'), stop('No money moved')];

  if (phase === 'hold') {
    return [you('You unpause it here', true), wallet('It becomes “Check with you”'), you('You still approve the payment itself')];
  }

  if (phase === 'in_browser') {
    return [
      you(`You approve ${total} on PayPal’s page`, true),
      wallet('The wallet asks PayPal that you did'),
      purchase ? you('You put it on hold here') : them(`${who}’s wallet collects the payment`),
    ];
  }

  if (phase === 'ready' || phase === 'locked' || (phase === 'waiting' && act !== null)) {
    switch (act) {
      case 'accept':
        return [you('You approve the price here', true), them(`${who}’s wallet sends a payment request`), you('You pay on PayPal')];
      case 'open':
        return purchase
          ? [you(`You approve ${total} on PayPal`, true), you('You put it on hold here'), you('You pay, or release the hold')]
          : [you(`You approve ${total} on PayPal`, true), them(`${who}’s wallet collects the payment`), wallet('Receipt saved')];
      case 'capture':
        return d.side === 'seller'
          ? [you(`You collect ${total} here`, true), paypal(`PayPal pays you ${total}`), wallet('Receipt saved')]
          : [you('You pay here', true), them(`${who} gets ${total}`), wallet('Receipt saved')];
      case 'countersign':
        if (d.state === 'APPROVED') {
          return [you('You approve here', true), paypal(`The ${total} goes on hold at PayPal`), you(d.side === 'seller' ? 'You collect it, as its own step' : 'You pay, or release the hold')];
        }
        return [you('You approve here', true), paypal('The PayPal order is created'), d.side === 'seller' ? them(`${who} approves it on PayPal`) : you('You approve it on PayPal')];
      case 'rescue':
        if (i.summary.unavailable_reason) return [you('You approve the fix here', true), wallet('The invoice can’t be sent right now'), wallet('Nothing is invoiced')];
        return [you('You approve the fix here', true), paypal(`One ${total} invoice goes to the subscriber`),
          wallet(d.mode === 'replay' ? 'Never counted: a replayed failure' : 'Counted once PayPal shows it paid')];
      case 'release':
        return [you('You unpause it here', true), wallet('It becomes “Check with you”'), you('You still approve the payment itself')];
      default:
        return null;
    }
  }

  if (phase === 'waiting') {
    if (d.side === 'seller') {
      return d.state === 'AWAITING_APPROVAL'
        ? [them('The buyer approves on PayPal', true), you('You approve to put it on hold'), you('You collect it')]
        : [you('You approve to put it on hold', true), you('You collect it'), wallet('Receipt saved')];
    }
    if (d.state === 'AGREED' || d.state === 'SETTLING') {
      return [them(`${who}’s wallet makes the PayPal order`, true), you('You approve it on PayPal'), them('Their wallet collects the payment')];
    }
    return [them(`${who}’s wallet collects the payment`, true), wallet('Their signed receipt arrives'), wallet('Receipt saved')];
  }
  return null;
}

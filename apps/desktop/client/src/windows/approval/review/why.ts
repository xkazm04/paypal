// "Why?" answers for the approval window (docs/ux/ROUND-2.md, experiment r2-why): two sentences,
// written only from facts the window already shows (the Diff's rows, the deal, the rules). No
// model, no guess, no number that is not in the data. Where the wallet does not say, the answer says
// it does not say, rather than inventing a reason. Pure and display-only.
import type { Deal } from '@bindings/Deal';
import type { Money } from '@bindings/Money';
import type { OpenMandate } from '@bindings/OpenMandate';
import { formatMoney } from '../../../lib/format';
import { marketWords } from '../../../lib/words';
import type { CheckState } from '../../../shared/ui';
import type { Phase } from '../model';
import type { DiffKind, DiffRow, Twin } from './diff';
import type { Intent } from './says';

export type WhyAnswer = { question: string; lines: [string, string] };

/** The ask-me limit of a mandate (rule "Ask me above"), when it has one. */
export function askAboveOf(mandate: Pick<OpenMandate, 'payload'> | null | undefined): Money | null {
  const c = mandate?.payload.clauses.find((x) => x.type === 'human_present_over');
  return c && c.type === 'human_present_over' ? c.amount : null;
}

/** "well above typical" when the price is above the usual range, else null (a normal price explains nothing). */
export function highPriceWord(deal: Deal): string | null {
  const m = deal.market;
  const p = deal.terms.unit_price;
  if (!m || p.currency !== m.p25.currency) return null;
  const w = marketWords(p.minor, m.p25.minor, m.median.minor, m.p75.minor);
  return w.tone === 'gold' || w.tone === 'red' ? w.text : null;
}

export type WhyFacts = {
  phase: Phase;
  who: string;
  total: string;
  askAbove: Money | null;
  /** From highPriceWord(). */
  highPrice: string | null;
};

// ---- the answer sentence ------------------------------------------------------------------------

export type AnswerWhyInput = WhyFacts & {
  kind: DiffKind;
  act: Intent;
  deal: Deal;
  rows: readonly DiffRow[];
  twin: Twin;
  settle: Money | null;
  /** The wallet's own note on this deal (already in words), if any. */
  unavailable: string | null;
};

/** Why the window asks what it asks. Only for the phases that ask the owner for a decision (or stopped on an amount). */
export function answerWhy(i: AnswerWhyInput): WhyAnswer | null {
  const { who, total, phase, deal: d } = i;
  const act: Intent = i.act ?? (i.kind === 'accept' ? 'accept' : null);

  if (phase === 'mismatch') {
    return {
      question: 'Why can’t I pay this?',
      lines: [
        i.settle ? `${who}’s payment request asks for ${formatMoney(i.settle)}, but you agreed ${total}.` : `${who}’s payment request doesn’t match the ${total} you agreed.`,
        'So there is no pay button, and on purpose no “pay anyway”. A different price takes a new agreed deal.',
      ],
    };
  }
  if (phase === 'hold') {
    const seen: string[] = [];
    const payee = i.rows.find((r) => r.id === 'payees');
    if (payee && payee.rel === '∉') seen.push(`${who} isn’t on your approved payees`);
    if (i.highPrice) seen.push(`the price is ${i.highPrice}`);
    return {
      question: 'Why was this paused?',
      lines: [
        seen.length ? `The wallet doesn’t say which check paused it. What you can see: ${seen.join(' and ')}.` : 'The wallet doesn’t say which check paused it, and nothing else on this page explains it.',
        'Unpausing pays nothing: it turns “Paused for you” into “Check with you”, and you still approve the payment itself.',
      ],
    };
  }
  if (phase !== 'ready' && phase !== 'locked' && !(phase === 'waiting' && act !== null)) return null;

  switch (act) {
    case 'accept': {
      const present = i.rows.find((r) => r.id === 'present');
      const above = present?.rel === '>' && i.askAbove;
      return {
        question: 'Why am I being asked?',
        lines: [
          above ? `Your rules say you decide anything above ${formatMoney(i.askAbove as Money)}, and this ${total} is above that.` : `Your rules leave this price to you, not to the agent.`,
          'Approving only agrees the price: nothing is charged or held until you approve on PayPal’s own page.',
        ],
      };
    }
    case 'open': {
      const amount = i.rows.find((r) => r.id === 'amount');
      return {
        question: 'Why does PayPal open next?',
        lines: [
          'Nothing is paid in this window: you approve on PayPal’s own page, in your browser.',
          amount?.rel === '=' ? `The wallet checked that ${who}’s request matches the ${total} you agreed.` : `This window hasn’t compared ${who}’s request with your deal yet, so it checks again before any PayPal call.`,
        ],
      };
    }
    case 'capture':
      return d.side === 'seller'
        ? { question: 'Why collect now?', lines: [`PayPal is holding ${total} for you from ${who}, and it only moves if you collect it.`, 'If you release it, or nobody decides, the hold cancels and nothing is collected.'] }
        : { question: 'Why pay now?', lines: [`PayPal is holding ${total} for this purchase, and it only goes to ${who} if you pay.`, 'If you release it, or nobody decides, the hold cancels and nothing is paid.'] };
    case 'countersign':
      return d.state === 'APPROVED'
        ? { question: 'Why does this need me?', lines: ['PayPal says the buyer approved, and putting the money on hold needs your approval.', 'Collecting it is a separate step you decide on later.'] }
        : { question: 'Why does this need me?', lines: [`You and ${who} agreed ${total}; making the PayPal order from it needs your approval.`, d.side === 'seller' ? 'No money moves until they approve it on PayPal’s page.' : 'No money moves until you approve it on PayPal’s page.'] };
    case 'rescue':
      return {
        question: 'Why is this my call?',
        lines: [
          'A fix that invoices a subscriber only runs on your approval, never on an agent’s.',
          d.mode === 'replay' ? 'This is a replay, so approving runs recorded steps and invoices nothing real.' : i.unavailable ? i.unavailable : `Approving sends one ${total} PayPal invoice to this subscriber.`,
        ],
      };
    case 'release':
      return {
        question: 'Why was this paused?',
        lines: ['The wallet doesn’t say which check paused it.', 'Unpausing pays nothing: you still approve the payment itself afterwards.'],
      };
    default:
      return null;
  }
}

// ---- one check row ------------------------------------------------------------------------------

const NEVER_PASSED = 'Not checked here is never shown as passed.';

/** Why this check is an exception (asks you, stopped it, or could not be checked); null for a pass. */
export function rowWhy(row: DiffRow, state: CheckState, f: WhyFacts): WhyAnswer | null {
  if (state === 'pass') return null;
  const { who, total } = f;
  const unknown = state === 'unknown';

  switch (row.id) {
    case 'shield':
    case 'rule': {
      if (row.rel === '≠') return { question: 'Why was this blocked?', lines: ['A scam check blocked this payment.', 'A block can’t be overridden, here or anywhere, and no money moved.'] };
      if (row.rel === '!' || row.id === 'rule') {
        return {
          question: 'Why is the scam check paused?',
          lines: [
            'The scam check paused this payment before PayPal was asked.',
            f.phase === 'mismatch' ? 'The deal also stopped on the amount, so nothing can be paid either way.' : 'Unpausing pays nothing; it only lets the request go on to your own approval.',
          ],
        };
      }
      if (unknown) return { question: 'Why hasn’t the scam check run?', lines: ['The scam check hasn’t looked at this deal yet.', NEVER_PASSED] };
      return { question: 'Why does the scam check ask me?', lines: ['The scam check didn’t block this payment, but it leaves the final look to you.', 'Checks can only add caution, never remove it, so your review here is the check.'] };
    }
    case 'present': {
      const above = row.rel === '>' && f.askAbove;
      return {
        question: 'Why do my rules ask me?',
        lines: [
          above ? `Your rules say you decide anything above ${formatMoney(f.askAbove as Money)}, and this ${total} is above that.` : `This ${total} is under your ask-me limit, so the rule doesn’t force it.`,
          above ? 'That is why the agent stopped and asked you instead of agreeing by itself.' : 'You are still offered the decision here.',
        ],
      };
    }
    case 'payees':
      return {
        question: 'Why am I asked about this payee?',
        lines: [`${who} isn’t on your approved payees (${row.left}).`, 'Payees not on your list always come to you to decide.'],
      };
    case 'amount':
      if (row.rel === '≠') {
        return {
          question: 'Why did the amount stop this?',
          lines: [
            `You agreed ${total}, but ${row.right && row.right.startsWith('asked') ? `${who} ${row.right}` : `${who}’s request disagrees`}.`,
            'There is on purpose no “pay anyway”, and no money moved.',
          ],
        };
      }
      break;
    case 'mandate':
      if (row.tone === 'bad') {
        return row.word === 'ended' || row.word === 'expired'
          ? { question: 'Why did my rules stop this?', lines: [row.src, 'Nothing moves under rules that are no longer in force.'] }
          : { question: 'Why is this over my limit?', lines: [`Your rules allow ${row.left}, and this one is ${row.right ?? total}.`, 'It is checked against your rules before any PayPal call.'] };
      }
      break;
    case 'band':
      if (row.tone === 'bad') {
        return { question: 'Why is this above my price range?', lines: [`Your price range says ${row.left}, and their price is ${row.right ?? total}.`, 'Approving is still your call, so look closely before you accept.'] };
      }
      break;
    case 'cp':
      if (unknown) return { question: 'Why isn’t this wallet verified?', lines: [row.src, 'Only wallets you matched pairing words with show as verified.'] };
      break;
    default:
      break;
  }
  // Everything else: where the wallet got it, and what this state means. Never invented.
  const name = row.name.toLowerCase();
  const q = unknown ? `Why wasn’t “${name}” checked?` : state === 'fail' ? `Why did “${name}” stop this?` : `Why does “${name}” ask you?`;
  return { question: q, lines: [row.src, unknown ? NEVER_PASSED : 'Click its name to see where it comes from.'] };
}

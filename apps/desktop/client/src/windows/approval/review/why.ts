// "Why?" answers for the approval window (docs/ux/ROUND-2.md, experiment r2-why): two sentences,
// written only from facts the window already shows (the Diff's rows, the deal, the rules). No
// model, no guess, no number that is not in the data. Where the wallet does not say, the answer says
// it does not say, rather than inventing a reason. Pure and display-only.
import type { Deal } from '@bindings/Deal';
import type { Money } from '@bindings/Money';
import type { OpenMandate } from '@bindings/OpenMandate';
import { formatMoney } from '../../../lib/format';
import { marketWords } from '../../../lib/words';
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
  /** The rule that decided the scam check's verdict, in plain words (Deal.shield_rule from the
   *  wallet core, worded by shieldRuleWord); null when none is recorded. */
  shieldRule?: string | null;
};

/** Why an offer is the owner's to accept, as the wallet's ask-me rule decides it: the rule asks only
 *  when the total is strictly above its limit (table-core mandate.rs), so at or under the limit the
 *  rules would let the agent accept too, and the window never says otherwise. Read from the Diff's
 *  "Who decides" row; a limit the window can't see is said to be unseen. */
export function acceptReason(rows: readonly DiffRow[], askAbove: Money | null, total: string): string {
  const present = rows.find((r) => r.id === 'present');
  if (askAbove && present?.rel === '>') return `Your rules say you decide anything above ${formatMoney(askAbove)}, and this ${total} is above that.`;
  if (askAbove && present?.rel === '≤') return `This ${total} isn’t above your ${formatMoney(askAbove)} ask-me limit, so your rules don’t require you to decide it; you can still accept it here.`;
  return 'This window can’t see your ask-me limit. You can still accept this offer yourself here.';
}

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
        i.shieldRule ? `The scam check paused it: ${i.shieldRule.charAt(0).toLowerCase()}${i.shieldRule.slice(1)}`
          : seen.length ? `The wallet doesn’t say which check paused it. What you can see: ${seen.join(' and ')}.` : 'The wallet doesn’t say which check paused it, and nothing else on this page explains it.',
        'Unpausing pays nothing: it turns “Paused for you” into “Check with you”, and you still approve the payment itself.',
      ],
    };
  }
  if (phase !== 'ready' && phase !== 'locked' && !(phase === 'waiting' && act !== null)) return null;

  switch (act) {
    case 'accept':
      return {
        question: 'Why am I being asked?',
        lines: [acceptReason(i.rows, i.askAbove, total), 'Approving only agrees the price: nothing is charged or held until you approve on PayPal’s own page.'],
      };
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
          i.unavailable ? i.unavailable : d.mode === 'replay' ? `Approving sends one real ${total} PayPal invoice; the failure is a replay, so it is never counted.` : `Approving sends one ${total} PayPal invoice to this subscriber.`,
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

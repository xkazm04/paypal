// A deal has two files, one from each wallet. They are signed separately, but they describe one deal:
// the same signed messages, the same price, the same payment, and each names the other side's owner
// key. Putting the two side by side is "provable by both sides": a file that is true by itself can
// still tell a different story from the other side's, and this is where that would show.
import { sha256, toHex } from './bytes';
import { type Money, showMoney, sameMoney } from './money';
import type { Prepared } from './verify';
import { termsAmount } from './authority';

/** What one file says about the deal, for comparing with the other side's. */
export interface Side {
  deal: string;
  side: 'buyer' | 'seller';
  /** The owner key's id, and the id of the key this file names as the other side's. */
  owner: string;
  theirs: string;
  /** Where the signed messages end (hex). */
  head: string;
  amount: Money | null;
  /** The payment the signed receipt names, if there is a receipt. */
  capture: string | null;
  /** The file's own verdict. */
  verified: boolean;
}

export async function sideOf(prepared: Prepared, verified: boolean): Promise<Side> {
  const b = prepared.bundle;
  let amount: Money | null = null;
  try {
    amount = termsAmount(b.deal.terms);
  } catch {
    amount = null;
  }
  return {
    deal: b.deal.id,
    side: b.deal.side,
    owner: toHex(await sha256(b.owner_key)),
    theirs: toHex(await sha256(b.counterparty.owner_key)),
    head: toHex(b.deal.transcript_head),
    amount,
    capture: b.receipts[0]?.capture_id ?? null,
    verified,
  };
}

export type AgreementId = 'each' | 'deal' | 'sides' | 'keys' | 'messages' | 'price' | 'payment';
export interface Agreement {
  id: AgreementId;
  /** True: the two files say the same. False: they differ. Null: nothing to compare. */
  agree: boolean | null;
  detail: string;
}

/** The ways two files can agree or differ; each line says what was compared. */
export function compareSides(a: Side, b: Side): Agreement[] {
  const price = a.amount && b.amount ? sameMoney(a.amount, b.amount) : false;
  return [
    {
      id: 'each',
      agree: a.verified && b.verified,
      detail: `${a.verified ? 'this file checks out' : 'this file does not check out'}; ${b.verified ? 'the other checks out' : 'the other does not check out'}`,
    },
    { id: 'deal', agree: a.deal === b.deal, detail: a.deal === b.deal ? 'one deal' : 'two different deals' },
    { id: 'sides', agree: a.side !== b.side, detail: a.side !== b.side ? `one from the ${a.side}, one from the ${b.side}` : `both from the ${a.side}` },
    {
      id: 'keys',
      agree: a.theirs === b.owner && b.theirs === a.owner,
      detail: a.theirs === b.owner && b.theirs === a.owner ? 'each file names the other’s owner key' : 'the owner keys the two files name do not match',
    },
    { id: 'messages', agree: a.head === b.head, detail: a.head === b.head ? `both end at the same signed message, ${a.head.slice(0, 12)}…` : `one ends at ${a.head.slice(0, 12)}…, the other at ${b.head.slice(0, 12)}…` },
    {
      id: 'price',
      agree: price,
      detail: price && a.amount ? `both say ${showMoney(a.amount)}` : `${a.amount ? showMoney(a.amount) : 'no price'} against ${b.amount ? showMoney(b.amount) : 'no price'}`,
    },
    {
      id: 'payment',
      agree: a.capture === null && b.capture === null ? null : a.capture === b.capture,
      detail: a.capture === null && b.capture === null ? 'neither has a receipt yet' : a.capture === b.capture ? `both name payment ${a.capture}` : `${a.capture ?? 'no receipt'} against ${b.capture ?? 'no receipt'}`,
    },
  ];
}

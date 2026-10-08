// Round 2 for the Rescue page (docs/ux/ROUND-2.md, experiment r2-rescue): pure helpers, no React, no IPC.
//   previewFor    "what the subscriber would get": for the discount, the wallet's own invoice line and
//                 price (RescueView.text and .offer, the fixed template in Rust table-core rescue.rs, the
//                 same words PayPal shows the subscriber); for the fixes not built yet, an illustration
//                 with the amount left open
//   fixWhy        two plain sentences behind each fix and behind "Do nothing"
//   rescueStrip   money at risk · in progress · recovered (the wallet's own total: replays, practice rows
//                 and invoices only sent never count)
// Unit-tested in preview.test.ts.
import type { Currency } from '@bindings/Currency';
import type { Deal } from '@bindings/Deal';
import type { Money } from '@bindings/Money';
import type { RescueBook } from '@bindings/RescueBook';
import type { RescueOffer } from '@bindings/RescueOffer';
import type { RescueView } from '@bindings/RescueView';
import { formatMinor } from '../../../../lib/format';
import { percentWords } from '../../../../lib/words';
import { dealTotal, sumByCurrency } from '../../logic';
import { atRiskOf, recovered, type Col, type Rows } from './model';

/** The words for an amount the owner has not chosen yet. */
export const YOU_CHOOSE = 'you choose it in the approval window';

/** "care-plan" becomes "Care plan". */
export function planName(itemRef: string): string {
  const w = itemRef.replace(/[-_]+/g, ' ').trim();
  return w ? `${w.charAt(0).toUpperCase()}${w.slice(1)}` : 'Subscription';
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
/** "Mon 10 Oct" in local time from Unix seconds. */
export function retryDate(unix: number): string {
  const d = new Date(unix * 1000);
  return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
}

// ---- what the subscriber would get -----------------------------------------------------------------------

export type PreviewChannel = 'invoice' | 'email' | 'retry';
export type Preview = {
  channel: PreviewChannel;
  /** What kind of thing it is: "Invoice line", "Email subject", "From PayPal". */
  kind: string;
  /** The line itself. */
  line: string;
  /** The amount on the line: known, or "you choose it in the approval window". */
  amount: { label?: string; text: string; unknown: boolean } | null;
  /** One short follow-on line, facts only. */
  note: string | null;
};
export type PreviewCtx = { item: string; amount: Money; retryAt: number | null; /** The wallet's rescue read (fix and invoice wording). */ view?: Pick<RescueView, 'offer' | 'text'> | null };
/** The words for the discount before the wallet has shown it. */
export const BY_WALLET = 'worked out by your wallet';

const money = (m: Money) => formatMinor(m.minor, m.currency as Currency);

export function previewFor(col: Col, c: PreviewCtx): Preview {
  const plan = planName(c.item);
  const amt = money(c.amount);
  switch (col) {
    case 'NONE':
      return {
        channel: 'retry', kind: 'From PayPal', line: c.retryAt ? `PayPal retries ${retryDate(c.retryAt)}` : `No retry is set for ${plan}`,
        amount: { label: plan, text: amt, unknown: false }, note: 'No message from you',
      };
    case 'DISCOUNT_THIS_CYCLE': {
      const v = c.view;
      return v
        ? { channel: 'invoice', kind: 'Invoice line', line: v.text.item, amount: { label: 'This cycle', text: money(v.offer.invoice), unknown: false }, note: `Usual price ${money(v.offer.cycle)} · ${percentWords(v.offer.discount_bp)} off` }
        : { channel: 'invoice', kind: 'Invoice line', line: `${plan} · this cycle only`, amount: { label: 'This cycle', text: BY_WALLET, unknown: true }, note: `Usual price ${amt}` };
    }
    case 'PAUSE':
      return { channel: 'email', kind: 'Email subject', line: `Your ${plan} is paused for now`, amount: null, note: `Restart date: ${YOU_CHOOSE}` };
    case 'RETRY_AFTER_FIX':
      return { channel: 'email', kind: 'Email subject', line: `Your ${plan} payment of ${amt} didn’t go through`, amount: null, note: 'Asks them to fix their card and reply' };
    case 'DOWNGRADE':
      return { channel: 'email', kind: 'Email subject', line: `Move your ${plan} to a smaller plan`, amount: { label: 'New price', text: YOU_CHOOSE, unknown: true }, note: null };
  }
}

// ---- Why? ---------------------------------------------------------------------------------------------------------

export type FixWhyCtx = { amount: Money; retryAt: number | null; /** cellState's code when the fix is switched off. */ offCode?: string; /** The wallet's fix, when shown. */ offer?: RescueOffer | null };

/** The question a fix's Why? answers. */
export const fixQuestion = (col: Col): string => (col === 'NONE' ? 'Why is doing nothing safe?' : 'Why this fix?');

/** Two plain sentences, from the lever list and facts on the card; no model, no guess, no new number. */
export function fixWhy(col: Col, c: FixWhyCtx): [string, string] {
  if (c.offCode === 'REPLAY') return ['This renewal is a replay, so there is no real balance to collect.', 'Nothing was sent, and doing nothing is still safe.'];
  if (c.offCode === 'NOT_BUILT') return ['This fix isn’t available yet, so it can’t be sent.', 'Doing nothing is still safe: PayPal retries on its own.'];
  if (c.offCode) return ['PayPal’s own retry is due within a day, so this fix is not offered right now.', 'Doing nothing lets that retry run.'];
  switch (col) {
    case 'NONE':
      return ['Nothing is sent, so nobody is contacted and no money moves.', c.retryAt ? `PayPal retries the payment by itself on ${retryDate(c.retryAt)}.` : 'PayPal has no retry set, so this month stays unpaid.'];
    case 'DISCOUNT_THIS_CYCLE':
      return [c.offer
        ? `It makes one PayPal invoice for the missed cycle at ${money(c.offer.invoice)}, ${percentWords(c.offer.discount_bp)} off, for this subscriber only.`
        : 'It makes one PayPal invoice for the missed cycle at a discount inside your rules, for this subscriber only.', 'The plan price stays the same for everyone.'];
    case 'PAUSE':
      return ['It pauses this one subscription now and restarts it on a date you agree.', 'The email is a fixed template that you send yourself.'];
    case 'RETRY_AFTER_FIX':
      return ['Nothing goes to PayPal now: you ask them to fix their card first.', `Once they reply, you collect what they owe, up to ${money(c.amount)}.`];
    case 'DOWNGRADE':
      return ['It moves this subscription to a cheaper plan you created beforehand.', 'If PayPal needs their approval, the link goes in your email.'];
  }
}

// ---- the strip ------------------------------------------------------------------------------------------------------

export type RescueStrip = {
  atRisk: Money[];
  inProgress: Money[];
  /** Really paid rescues only: never replays, never practice-agent rows. */
  recovered: Money[];
  failing: number;
  inflight: number;
  /** Failing or waiting rows that are replays or practice rows: their money is not real. */
  notReal: number;
};

export function rescueStrip(rows: Rows, deals: readonly Deal[], book: Pick<RescueBook, 'cases' | 'recovered'> | null | undefined): RescueStrip {
  const live = [...rows.failing, ...rows.inflight];
  // At risk is the renewal that failed (the cycle's price), not the discounted invoice.
  return {
    atRisk: sumByCurrency(rows.failing.map((d) => atRiskOf(d, book))),
    inProgress: sumByCurrency(rows.inflight.map(dealTotal)),
    recovered: recovered(deals, book).totals,
    failing: rows.failing.length,
    inflight: rows.inflight.length,
    notReal: live.filter((d) => d.mode === 'replay' || d.mode === 'scripted_engine').length,
  };
}

/** "$9.60 · €5.00", or null when there is nothing. */
export const moneyList = (ms: readonly Money[]): string | null => (ms.length ? ms.map(money).join(' · ') : null);

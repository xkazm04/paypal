// "Paid out today", one reading for the console footer and the Book (rebuild WP3b, scale finding #9).
// Before, the footer showed the wallet's day budget used (ExposureView out_today: every deal agreed
// today, holds and payments still waiting included) under the words "paid out today", while the
// Book said something much smaller. Now both read one set, worked out by one function
// (model.ts paidOutIn): your agents' paid buyer deals of the wallet's day (it starts at midnight
// UTC, ExposureView.day_start), never a hold, never a payment still agreed or being checked with
// PayPal, never a refund or a payment PayPal's statement did not confirm. What it leaves out is said
// in the footer's tooltip, from the exposure fold (held, committed, the day's budget). Pure, plus one
// memoised hook.
import { useMemo } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import type { ExposureView } from '@bindings/ExposureView';
import type { Money } from '@bindings/Money';
import { formatMinor } from '../../../../../lib/format';
import { meterRow, nearLimit } from '../../../../../lib/limits';
import { paidOutIn, walletDay } from './model';

export type PaidToday = {
  /** Paid out today, per currency (empty: nothing yet). */
  paid: Money[];
  n: number;
  /** The currency to say "nothing yet" in, when one is known. */
  currency: Money['currency'] | null;
  /** Not paid: held at PayPal now, and agreed but not held yet (null with no single row). */
  held: Money | null;
  committed: Money | null;
  /** What the agents agreed to pay today, against the signed daily limit (if any). */
  budget: Money | null;
  limit: Money | null;
  /** The day's budget is at or past four fifths of the limit. */
  near: boolean;
  dayStart: number;
};

/** The footer's figure and the Book's, or null while the wallet has not answered. */
export function paidToday(view: ExposureView | null | undefined, deals: readonly Deal[], checking: (d: Deal) => boolean): PaidToday | null {
  if (!view) return null;
  const row = meterRow(view);
  const limit = view.status === 'active' && view.limits ? view.limits.max_out_day : null;
  const paid = paidOutIn(deals, walletDay(view.day_start), checking);
  return {
    paid: paid.money,
    n: paid.n,
    currency: row?.currency ?? limit?.currency ?? null,
    held: row?.held ?? null,
    committed: row?.committed ?? null,
    budget: row?.out_today ?? null,
    limit,
    near: limit && row ? nearLimit(row.out_today.minor, limit.minor) : false,
    dayStart: view.day_start,
  };
}

/** The figure as words: each currency on its own, a known zero as zero, else "nothing yet". */
export function paidTodayText(t: PaidToday, nothing: string): string {
  if (t.paid.length) return t.paid.map((m) => formatMinor(m.minor, m.currency)).join(' · ');
  return t.currency ? formatMinor(0, t.currency) : nothing;
}

const NO_DEALS: readonly Deal[] = [];
/** The footer's and the Book's reading, from the World's narrow selectors. */
export function usePaidToday(view: ExposureView | null | undefined, deals: readonly Deal[] | undefined, needs: readonly AttentionItem[]): PaidToday | null {
  const list = deals ?? NO_DEALS;
  return useMemo(() => {
    const checking = new Set(needs.filter((n) => n.money_check).map((n) => n.deal_id));
    return paidToday(view, list, (d) => checking.has(d.id));
  }, [view, list, needs]);
}

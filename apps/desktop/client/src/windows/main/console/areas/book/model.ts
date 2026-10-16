// The Book layer's pure figures (rebuild WP3b). No React, no IPC: every number the Book's summary,
// ledger and outlook show is worked out here, so a count and the amount beside it always describe
// the same set (scale finding #8), a hold is never added to what was paid (#8, #9), and "this week"
// is the week and nothing older (#10). Money stays integer minor units per currency, never added
// across currencies (lib/format formats it; nothing here formats or parses text).
import type { Deal } from '@bindings/Deal';
import type { Money } from '@bindings/Money';
import { dealTotal, isLive, sumByCurrency, weekBounds } from '../../../logic';
import { bucketOf, dirOf, sums, type Bucket } from '../../../modules/book/model';

export const DAY = 86_400;

/** A span of time, [start, end) in Unix seconds. */
export type Span = { start: number; end: number };

/** The owner's week, Monday 00:00 local to the next Monday (logic.ts weekBounds). */
export const weekSpan = (now: number): Span => weekBounds(now);

/** The wallet's day: it starts at midnight UTC (ExposureView.day_start), as the footer meter counts it. */
export const walletDay = (dayStart: number): Span => ({ start: dayStart, end: dayStart + DAY });

/** When a deal last moved: its last change, else when it started; undefined when neither is known. */
export const stampOf = (d: Pick<Deal, 'updated_at' | 'created_at'>): number | undefined => d.updated_at ?? d.created_at ?? undefined;

/** A deal belongs to a span when it started or last changed inside it. A deal with no time at all
 *  is in no span (it is on record, never in "this week"). */
export function inSpan(d: Pick<Deal, 'updated_at' | 'created_at'>, s: Span): boolean {
  return [d.created_at, d.updated_at].some((t) => t !== undefined && t !== null && t >= s.start && t < s.end);
}

/** How many of these deals fall outside the span (older than the week, or with no time on record). */
export const outsideSpan = (deals: readonly Pick<Deal, 'updated_at' | 'created_at'>[], s: Span): number => deals.filter((d) => !inSpan(d, s)).length;

/** The deals of a span, nothing older (scale finding #10: the week is the week). */
export function dealsIn(deals: readonly Deal[], s: Span): Deal[] {
  return deals.filter((d) => inSpan(d, s));
}

/** What the Book says about a set of deals, each figure its own: paid out, paid in, on hold out and
 *  in, how many are being checked with PayPal (in no money figure: not paid and not held), how many
 *  stopped. Counts are of the same deals the amounts add up. */
export type Figures = {
  paidOut: Money[]; paidIn: Money[]; nOut: number; nIn: number;
  heldOut: Money[]; heldIn: Money[]; nHeld: number;
  stoppedOut: Money[]; stoppedIn: Money[]; nStopped: number;
  checking: number;
  total: number;
};

export function figures(deals: readonly Deal[], checking: (d: Deal) => boolean): Figures {
  const s = sums(deals, checking);
  const counted = deals.filter((d) => !checking(d));
  const n = (b: Bucket, dir?: 'out' | 'in') => counted.filter((d) => bucketOf(d) === b && (!dir || dirOf(d) === dir)).length;
  return {
    paidOut: s.captured.out, paidIn: s.captured.in, nOut: n('captured', 'out'), nIn: n('captured', 'in'),
    heldOut: s.held.out, heldIn: s.held.in, nHeld: n('held'),
    stoppedOut: s.stopped.out, stoppedIn: s.stopped.in, nStopped: n('stopped'),
    checking: deals.length - counted.length,
    total: deals.length,
  };
}

/** Money your agents paid out in a span: buyer deals that are paid (never a hold, never a deal
 *  being checked with PayPal), changed inside the span. The Book's "paid out today" and the footer
 *  meter read the same set (scale finding #9). */
export function paidOutIn(deals: readonly Deal[], s: Span, checking: (d: Deal) => boolean): { money: Money[]; n: number } {
  const paid = deals.filter((d) => dirOf(d) === 'out' && !checking(d) && bucketOf(d) === 'captured' && inSpan(d, s));
  return { money: sumByCurrency(paid.map(dealTotal)), n: paid.length };
}

// ---- the outlook: what waits on a deadline (scale finding #8) ------------------------------------

export type OutlookKey = 'holds' | 'links' | 'renew' | 'checking';
export const OUTLOOK_KEYS: readonly OutlookKey[] = ['holds', 'links', 'renew', 'checking'];

export type OutlookItem = {
  key: OutlookKey;
  /** Every deal of this kind, soonest deadline first (no deadline last). */
  deals: Deal[];
  /** The money of exactly these deals, per currency (renewals: what is at risk). */
  total: Money[];
  /** The soonest one and its own amount and deadline, said apart from the total. */
  soonest: { deal: Deal; amount: Money; deadline: number | null } | null;
};

/** Which outlook set a deal is in, if any. A payment being checked with PayPal is only that: not a
 *  hold to decide, not paid, not failed. */
export function outlookKeyOf(d: Deal, checking: (d: Deal) => boolean): OutlookKey | null {
  if (checking(d)) return 'checking';
  if (d.state === 'AUTHORIZED') return 'holds';
  if (d.state === 'AWAITING_APPROVAL') return 'links';
  if (d.kind === 'rescue' && d.state === 'AGREED') return 'renew';
  return null;
}

/** The four outlook lines over every live deal (an older hold still waits, whatever the week). */
export function outlook(deals: readonly Deal[], checking: (d: Deal) => boolean, deadlineOf: (d: Deal) => number | null, amountOf: (k: OutlookKey, d: Deal) => Money): OutlookItem[] {
  const by = new Map<OutlookKey, Deal[]>(OUTLOOK_KEYS.map((k) => [k, []]));
  for (const d of deals) {
    if (!isLive(d) && !checking(d)) continue;
    const k = outlookKeyOf(d, checking);
    if (k) by.get(k)?.push(d);
  }
  return OUTLOOK_KEYS.map((key) => {
    const xs = [...(by.get(key) ?? [])].sort((a, b) => (deadlineOf(a) ?? Infinity) - (deadlineOf(b) ?? Infinity));
    const first = xs[0];
    return {
      key,
      deals: xs,
      total: sumByCurrency(xs.map((d) => amountOf(key, d))),
      soonest: first ? { deal: first, amount: amountOf(key, first), deadline: deadlineOf(first) } : null,
    };
  });
}

/** How many outlook deals wait, over all four lines. */
export const outlookCount = (items: readonly OutlookItem[]): number => items.reduce((n, it) => n + it.deals.length, 0);

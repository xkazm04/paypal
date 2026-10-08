// Rescue page logic (the Lever Matrix) - pure, no React, no IPC. Tested in model.test.ts.
//
// The lever list is closed and comes from the design (docs/design/the-table.html §7, "The four
// levers"): DISCOUNT_THIS_CYCLE, PAUSE, RETRY_AFTER_FIX, DOWNGRADE. The plan-wide price change
// (update-pricing-schemes) is banned from the tool surface (acceptance R3). One lever is built end
// to end (DECISIONS §13): DISCOUNT_THIS_CYCLE, whose one fix per failed renewal the wallet computes
// inside the signed fixes rule (rescue_book's RescueView.offer). The other three are not built yet
// and say so. Recovered money is the wallet's own total (RescueBook.recovered): only an invoice
// PayPal shows paid, receipted, on a failure PayPal reported; never a replay, never "sent".
import type { Currency } from '@bindings/Currency';
import type { Deal } from '@bindings/Deal';
import type { Money } from '@bindings/Money';
import type { RescueBook } from '@bindings/RescueBook';
import type { RescueOffer } from '@bindings/RescueOffer';
import type { RescueView } from '@bindings/RescueView';
import { isLive } from '../../logic';

export type LeverKey = 'DISCOUNT_THIS_CYCLE' | 'PAUSE' | 'RETRY_AFTER_FIX' | 'DOWNGRADE';
export type Col = 'NONE' | LeverKey;

export type Lever = { key: LeverKey; short: string; name: string; calls: string[]; effect: string; hears: string };

/** The closed list, in the design's order. Calls and channels are the design's [S]-sourced rows. */
export const LEVERS: readonly Lever[] = [
  { key: 'DISCOUNT_THIS_CYCLE', short: 'Discount', name: 'Discount this cycle',
    calls: ['POST /v2/invoicing/invoices · the discounted amount', 'POST /v2/invoicing/invoices/{id}/send', 'GET /v2/invoicing/invoices/{id} until PAID'],
    effect: 'one PayPal invoice for the missed cycle at the discounted amount, this cycle only',
    hears: 'PayPal emails the invoice; the subscriber pays on a PayPal-hosted page' },
  { key: 'PAUSE', short: 'Pause', name: 'Pause',
    calls: ['POST /v1/billing/subscriptions/{id}/suspend now', 'POST /v1/billing/subscriptions/{id}/activate on the agreed date'],
    effect: 'suspend this subscription now and activate it on the agreed date',
    hears: 'your own email: a template draft opened in your mail client; you press send' },
  { key: 'RETRY_AFTER_FIX', short: 'Retry after fix', name: 'Retry after fix',
    calls: ['no PayPal call now', 'later: POST /v1/billing/subscriptions/{id}/capture · OUTSTANDING_BALANCE ≤ the balance'],
    effect: 'your email asks them to fix their funding source; once they reply, a capture collects the outstanding balance',
    hears: 'your own email; you collect once they reply' },
  { key: 'DOWNGRADE', short: 'Downgrade', name: 'Downgrade',
    calls: ['POST /v1/billing/subscriptions/{id}/revise to a pre-created cheaper plan'],
    effect: 'move this subscription to a cheaper plan you created beforehand',
    hears: 'if revise returns a payer approval link, it goes in your email' },
];
export const COLS: readonly Col[] = ['NONE', ...LEVERS.map((l) => l.key)];
export const leverOf = (k: LeverKey): Lever => LEVERS.find((l) => l.key === k) as Lever;

const DAY = 86400;

export type CellState =
  /** the default: nothing is sent */
  | { kind: 'default'; sub: string }
  /** the one fix the wallet worked out inside your fixes rule */
  | { kind: 'offer'; offer: RescueOffer }
  /** refused by a rule Rust enforces, decidable from the deal alone, or not built yet */
  | { kind: 'off'; code: string; why: string }
  /** the wallet has not said (its rescue read is missing) */
  | { kind: 'unknown'; why: string };

export const UNKNOWN_LEVER = 'Your wallet hasn’t shown the fix for this renewal yet.';
/** The three fixes that are not built yet: shown so the list stays honest, never offered. */
export const NOT_BUILT = 'Not available yet: only a discount on this cycle can be sent for now';

/** "4 d", "17 h 59 m", "now" - as coarse as the data. */
export function retryLeft(deadline: number, now: number): string {
  const s = deadline - now;
  if (s <= 0) return 'now';
  if (s >= DAY) return `${Math.round(s / DAY)} d`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h} h ${String(m).padStart(2, '0')} m`;
}

/** One cell of the matrix. Only rules the deal itself can decide are shown as "off": RETRY_AFTER_FIX
 *  is disabled on REPLAY rows (no real balance) and while PayPal's own retry is under 24 h away. */
export function cellState(d: Pick<Deal, 'mode'>, col: Col, deadline: number | null, now: number, view?: Pick<RescueView, 'offer'> | null): CellState {
  if (col === 'NONE') return { kind: 'default', sub: deadline ? `retry ${retryLeft(deadline, now)}` : 'cycle unpaid' };
  if (col === 'DISCOUNT_THIS_CYCLE') return view ? { kind: 'offer', offer: view.offer } : { kind: 'unknown', why: UNKNOWN_LEVER };
  if (col === 'RETRY_AFTER_FIX') {
    if (d.mode === 'replay') return { kind: 'off', code: 'REPLAY', why: 'REPLAY row · no real balance to capture' };
    if (deadline && deadline - now < DAY) return { kind: 'off', code: 'retry <24h', why: 'PayPal’s own retry is due within 24 h' };
  }
  return { kind: 'off', code: 'NOT_BUILT', why: NOT_BUILT };
}

/** A fix the owner can pick on the card: the computed discount, or doing nothing. */
export const pickable = (st: CellState): boolean => st.kind === 'default' || st.kind === 'offer';

/** Rules the inspector lists for a lever: ✓ holds, ✕ refuses, ? not in the contract. */
export function rulesFor(d: Pick<Deal, 'mode'>, col: LeverKey, deadline: number | null, now: number, view?: Pick<RescueView, 'offer'> | null): Array<['ok' | 'x' | 'unk', string]> {
  const r: Array<['ok' | 'x' | 'unk', string]> = [['ok', 'acts on this one subscriber only']];
  if (col === 'DISCOUNT_THIS_CYCLE') {
    r.push(view ? ['ok', 'inside your rules for fixing failed renewals, worked out by your wallet'] : ['unk', UNKNOWN_LEVER]);
    r.push(['ok', 'one invoice for this cycle only; PayPal emails it, nothing is charged']);
    if (d.mode === 'replay') r.push(['ok', 'a replayed failure: the invoice is real, and what it brings in is never counted']);
  } else r.push(['x', NOT_BUILT.toLowerCase()]);
  if (col === 'RETRY_AFTER_FIX') {
    r.push([d.mode === 'replay' ? 'x' : 'ok', d.mode === 'replay' ? 'a replayed renewal: there is no real balance to collect' : 'a real failed payment, not a replay']);
    const soon = !!deadline && deadline - now < DAY;
    r.push([soon ? 'x' : 'ok', `PayPal’s own retry is more than a day away (${deadline ? `in ${retryLeft(deadline, now)}` : 'none scheduled'})`]);
  }
  r.push(['ok', 'the plan price stays the same for everyone']);
  r.push(['ok', col === 'DISCOUNT_THIS_CYCLE' ? 'the invoice wording is your wallet’s, never written by an agent' : 'the email is a fixed template, never written by an agent']);
  return r;
}

// ---- rows ---------------------------------------------------------------------------------------

export const isRescueDeal = (d: Pick<Deal, 'kind'>): boolean => d.kind === 'rescue' || d.kind === 'invoice';

export type Rows = { failing: Deal[]; inflight: Deal[]; settled: Deal[] };

/** A failed renewal whose fix waits for the owner (Rust: a rescue deal at AGREED). */
export const isFailing = (d: Pick<Deal, 'kind' | 'state'>): boolean => d.kind === 'rescue' && d.state === 'AGREED';

/** Failing renewals (one fix each) by PayPal's next retry, then invoices in flight, then closed. */
export function splitRows(deals: readonly Deal[], deadlineOf: (d: Deal) => number | null): Rows {
  const rescue = deals.filter(isRescueDeal);
  const dl = (d: Deal) => deadlineOf(d) ?? Infinity;
  return {
    failing: rescue.filter((d) => isFailing(d) && isLive(d)).sort((a, b) => dl(a) - dl(b)),
    inflight: rescue.filter((d) => !isFailing(d) && isLive(d)).sort((a, b) => dl(a) - dl(b)),
    settled: rescue.filter((d) => !isLive(d)),
  };
}

// ---- recovered (acceptance R2) ------------------------------------------------------------------

export type Recovered = { counted: Deal[]; notCounted: Array<{ deal: Deal; why: string }>; totals: Array<{ minor: number; currency: Currency }> };

/** Why a rescue does not count as money you got back (model codes; the page words them). */
export type NotCountedWhy = 'REPLAY' | 'scripted' | 'failing' | 'sent' | 'unverified' | 'closed';

/** Recovered revenue is the wallet's own answer: the cases it marks counted and its per-currency
 *  totals (RescueBook). The page never adds a deal up itself, so "sent", a replay or a practice
 *  row can never turn into recovered money here. Without the read (an older shell), nothing counts. */
export function recovered(deals: readonly Deal[], book: Pick<RescueBook, 'cases' | 'recovered'> | null | undefined): Recovered {
  const counted: Deal[] = [];
  const notCounted: Array<{ deal: Deal; why: NotCountedWhy }> = [];
  const viewOf = new Map((book?.cases ?? []).map((v) => [v.deal_id, v]));
  for (const d of deals.filter(isRescueDeal)) {
    const v = viewOf.get(d.id);
    if (v?.counted) counted.push(d);
    else if (d.mode === 'replay' || v?.source === 'replay') notCounted.push({ deal: d, why: 'REPLAY' });
    else if (d.mode === 'scripted_engine') notCounted.push({ deal: d, why: 'scripted' });
    else if (isFailing(d)) notCounted.push({ deal: d, why: 'failing' });
    else if (isLive(d)) notCounted.push({ deal: d, why: 'sent' });
    else if (d.state === 'RECEIPTED' || d.state === 'RECONCILED' || d.state === 'CAPTURED') notCounted.push({ deal: d, why: 'unverified' });
    else notCounted.push({ deal: d, why: 'closed' });
  }
  return { counted, notCounted, totals: (book?.recovered ?? []).map((m: Money) => ({ minor: m.minor, currency: m.currency })) };
}

/** The wallet's rescue read for one deal, if it has one. */
export const viewFor = (book: Pick<RescueBook, 'cases'> | null | undefined, id: string): RescueView | undefined => book?.cases.find((v) => v.deal_id === id);

// ---- keyboard movement in the matrix --------------------------------------------------------------

/** Next focused cell for an arrow key; null when the key does not move. */
export function moveCell(rows: readonly string[], at: { id: string; col: Col }, key: string): { id: string; col: Col } | null {
  const ci = COLS.indexOf(at.col);
  const ri = rows.indexOf(at.id);
  if (ci < 0 || ri < 0) return null;
  switch (key) {
    case 'ArrowRight': return ci < COLS.length - 1 ? { id: at.id, col: COLS[ci + 1] as Col } : null;
    case 'ArrowLeft': return ci > 0 ? { id: at.id, col: COLS[ci - 1] as Col } : null;
    case 'ArrowDown': return ri < rows.length - 1 ? { id: rows[ri + 1] as string, col: at.col } : null;
    case 'ArrowUp': return ri > 0 ? { id: rows[ri - 1] as string, col: at.col } : null;
    case 'Home': return { id: at.id, col: 'NONE' };
    case 'End': return { id: at.id, col: COLS[COLS.length - 1] as Col };
    default:
      if (/^[0-4]$/.test(key)) return { id: at.id, col: COLS[Number(key)] as Col };
      return null;
  }
}

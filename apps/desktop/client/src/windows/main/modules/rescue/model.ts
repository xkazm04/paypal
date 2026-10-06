// Rescue page logic (the Lever Matrix) - pure, no React, no IPC. Tested in model.test.ts.
//
// The lever list is closed and comes from the design (docs/design/the-table.html §7, "The four
// levers"): DISCOUNT_THIS_CYCLE, PAUSE, RETRY_AFTER_FIX, DOWNGRADE. The plan-wide price change
// (update-pricing-schemes) is banned from the tool surface (acceptance R3). What the contract gives
// per subscriber today: the rescue deal (state, amount, mode), its deadline (PayPal's next retry),
// and the attention item when a lever waits for the owner. It does NOT carry which lever the agent
// suggests, which levers the rescue mandate enables, or a way to pick one: those cells stay unknown.
import type { Currency } from '@bindings/Currency';
import type { Deal } from '@bindings/Deal';
import { dealTotal, isLive, isSettled } from '../../logic';

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
  /** refused by a rule Rust enforces, decidable from the deal alone */
  | { kind: 'off'; code: string; why: string }
  /** the contract does not say */
  | { kind: 'unknown'; why: string };

export const UNKNOWN_LEVER = 'The contract carries no lever list, suggestion or per-lever check for this subscriber, and the rescue mandate has no lever clause yet.';

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
export function cellState(d: Pick<Deal, 'mode'>, col: Col, deadline: number | null, now: number): CellState {
  if (col === 'NONE') return { kind: 'default', sub: deadline ? `retry ${retryLeft(deadline, now)}` : 'cycle unpaid' };
  if (col === 'RETRY_AFTER_FIX') {
    if (d.mode === 'replay') return { kind: 'off', code: 'REPLAY', why: 'REPLAY row · no real balance to capture' };
    if (deadline && deadline - now < DAY) return { kind: 'off', code: 'retry <24h', why: 'PayPal’s own retry is due within 24 h' };
  }
  return { kind: 'unknown', why: UNKNOWN_LEVER };
}

/** Rules the inspector lists for a lever: ✓ holds, ✕ refuses, ? not in the contract. */
export function rulesFor(d: Pick<Deal, 'mode'>, col: LeverKey, deadline: number | null, now: number): Array<['ok' | 'x' | 'unk', string]> {
  const r: Array<['ok' | 'x' | 'unk', string]> = [['ok', 'acts on this one subscriber only']];
  r.push(['unk', 'whether your rescue rules allow this fix is not shown yet']);
  if (col === 'RETRY_AFTER_FIX') {
    r.push([d.mode === 'replay' ? 'x' : 'ok', d.mode === 'replay' ? 'a replayed renewal: there is no real balance to collect' : 'a real failed payment, not a replay']);
    const soon = !!deadline && deadline - now < DAY;
    r.push([soon ? 'x' : 'ok', `PayPal’s own retry is more than a day away (${deadline ? `in ${retryLeft(deadline, now)}` : 'none scheduled'})`]);
  }
  r.push(['ok', 'the plan price stays the same for everyone']);
  r.push(['ok', 'the email is a fixed template, never written by an agent']);
  return r;
}

// ---- rows ---------------------------------------------------------------------------------------

export const isRescueDeal = (d: Pick<Deal, 'kind'>): boolean => d.kind === 'rescue' || d.kind === 'invoice';

export type Rows = { failing: Deal[]; inflight: Deal[]; settled: Deal[] };

/** Failing renewals (one lever each) by PayPal's next retry, then levers in flight, then settled. */
export function splitRows(deals: readonly Deal[], deadlineOf: (d: Deal) => number | null): Rows {
  const rescue = deals.filter(isRescueDeal);
  const dl = (d: Deal) => deadlineOf(d) ?? Infinity;
  return {
    failing: rescue.filter((d) => d.state === 'FAILED' && isLive(d)).sort((a, b) => dl(a) - dl(b)),
    inflight: rescue.filter((d) => d.state !== 'FAILED' && isLive(d)).sort((a, b) => dl(a) - dl(b)),
    settled: rescue.filter((d) => !isLive(d)),
  };
}

// ---- recovered (acceptance R2) ------------------------------------------------------------------

export type Recovered = { counted: Deal[]; notCounted: Array<{ deal: Deal; why: string }>; totals: Array<{ minor: number; currency: Currency }> };

/** Recovered revenue = settled rescue invoices and captures, never REPLAY or scripted-only rows.
 *  Sums stay per currency; they are never mixed. */
export function recovered(deals: readonly Deal[]): Recovered {
  const counted: Deal[] = [];
  const notCounted: Array<{ deal: Deal; why: string }> = [];
  for (const d of deals.filter(isRescueDeal)) {
    if (d.mode === 'replay') notCounted.push({ deal: d, why: 'REPLAY row · never counts on its own' });
    else if (d.mode === 'scripted_engine') notCounted.push({ deal: d, why: 'scripted-engine row' });
    else if (isSettled(d)) counted.push(d);
    else if (isLive(d)) notCounted.push({ deal: d, why: d.state === 'FAILED' ? 'renewal still failing · nothing recovered yet' : 'not paid yet' });
  }
  const by = new Map<Currency, number>();
  for (const d of counted) { const t = dealTotal(d); by.set(t.currency, (by.get(t.currency) ?? 0) + t.minor); }
  return { counted, notCounted, totals: [...by.entries()].map(([currency, minor]) => ({ currency, minor })) };
}

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

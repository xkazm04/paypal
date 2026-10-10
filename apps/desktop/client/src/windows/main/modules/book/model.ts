// Book page logic (the Ledger Lens) - pure, no React, no IPC. Tested in model.test.ts.
//
// The grid is the ledger the window already read (list_deals + deal_evidence). Money is kept apart
// by state - captured, held at PayPal, in motion, stopped - and by direction and currency; the four
// states are never added together. A lens is a fixed BookQuery (the closed query language of the
// design, report §7 cap 5) applied here to those same rows: it reads nothing new and writes nothing.
// A typed question is read into the same closed language by ./understand.ts (no engine involved).
import type { Currency } from '@bindings/Currency';
import type { Deal } from '@bindings/Deal';
import type { DealKind } from '@bindings/DealKind';
import type { DealState } from '@bindings/DealState';
import type { Money } from '@bindings/Money';
import type { Reconciliation } from '@bindings/Reconciliation';
import { exponent } from '../../../../lib/format';
import { sellerSaysOnly, stateWord, unconfirmedMeans, type StatementRead } from '../../../../lib/words';
import { dealTotal, decidedBy, isSettled, isTerminal, sumByCurrency } from '../../logic';

// ---- money states ------------------------------------------------------------------------------

export type Bucket = 'captured' | 'held' | 'motion' | 'unconfirmed' | 'stopped';
export const BUCKETS: readonly Bucket[] = ['captured', 'held', 'motion', 'unconfirmed', 'stopped'];
export const BUCKET_LABEL: Record<Bucket, string> = { captured: 'Paid', held: 'On hold', motion: 'In progress', unconfirmed: 'Not confirmed', stopped: 'Stopped' };
export const BUCKET_SUB: Record<Bucket, string> = {
  captured: 'the money moved', held: 'held at PayPal, not paid yet', motion: 'nothing paid yet',
  unconfirmed: 'ended: the seller said it was paid, but your wallet has no match for it on PayPal’s statement', stopped: 'never paid, or paid back',
};

/** Captured = settled; held = authorized at PayPal; stopped = ended without (or reversing) payment; else in motion. */
export function bucketOf(d: Pick<Deal, 'state' | 'kind' | 'shield'> & Partial<Pick<Deal, 'side'>>): Bucket {
  if (isSettled(d)) return 'captured';
  if (d.state === 'AUTHORIZED') return 'held';
  // A deal PayPal's statement did not confirm is an end of its own: neither paid, nor "never paid",
  // nor still in progress. The seller's word alone is still in progress.
  if (d.state === 'UNCONFIRMED') return 'unconfirmed';
  if (sellerSaysOnly(d)) return 'motion';
  if (isTerminal(d)) return 'stopped';
  return 'motion';
}

export type Dir = 'out' | 'in';
export const dirOf = (d: Pick<Deal, 'side'>): Dir => (d.side === 'buyer' ? 'out' : 'in');

export type Sums = Record<Bucket, Record<Dir, Money[]>>;

/** Per state, per direction, per currency. Nothing is ever summed across those. A deal for which
 *  `checking` holds (its payment is being checked with PayPal) is in no bucket: PayPal may already
 *  have collected it, so it is not money on hold, and it is not paid either. Home leaves it out of
 *  what is held for the same reason (heldAtPayPal). */
export function sums(deals: readonly Deal[], checking: (d: Deal) => boolean = () => false): Sums {
  const out = {} as Sums;
  const counted = deals.filter((d) => !checking(d));
  for (const b of BUCKETS) {
    const inB = counted.filter((d) => bucketOf(d) === b);
    out[b] = { out: sumByCurrency(inB.filter((d) => dirOf(d) === 'out').map(dealTotal)), in: sumByCurrency(inB.filter((d) => dirOf(d) === 'in').map(dealTotal)) };
  }
  return out;
}

// ---- the PayPal statement ------------------------------------------------------------------------

export type Statement = Reconciliation | 'unknown';
export const STATEMENTS: readonly Statement[] = ['matched', 'pending_reporting', 'mismatch', 'not_applicable', 'unknown'];
export const STATEMENT_SHORT: Record<Statement, string> = { matched: 'matched', pending_reporting: 'pending', mismatch: 'mismatch', not_applicable: 'n/a', unknown: 'unknown' };
export const STATEMENT_TIP: Record<Statement, string> = {
  matched: 'PayPal’s own statement shows this payment',
  pending_reporting: 'Paid, but PayPal’s statement can take up to 3 hours to show it',
  mismatch: 'PayPal’s statement shows a different amount or payment than this deal',
  not_applicable: 'No money moved, so there is nothing to find on the statement',
  unknown: 'The PayPal proof for this deal could not be read',
};
/** Statement words for the screen (STATEMENT_SHORT stays the export's stable value). */
export const STATEMENT_WORD: Record<Statement, string> = { matched: 'on statement', pending_reporting: 'not yet', mismatch: 'differs', not_applicable: 'no payment', unknown: 'unknown' };
/** The statement word for a deal that ended UNCONFIRMED: no match, and no longer a wait. */
export const UNCONFIRMED_STATEMENT_WORD = 'no match';

/** Whether a deal's statement is an UNCONFIRMED end rather than a wait. Such a deal keeps
 *  reconciliation pending_reporting, but it is past a delay and was never paid (DECISIONS 28). */
export const statementEnded = (s: Statement | null, state: DealState | undefined): boolean => s === 'pending_reporting' && state === 'UNCONFIRMED';

/** The statement word and tip for a deal in `state`, as statementLabel words the deal page: an
 *  UNCONFIRMED end says how it ended, by whether a statement read came back unmatched (`read`),
 *  and never says paid or a delay. Every other deal keeps STATEMENT_WORD and STATEMENT_TIP. */
export function statementWords(s: Statement, state?: DealState, read: StatementRead = null): { word: string; tip: string } {
  return statementEnded(s, state) ? { word: UNCONFIRMED_STATEMENT_WORD, tip: unconfirmedMeans(read) } : { word: STATEMENT_WORD[s], tip: STATEMENT_TIP[s] };
}

/** A deal's statement as the filters and counts key it: an UNCONFIRMED end is its own key, not a wait. */
export type StatementKey = Statement | 'unconfirmed';
export const statementKey = (s: Statement, state: DealState | undefined): StatementKey => (statementEnded(s, state) ? 'unconfirmed' : s);

export function statementCounts(deals: readonly Deal[], stmt: (d: Deal) => Statement): Record<StatementKey, number> {
  const c: Record<StatementKey, number> = { matched: 0, pending_reporting: 0, unconfirmed: 0, mismatch: 0, not_applicable: 0, unknown: 0 };
  for (const d of deals) c[statementKey(stmt(d), d.state)]++;
  return c;
}

// ---- grid helpers ----------------------------------------------------------------------------------

export const KIND_ORDER: readonly DealKind[] = ['haggle', 'purchase', 'shop_order', 'rescue', 'invoice'];
export const kindLabel = (k: DealKind): string => k.replace('_', ' ');

/** The deal's unit price against its market band, in whole percent of the median; null without a comparable band. */
export function vsMedianPct(d: Pick<Deal, 'terms' | 'market'>): number | null {
  const m = d.market;
  const u = d.terms.unit_price;
  if (!m || m.median.currency !== u.currency || m.median.minor <= 0) return null;
  return Math.round(((u.minor - m.median.minor) * 100) / m.median.minor);
}

/** Local calendar day of the deal (created_at), "YYYY-MM-DD"; null when the shell sent no timestamp. */
export function dayKey(d: Pick<Deal, 'created_at'>): string | null {
  if (d.created_at === undefined) return null;
  const t = new Date(d.created_at * 1000);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
export function dayLabel(key: string | null): string {
  if (!key) return '—';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ---- BookQuery (the closed language) and the lenses ------------------------------------------------

export type Field = 'kind' | 'state' | 'counterparty';
export type Filter = { field: Field; op: 'eq' | 'ne' | 'in'; value: string | string[] };
export type GroupBy = 'kind' | 'state' | 'day' | 'counterparty' | 'decided_by';
export type Metric = 'count' | 'sum_amount' | 'avg_vs_market_pct' | 'recovered_sum';
/** `range` is [from, to) in RFC 3339, as the closed BookQuery carries it (typed questions set it). */
export type BookQuery = { view: 'deals' | 'reconciliation'; filters?: Filter[]; group_by?: GroupBy[]; metrics: Metric[]; range?: { from: string; to: string } | null };

export type Lens = { id: string; short: string; question: string; query: BookQuery; unavailable?: string };

const STOPPED: DealState[] = ['REFUSED', 'VOIDED', 'AUTO_VOIDED', 'WITHDRAWN', 'EXPIRED', 'MISMATCH'];

/** Fixed queries that need no engine (report §13 cut-line). "Policy vs me" groups by the
 *  decided_by Rust records on each Deal (owner, a signed rule, or the safe default). */
export const LENSES: readonly Lens[] = [
  { id: 'week', short: 'This week vs market', question: 'What did my agents commit this week, and how did it compare with the market?',
    query: { view: 'deals', group_by: ['kind'], metrics: ['count', 'sum_amount', 'avg_vs_market_pct'] } },
  { id: 'pending', short: 'Does PayPal agree yet?', question: 'Does PayPal agree yet? Which payments are not on my PayPal statement yet?',
    query: { view: 'reconciliation', metrics: ['count', 'sum_amount'] } },
  { id: 'decided', short: 'My rules vs me', question: 'What did my rules decide on their own, and what did I decide?',
    query: { view: 'deals', group_by: ['decided_by'], metrics: ['count', 'sum_amount'] } },
  { id: 'day', short: 'Day by day', question: 'Day by day: what was committed?',
    query: { view: 'deals', group_by: ['day'], metrics: ['count', 'sum_amount'] } },
  { id: 'stopped', short: 'What was stopped', question: 'What was stopped, and how?',
    query: { view: 'deals', filters: [{ field: 'state', op: 'in', value: STOPPED }], group_by: ['state'], metrics: ['count', 'sum_amount'] } },
  { id: 'mismatch', short: 'Amounts that didn’t match', question: 'Any deal whose payment request did not match what was agreed?',
    query: { view: 'deals', filters: [{ field: 'state', op: 'eq', value: 'MISMATCH' }], metrics: ['count', 'sum_amount'] } },
  { id: 'rescue', short: 'Rescued money', question: 'How much money did rescues bring back?',
    query: { view: 'deals', filters: [{ field: 'kind', op: 'in', value: ['rescue', 'invoice'] }], group_by: ['state'], metrics: ['count', 'recovered_sum'] } },
];

/** The query exactly as it runs, on one line. */
export const queryText = (q: BookQuery): string => JSON.stringify(q);

const VIEW_WORDS: Record<BookQuery['view'], string> = { deals: 'your deals', reconciliation: 'payments checked against your PayPal statement' };
const METRIC_WORDS: Record<Metric, string> = {
  count: 'how many', sum_amount: 'amounts, kept apart (paid · on hold · in progress · stopped)',
  avg_vs_market_pct: 'how far prices sit from the typical market price, on average', recovered_sum: 'rescued money that was really paid (never replays)',
};
const OP_WORDS: Record<Filter['op'], string> = { eq: 'is', ne: 'is not', in: 'is one of' };

/** Plain-words reading of a query, generated from the query itself (not by an engine). */
export function readQuery(q: BookQuery): Array<[string, string]> {
  const lines: Array<[string, string]> = [['view', VIEW_WORDS[q.view]]];
  for (const f of q.filters ?? []) lines.push(['filter', `only where ${f.field} ${OP_WORDS[f.op]} ${Array.isArray(f.value) ? f.value.join(', ') : f.value}`]);
  if (q.range) lines.push(['range', `started from ${q.range.from} up to ${q.range.to}`]);
  if (q.group_by?.length) lines.push(['group_by', `one line per ${q.group_by.map((g) => g.replace('_', ' ')).join(' then ')}`]);
  lines.push(['metrics', q.metrics.map((m) => METRIC_WORDS[m]).join('; ')]);
  return lines;
}

export type Ctx = { stmt: (d: Deal) => Statement; cpName: (d: Deal) => string; checking?: (d: Deal) => boolean };
export type Agg = { count: number; sums: Sums; pct: { avg: number; n: number } | null; recovered: Money[]; stmt: Record<StatementKey, number> };
export type Group = Agg & { key: string; label: string };
export type Result = { query: BookQuery; rows: Deal[]; groups: Group[]; all: Agg };

function fieldOf(d: Deal, f: Field): string {
  return f === 'kind' ? d.kind : f === 'state' ? stateKey(d) : d.counterparty;
}
function matches(d: Deal, f: Filter): boolean {
  const a = fieldOf(d, f.field);
  if (f.op === 'in') return Array.isArray(f.value) && f.value.includes(a);
  const v = Array.isArray(f.value) ? f.value[0] : f.value;
  return f.op === 'eq' ? a === v : a !== v;
}

export const isRecovered = (d: Deal): boolean => (d.kind === 'rescue' || d.kind === 'invoice') && isSettled(d) && d.mode === 'sandbox';

export function aggregate(rows: readonly Deal[], ctx: Ctx): Agg {
  const pcts = rows.map(vsMedianPct).filter((p): p is number => p !== null);
  return {
    count: rows.length,
    sums: sums(rows, ctx.checking),
    pct: pcts.length ? { avg: Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length), n: pcts.length } : null,
    recovered: sumByCurrency(rows.filter(isRecovered).map(dealTotal)),
    stmt: statementCounts(rows, ctx.stmt),
  };
}

/** A status as a line label: the plain word, with the self-releasing hold told apart from yours. */
export const stateGroupLabel = (s: DealState, side?: Deal['side'], kind?: Deal['kind']): string => (s === 'AUTO_VOIDED' ? 'Hold released by itself' : stateWord(s, { side, kind }).text);

/** The Book's key for a deal's state, as Rust's book_query reads it (book.rs `STATE`): a RECEIPTED
 *  deal that is only the seller's word is `RECEIPTED:buyer`, so a filter on the paid states leaves
 *  it out and it gets a line of its own. */
export const stateKey = (d: Pick<Deal, 'state' | 'side' | 'kind'>): string => (sellerSaysOnly(d) ? 'RECEIPTED:buyer' : d.state);
/** The label of a state line Rust's book_query answered: `RECEIPTED:buyer` reads "Seller says paid". */
export const serverStateLabel = (key: string): string =>
  stateGroupLabel(key.replace(/:buyer$/, '') as DealState, key.endsWith(':buyer') ? 'buyer' : undefined);

const DECIDED_GROUP: Record<ReturnType<typeof decidedBy>['who'], string> = { policy: 'policy (a rule you signed)', you: 'you', default: 'safe default', none: 'no decision recorded' };

function groupKey(d: Deal, g: GroupBy, ctx: Ctx): [string, string] {
  switch (g) {
    case 'kind': return [String(KIND_ORDER.indexOf(d.kind)).padStart(2, '0'), kindLabel(d.kind)];
    case 'state': return [stateKey(d), stateGroupLabel(d.state, d.side, d.kind)];
    case 'day': { const k = dayKey(d); return [k ?? '9999', dayLabel(k)]; }
    case 'counterparty': return [ctx.cpName(d), ctx.cpName(d)];
    case 'decided_by': { const f = decidedBy(d); return [f.who, DECIDED_GROUP[f.who]]; }
  }
}

/** Run a lens over the rows the window already holds. Read-only by construction. */
export function runQuery(q: BookQuery, deals: readonly Deal[], ctx: Ctx): Result {
  let rows = q.view === 'reconciliation' ? deals.filter((d) => !!d.paypal.capture) : [...deals];
  rows = rows.filter((d) => (q.filters ?? []).every((f) => matches(d, f)));
  if (q.range) {
    const from = Date.parse(q.range.from) / 1000;
    const to = Date.parse(q.range.to) / 1000;
    rows = rows.filter((d) => d.created_at !== undefined && d.created_at >= from && d.created_at < to);
  }
  const gb = q.group_by ?? [];
  const groups: Group[] = [];
  if (gb.length) {
    const map = new Map<string, { label: string; rows: Deal[] }>();
    for (const d of rows) {
      const parts = gb.map((g) => groupKey(d, g, ctx));
      const key = parts.map((p) => p[0]).join('|');
      const e = map.get(key) ?? { label: parts.map((p) => p[1]).join(' · '), rows: [] };
      e.rows.push(d);
      map.set(key, e);
    }
    const ordered = gb[0] === 'kind' || gb[0] === 'day' ? [...map.entries()].sort(([a], [b]) => a.localeCompare(b)) : [...map.entries()].sort(([, a], [, b]) => b.rows.length - a.rows.length || a.label.localeCompare(b.label));
    for (const [key, e] of ordered) groups.push({ key, label: e.label, ...aggregate(e.rows, ctx) });
  }
  return { query: q, rows, groups, all: aggregate(rows, ctx) };
}

// ---- CSV ---------------------------------------------------------------------------------------------

/** Exact decimal text for minor units ("90.00"), no floats. */
export function decimal(minor: number, currency: Currency): string {
  const exp = exponent(currency);
  const neg = minor < 0;
  const digits = Math.abs(Math.trunc(minor)).toString().padStart(exp + 1, '0');
  const body = exp ? `${digits.slice(0, -exp)}.${digits.slice(-exp)}` : digits;
  return neg ? `-${body}` : body;
}

/** One CSV cell, formula-safe (a leading = + - @ is neutralised) and quoted when needed. */
export function csvCell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export type CsvCtx = Ctx & { label: (d: Deal) => string };

/** Every exported record carries its mode. */
export function toCSV(rows: readonly Deal[], ctx: CsvCtx, query: string): string {
  const head = ['mode', 'deal', 'day', 'kind', 'side', 'counterparty', 'item', 'money_state', 'amount', 'currency', 'state', 'paypal_statement', 'paypal_order', 'paypal_capture', 'query'];
  const lines = [head.join(',')];
  for (const d of rows) {
    const t = dealTotal(d);
    lines.push([d.mode, ctx.label(d), dayKey(d) ?? '', d.kind, d.side, ctx.cpName(d), d.terms.item_ref, bucketOf(d), decimal(t.minor, t.currency), t.currency, d.state,
      STATEMENT_SHORT[ctx.stmt(d)], d.paypal.order ?? '', d.paypal.capture ?? '', query].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

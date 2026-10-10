// Round 2 (experiment r2-book): the pure numbers behind "Where the money went", the "PayPal agrees"
// meter, the question chips and the "Why?" on each total. No React, no IPC, display only.
//
// Rules the tests pin down:
//  - money is never added across currencies, and never across directions (money out and money in
//    are separate rows);
//  - stopped money is a figure of its own and is never part of "paid" or "on hold";
//  - a replay is not recovered money: a rescue only counts as paid when it is not a replay;
//  - an unknown statement is never counted as "on statement".
import type { Currency } from '@bindings/Currency';
import type { Deal } from '@bindings/Deal';
import type { DealKind } from '@bindings/DealKind';
import type { Money } from '@bindings/Money';
import { formatMinor } from '../../../../lib/format';
import { stateWord } from '../../../../lib/words';
import { dealTotal } from '../../logic';
import { bucketOf, dirOf, isRecovered, LENSES, STATEMENT_WORD, statementEnded, UNCONFIRMED_STATEMENT_WORD, type Bucket, type Dir, type Statement } from './model';

// ---- where the money went --------------------------------------------------------------------------

export type BarKind = 'haggle' | 'purchase' | 'shop_order' | 'rescue';
export const BAR_KINDS: readonly BarKind[] = ['haggle', 'purchase', 'shop_order', 'rescue'];
export const BAR_KIND_NAME: Record<BarKind, string> = { haggle: 'Haggles', purchase: 'Purchases', shop_order: 'Shop orders', rescue: 'Rescues' };

/** A rescue's invoice is part of the rescue (the "Rescued money" view reads both together). */
export const barKindOf = (k: DealKind): BarKind => (k === 'invoice' ? 'rescue' : k);

export type Flow = 'paid' | 'held' | 'stopped';
export const FLOWS: readonly Flow[] = ['paid', 'held', 'stopped'];
export const FLOW_WORD: Record<Flow, string> = { paid: 'paid', held: 'on hold', stopped: 'stopped' };

/** Which of the three drawn segments a deal belongs to; null while nothing has been paid, held or stopped. */
export function flowOf(d: Deal): Flow | null {
  const b: Bucket = bucketOf(d);
  if (b === 'captured') return barKindOf(d.kind) === 'rescue' && !isRecovered(d) ? null : 'paid';
  if (b === 'held') return 'held';
  if (b === 'stopped') return 'stopped';
  return null;
}

export type BarRow = {
  key: string; kind: BarKind; dir: Dir; currency: Currency;
  /** Minor units per segment. */
  minor: Record<Flow, number>;
  /** Deals per segment. */
  n: Record<Flow, number>;
  /** Deals of this row that are still in progress (not drawn). */
  open: number;
  /** Replays that were paid in a rescue row: shown as a note, never counted as recovered. */
  replays: number;
  total: number;
};
export type BarChart = { currency: Currency; rows: BarRow[]; max: number };

/** One chart per currency; one row per kind and direction in it. Replays never count as recovered. */
export function whereTheMoneyWent(deals: readonly Deal[]): BarChart[] {
  const rows = new Map<string, BarRow>();
  for (const d of deals) {
    const kind = barKindOf(d.kind);
    if (!BAR_KINDS.includes(kind)) continue;
    const t = dealTotal(d);
    const dir = dirOf(d);
    const key = `${t.currency}|${kind}|${dir}`;
    const row = rows.get(key) ?? { key, kind, dir, currency: t.currency, minor: { paid: 0, held: 0, stopped: 0 }, n: { paid: 0, held: 0, stopped: 0 }, open: 0, replays: 0, total: 0 };
    const f = flowOf(d);
    if (f) { row.minor[f] += t.minor; row.n[f]++; }
    else if (bucketOf(d) === 'captured') row.replays++;
    else if (bucketOf(d) !== 'unconfirmed') row.open++;
    rows.set(key, row);
  }
  const by = new Map<Currency, BarRow[]>();
  for (const r of rows.values()) {
    r.total = r.minor.paid + r.minor.held + r.minor.stopped;
    // A row with nothing drawn and nothing noted adds no information.
    if (!r.total && !r.open && !r.replays) continue;
    by.set(r.currency, [...(by.get(r.currency) ?? []), r]);
  }
  const order = (r: BarRow) => BAR_KINDS.indexOf(r.kind) * 2 + (r.dir === 'out' ? 0 : 1);
  return [...by.entries()].map(([currency, rs]) => {
    const sorted = rs.sort((a, b) => order(a) - order(b));
    return { currency, rows: sorted, max: Math.max(0, ...sorted.map((r) => r.total)) };
  }).sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Percent of the chart's longest bar; exact, never rounded up. */
export const sharePct = (minor: number, max: number): number => (max > 0 ? (minor * 100) / max : 0);

/** "Purchases · money out" */
export const rowName = (r: Pick<BarRow, 'kind' | 'dir'>): { name: string; dir: string } => ({ name: BAR_KIND_NAME[r.kind], dir: r.dir === 'out' ? 'money out' : 'money in' });

/** The one-sentence summary of a row for screen readers and the table fallback. Stopped is said as never moved. */
export function rowSummary(r: BarRow): string {
  const { name, dir } = rowName(r);
  const parts = FLOWS.filter((f) => r.minor[f] > 0).map((f) => `${formatMinor(r.minor[f], r.currency)} ${FLOW_WORD[f]}${f === 'stopped' ? ' (never counted as moved)' : ''}`);
  return `${name}, ${dir}, ${r.currency}: ${parts.length ? parts.join(', ') : 'nothing paid, held or stopped'}`;
}

export function chartSummary(c: BarChart): string {
  return `Where the money went, in ${c.currency}. ${c.rows.map(rowSummary).join('. ')}.`;
}

export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Deals that are not drawn because nothing has been paid, held or stopped yet. */
export function inProgressCount(charts: readonly BarChart[]): number {
  return charts.reduce((a, c) => a + c.rows.reduce((b, r) => b + r.open, 0), 0);
}

// ---- PayPal agrees -----------------------------------------------------------------------------------

export type Agreement = {
  /** Payments that needed a place on PayPal's statement (everything except "no payment"). */
  needed: number;
  matched: number; notYet: number; differs: number; unknown: number;
  /** Deals that ended UNCONFIRMED with no match on the statement: an end, never counted as not yet. */
  unconfirmed: number;
  /** Still reading the statement for some deals. */
  loading: boolean;
};

/** stmt returns null while the proof is still being read. Unknown is its own count and never matched. */
export function agreement(deals: readonly Deal[], stmt: (d: Deal) => Statement | null): Agreement {
  const a: Agreement = { needed: 0, matched: 0, notYet: 0, differs: 0, unknown: 0, unconfirmed: 0, loading: false };
  for (const d of deals) {
    const s = stmt(d);
    if (s === null) { a.loading = true; continue; }
    if (s === 'not_applicable') continue;
    a.needed++;
    if (s === 'matched') a.matched++;
    else if (statementEnded(s, d.state)) a.unconfirmed++;
    else if (s === 'pending_reporting') a.notYet++;
    else if (s === 'mismatch') a.differs++;
    else a.unknown++;
  }
  return a;
}

/** A payment not on the statement. `unconfirmed`: the deal ended UNCONFIRMED with no match; it
 *  stays a gap, because money may have left and a statement check can still find it, but it is
 *  an end listed after the differences and before every wait, never as "not yet". */
export type Gap = { deal: Deal; statement: 'mismatch' | 'unconfirmed' | 'unknown' | 'pending_reporting' };
const GAP_ORDER: Record<Gap['statement'], number> = { mismatch: 0, unconfirmed: 1, unknown: 2, pending_reporting: 3 };
/** A gap's word on the meter's list. */
export const GAP_WORD: Record<Gap['statement'], string> = { mismatch: STATEMENT_WORD.mismatch, unconfirmed: UNCONFIRMED_STATEMENT_WORD, unknown: STATEMENT_WORD.unknown, pending_reporting: STATEMENT_WORD.pending_reporting };

/** The payments that are not on the statement (yet): the exceptions behind the meter, differences first. */
export function agreementGaps(deals: readonly Deal[], stmt: (d: Deal) => Statement | null): Gap[] {
  const gaps: Gap[] = [];
  for (const d of deals) {
    const s = stmt(d);
    if (statementEnded(s, d.state)) gaps.push({ deal: d, statement: 'unconfirmed' });
    else if (s === 'mismatch' || s === 'unknown' || s === 'pending_reporting') gaps.push({ deal: d, statement: s });
  }
  return gaps.sort((a, b) => GAP_ORDER[a.statement] - GAP_ORDER[b.statement]);
}

/** "4 of 5": the figure that leads the meter. */
export const agreeFigure = (a: Agreement): string => `${a.matched} of ${a.needed}`;

/** The meter's one line under the figure: what is missing, in words; never says "all" while something is unknown. */
export function agreeLine(a: Agreement): string {
  if (!a.needed) return 'No payment has needed a place on the statement yet.';
  const rest = [
    a.notYet ? `${a.notYet} not there yet` : '',
    a.differs ? `${a.differs} ${a.differs === 1 ? 'differs' : 'differ'}` : '',
    a.unconfirmed ? `${a.unconfirmed} not confirmed by PayPal` : '',
    a.unknown ? `${a.unknown} couldn’t be checked` : '',
  ].filter(Boolean);
  if (!rest.length) return 'Every one is on the statement. Nothing differs.';
  return `${rest.join(', ')}.`;
}

/** The two sentences behind "Why?" on the meter. Only the 3-hour lag and the counts on screen. */
export function agreeWhy(a: Agreement, checkedAt: string | null): [string, string] {
  const first = 'PayPal’s own statement can take up to 3 hours to show a payment, so a new payment reads “not yet” even when it went through.';
  const bits = [
    a.notYet ? `${plural(a.notYet, 'payment is', 'payments are')} waiting for the statement` : '',
    a.differs ? `${plural(a.differs, 'shows', 'show')} a different amount or payment on the statement, which is a real difference to look at` : '',
    a.unconfirmed ? `${plural(a.unconfirmed, 'deal', 'deals')} ended not confirmed by PayPal: the seller said paid, and this wallet has no match on the statement` : '',
    a.unknown ? `${plural(a.unknown, 'payment', 'payments')} couldn’t be read, so ${a.unknown === 1 ? 'it is' : 'they are'} not counted as matched` : '',
  ].filter(Boolean);
  const second = `${bits.length ? `Right now ${bits.join('; ')}.` : `Right now ${a.matched} of ${a.needed} are on it and nothing differs.`}${checkedAt ? ` Last checked ${checkedAt}.` : ''}`;
  return [first, second];
}

// ---- Why on each total ---------------------------------------------------------------------------------

export type TotalKey = 'out' | 'in' | 'held' | 'stopped';

const money = (ms: readonly Money[]) => ms.map((m) => formatMinor(m.minor, m.currency)).join(' · ');

/** Two deterministic sentences for one of the four totals, from the deals themselves. */
export function totalWhy(key: TotalKey, deals: readonly Deal[]): [string, string] {
  const inB = (b: Bucket, dir?: Dir) => deals.filter((d) => bucketOf(d) === b && (!dir || dirOf(d) === dir));
  const sum = (ds: readonly Deal[]): Money[] => {
    const by = new Map<Currency, number>();
    for (const d of ds) { const t = dealTotal(d); by.set(t.currency, (by.get(t.currency) ?? 0) + t.minor); }
    return [...by.entries()].map(([currency, minor]) => ({ currency, minor }));
  };
  const NOUN: Record<BarKind, [string, string]> = { haggle: ['haggle', 'haggles'], purchase: ['purchase', 'purchases'], shop_order: ['shop order', 'shop orders'], rescue: ['rescue', 'rescues'] };
  /** "1 haggle ($212.00) and 2 purchases ($83.00)": the deals behind a total, kind by kind. */
  const byKind = (ds: readonly Deal[]): string => {
    const parts = BAR_KINDS.map((k) => ({ k, xs: ds.filter((d) => barKindOf(d.kind) === k) })).filter((g) => g.xs.length)
      .map((g) => `${g.xs.length} ${NOUN[g.k][g.xs.length === 1 ? 0 : 1]} (${money(sum(g.xs))})`);
    return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] ?? '';
  };
  if (key === 'out' || key === 'in') {
    const ds = inB('captured', key === 'out' ? 'out' : 'in');
    if (!ds.length) return [key === 'out' ? 'No payment you made has been completed yet.' : 'No payment to you has been completed yet.', 'Money on hold or only agreed is not counted until it is paid.'];
    return key === 'out'
      ? [`${plural(ds.length, 'payment', 'payments')} you made ${ds.length === 1 ? 'is' : 'are'} complete: ${byKind(ds)}.`, 'Money on hold, or only agreed, is not in this figure until it is paid.']
      : [`${plural(ds.length, 'payment', 'payments')} to you ${ds.length === 1 ? 'is' : 'are'} complete: ${byKind(ds)}.`, 'An order waiting for the buyer to approve is not in this figure until it is paid.'];
  }
  if (key === 'held') {
    const ds = inB('held');
    if (!ds.length) return ['PayPal is not holding any money aside right now.', 'A hold is not a payment; it only appears here while PayPal keeps the money aside.'];
    return [`PayPal is keeping ${money(sum(ds))} aside for ${plural(ds.length, 'payment', 'payments')}: ${byKind(ds)}.`, 'It is not paid until it is collected; if you do nothing the hold is released and nothing is paid.'];
  }
  const ds = inB('stopped');
  if (!ds.length) return ['Nothing was stopped this week.', 'Stopped money is shown struck through because it never moved, so it is never counted as paid.'];
  const why = new Map<string, number>();
  for (const d of ds) { const w = stateWord(d.state, { side: d.side, kind: d.kind }).text.toLowerCase(); why.set(w, (why.get(w) ?? 0) + 1); }
  const breakdown = [...why.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([w, n]) => `${n} ${w}`).join(', ');
  return [
    `${money(sum(ds))} is shown struck through because it never moved to anyone (or came back), so it is never counted as paid.`,
    `What stopped ${ds.length === 1 ? 'it' : 'them'}: ${breakdown}.`,
  ];
}

// ---- question chips -----------------------------------------------------------------------------------

/** Each quick view in plain words, one question per view. The quick view's own short name stays in the tooltip. */
export const QUESTION_WORDS: Record<string, string> = {
  week: 'Did my agents pay fair prices?',
  pending: 'Did PayPal record everything?',
  decided: 'Who decided: my rules or me?',
  day: 'What happened each day?',
  stopped: 'What was stopped, and why?',
  mismatch: 'Did any amount not match the deal?',
  rescue: 'How much did rescues bring back?',
};

export type QuestionChip = { id: string; text: string; view: string; unavailable?: string };

/** Exactly one chip per quick view, in the quick views' order. */
export const questionChips = (): QuestionChip[] => LENSES.map((l) => ({ id: l.id, text: QUESTION_WORDS[l.id] ?? l.question, view: l.short, unavailable: l.unavailable }));


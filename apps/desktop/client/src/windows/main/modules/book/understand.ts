// "Ask in your own words": the wallet's own reading of a typed question into the closed BookQuery.
// Pure and deterministic: a fixed word list, no model, no network, no IO. Tested in understand.test.ts.
//
// Every word must be read or be a filler word; anything else comes back as "unsure" with the words
// that were not understood, never a guess. Only what the closed BookQuery can say is built: a time
// range, the four metrics, up to two groupings, and filters on kind, state and counterparty.
// Counterparty names are matched as plain text against the known list (never interpreted, never
// followed); a name that is not on the list is just an unknown word. The money direction (out or
// in) is not a BookQuery field, so "spent" and "came in" both read as "Paid" and the answer keeps
// money out and money in on their own lines.
import type { BookGroup } from '@bindings/BookGroup';
import type { BookMetric } from '@bindings/BookMetric';
import type { BookQuery } from '@bindings/BookQuery';
import type { BookRange } from '@bindings/BookRange';
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import type { DealKind } from '@bindings/DealKind';
import type { DealState } from '@bindings/DealState';
import type { BookQuery as LensQuery, Filter, Lens } from './model';
import { bookRejection, rfc3339Seconds } from './rules';
import { houseWords } from '../../../../lib/words';

/** The longest question the wallet reads. */
export const MAX_ASK = 200;
const DAY = 86_400;

// ---- context and results ----------------------------------------------------------------------------

/** A counterparty the owner knows: its key, the name shown, and the names it may be asked by. */
export type KnownParty = { key: string; name: string; aliases: readonly string[] };
/** `now` in seconds; `offsetMin` = the owner's UTC offset in minutes (east positive). */
export type AskCtx = { now: number; offsetMin: number; parties: readonly KnownParty[] };

export type When =
  | { k: 'any' } | { k: 'today' } | { k: 'yesterday' } | { k: 'this_week' } | { k: 'last_week' }
  | { k: 'this_month' } | { k: 'last_month' } | { k: 'this_year' }
  | { k: 'days'; n: number } | { k: 'since'; wd: number } | { k: 'on'; wd: number } | { k: 'month'; m: number };

export type Slot = 'measure' | 'view' | 'status' | 'kind' | 'who' | 'when' | 'group';
export type Part = { metrics?: BookMetric[]; states?: DealState[]; kinds?: DealKind[]; party?: string; when?: When; group?: BookGroup; view?: 'reconciliation' };
/** One piece of the reading, shown as a chip; removing it removes exactly its part. */
export type ReadingChip = { id: string; slot: Slot; text: string; title: string; part: Part };
export type Understood = { query: BookQuery; reading: ReadingChip[] };
export type UnsureWhy = 'words' | 'too_long' | 'empty' | 'nothing' | 'two_times' | 'too_many_groups';
export type Unsure = { unsure: string[]; why: UnsureWhy };
export type Understanding = Understood | Unsure;
export const isUnsure = (u: Understanding): u is Unsure => 'unsure' in u;

/** Phrasings that always read, offered when a question did not. */
export const SUGGESTIONS: readonly string[] = [
  'How much was paid this week, by shop?',
  'What is on hold right now?',
  'How many deals were stopped last week?',
];

// ---- chips --------------------------------------------------------------------------------------------

const PAID: DealState[] = ['CAPTURED', 'RECEIPTED', 'RECONCILED'];
const STOPPED: DealState[] = ['REFUSED', 'VOIDED', 'AUTO_VOIDED', 'WITHDRAWN', 'EXPIRED', 'MISMATCH'];
const MOVING: DealState[] = ['PAIRING', 'LISTED', 'NEGOTIATING', 'AGREED', 'SETTLING', 'AWAITING_APPROVAL', 'APPROVED'];

const chip = (id: string, slot: Slot, text: string, title: string, part: Part): ReadingChip => ({ id, slot, text, title, part });

const CHIPS = {
  count: chip('m:count', 'measure', 'How many', 'Counts the deals', { metrics: ['count'] }),
  amount: chip('m:amount', 'measure', 'Amounts', 'Adds up the amounts, each currency on its own line', { metrics: ['sum_amount'] }),
  market: chip('m:market', 'measure', 'Price vs market', 'How far prices sit from the typical market price, on average', { metrics: ['avg_vs_market_pct'] }),
  recovered: chip('m:recovered', 'measure', 'Recovered by rescues', 'Rescue money that was really paid; practice runs never count', { metrics: ['recovered_sum'], kinds: ['rescue'] }),
  statement: chip('v:statement', 'view', 'Checked on your PayPal statement', 'Only payments looked up on PayPal’s own statement', { view: 'reconciliation' }),
  paid: chip('s:paid', 'status', 'Paid', 'Money that moved. Money out and money in stay on their own lines.', { states: PAID }),
  held: chip('s:held', 'status', 'On hold', 'Held at PayPal, not paid yet', { states: ['AUTHORIZED'] }),
  stopped: chip('s:stopped', 'status', 'Stopped', 'Refused, withdrawn, expired, released or didn’t match: never paid', { states: STOPPED }),
  refused: chip('s:refused', 'status', 'Refused', 'Refused by a rule or a check', { states: ['REFUSED'] }),
  refunded: chip('s:refunded', 'status', 'Refunded', 'Paid, then paid back', { states: ['REFUNDED'] }),
  mismatch: chip('s:mismatch', 'status', 'Amount didn’t match', 'The payment request did not match what was agreed', { states: ['MISMATCH'] }),
  moving: chip('s:moving', 'status', 'In progress', 'Still being worked out; nothing paid yet', { states: MOVING }),
  failed: chip('s:failed', 'status', 'Failed', 'A payment or renewal that failed', { states: ['FAILED'] }),
  disputed: chip('s:disputed', 'status', 'Disputed', 'A payment someone disputed', { states: ['DISPUTED'] }),
  haggle: chip('k:haggle', 'kind', 'Haggles', 'Only haggles', { kinds: ['haggle'] }),
  purchase: chip('k:purchase', 'kind', 'Purchases', 'Only purchases', { kinds: ['purchase'] }),
  shop_order: chip('k:shop_order', 'kind', 'Shop orders', 'Only orders from your shop', { kinds: ['shop_order'] }),
  rescue: chip('k:rescue', 'kind', 'Rescues', 'Only rescued renewals', { kinds: ['rescue'] }),
  invoice: chip('k:invoice', 'kind', 'Invoices', 'Only invoices', { kinds: ['invoice'] }),
} as const;

export const GROUP_TEXT: Record<BookGroup, string> = { day: 'By day', counterparty: 'By shop or customer', kind: 'By kind of deal', state: 'By status', decided_by: 'By who decided' };
const GROUP_TITLE: Record<BookGroup, string> = {
  day: 'One line per day', counterparty: 'One line per shop, payee or customer', kind: 'One line per kind of deal (each agent works one kind)',
  state: 'One line per status', decided_by: 'One line per decision: you, a rule you signed, or the safe default',
};
export const GROUP_CHOICES: readonly BookGroup[] = ['day', 'counterparty', 'kind', 'state', 'decided_by'];
export const groupChip = (g: BookGroup): ReadingChip => chip(`g:${g}`, 'group', GROUP_TEXT[g], GROUP_TITLE[g], { group: g });

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WD_TEXT = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_TEXT = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function whenText(w: When): string {
  switch (w.k) {
    case 'any': return 'Any time';
    case 'today': return 'Today';
    case 'yesterday': return 'Yesterday';
    case 'this_week': return 'This week';
    case 'last_week': return 'Last week';
    case 'this_month': return 'This month';
    case 'last_month': return 'Last month';
    case 'this_year': return 'This year';
    case 'days': return `Last ${w.n} days`;
    case 'since': return `Since ${WD_TEXT[w.wd]}`;
    case 'on': return `On ${WD_TEXT[w.wd]}`;
    case 'month': return MONTH_TEXT[w.m] ?? 'That month';
  }
}
const whenId = (w: When): string => `t:${w.k}${'n' in w ? w.n : 'wd' in w ? w.wd : 'm' in w ? w.m : ''}`;
/** The time chip; its title spells out the dates it covers. */
export function whenChip(w: When, ctx: Pick<AskCtx, 'now' | 'offsetMin'>): ReadingChip {
  const r = whenRange(w, ctx);
  return chip(whenId(w), 'when', whenText(w), r ? spanWords(r, ctx.offsetMin) : 'Everything on record', { when: w });
}
export const WHEN_CHOICES: readonly When[] = [
  { k: 'any' }, { k: 'today' }, { k: 'yesterday' }, { k: 'this_week' }, { k: 'last_week' }, { k: 'days', n: 7 }, { k: 'days', n: 30 }, { k: 'this_month' }, { k: 'last_month' }, { k: 'this_year' },
];

// ---- time ranges (the owner's local calendar, computed from now and the UTC offset) ----------------------

const iso = (sec: number): string => new Date(sec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
/** [from, to) in seconds for a reading, or null for any time. Weeks start on Monday. */
export function whenSpan(w: When, { now, offsetMin }: Pick<AskCtx, 'now' | 'offsetMin'>): [number, number] | null {
  const off = offsetMin * 60;
  const local = now + off;
  const d0 = Math.floor(local / DAY) * DAY - off; // today's local midnight, as UTC seconds
  const wd = new Date((local - (((local % DAY) + DAY) % DAY)) * 1000).getUTCDay();
  const mon = d0 - ((wd + 6) % 7) * DAY;
  const t = new Date(local * 1000);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const monthStart = (yy: number, mm: number) => Date.UTC(yy, mm, 1) / 1000 - off;
  switch (w.k) {
    case 'any': return null;
    case 'today': return [d0, d0 + DAY];
    case 'yesterday': return [d0 - DAY, d0];
    case 'this_week': return [mon, mon + 7 * DAY];
    case 'last_week': return [mon - 7 * DAY, mon];
    case 'this_month': return [monthStart(y, m), monthStart(y, m + 1)];
    case 'last_month': return [monthStart(y, m - 1), monthStart(y, m)];
    case 'this_year': return [monthStart(y, 0), monthStart(y + 1, 0)];
    case 'days': return [d0 - (w.n - 1) * DAY, d0 + DAY];
    case 'since': return [d0 - ((wd - w.wd + 7) % 7) * DAY, d0 + DAY];
    case 'on': { const s = d0 - ((wd - w.wd + 7) % 7) * DAY; return [s, s + DAY]; }
    case 'month': { const yy = w.m > m ? y - 1 : y; return [monthStart(yy, w.m), monthStart(yy, w.m + 1)]; }
  }
}
export function whenRange(w: When, ctx: Pick<AskCtx, 'now' | 'offsetMin'>): BookRange | null {
  const s = whenSpan(w, ctx);
  return s ? { from: iso(s[0]), to: iso(s[1]) } : null;
}
/** "Mon 5 Oct to Sun 11 Oct" in the owner's calendar (the end is exclusive, so the last day shown is the day before). */
function spanWords(r: BookRange, offsetMin: number): string {
  const day = (sec: number) => new Date((sec + offsetMin * 60) * 1000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const from = rfc3339Seconds(r.from) ?? 0;
  const to = (rfc3339Seconds(r.to) ?? 0) - 1;
  return day(from) === day(to) ? day(from) : `${day(from)} to ${day(to)}`;
}

// ---- the word list -----------------------------------------------------------------------------------------

type Entry = { chip: ReadingChip } | { when: When } | { group: BookGroup } | { skip: true } | { unsupported: true };

const STOP = new Set([
  'a', 'an', 'the', 'of', 'for', 'in', 'on', 'at', 'to', 'from', 'with', 'by', 'and', 'or', '&', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'has', 'have', 'had', 'do', 'does', 'did', 'done', 'doing', 'what', 'whats', "what's", 'which', 'where', "where's", 'when', 'how', "how's", 'why',
  'i', "i've", "i'm", 'me', 'my', 'mine', 'myself', 'we', 'our', 'us', 'you', 'your', 'it', "it's", 'its', 'this', 'that', 'these', 'those', 'there', "there's", 'here',
  'then', 'than', 'so', 'far', 'yet', 'still', 'up', 'out', 'into', 'about', 'all', 'any', 'some', 'each', 'every', 'please', 'show', 'tell', 'give',
  'list', 'see', 'find', 'get', 'gets', 'got', 'let', 'know', 'can', 'could', 'would', 'will', 'should', 'just', 'only', 'also', 'now', 'right', 'currently',
  'current', 'agent', 'agents', 'deal', 'deals', 'payment', 'payments', 'transaction', 'transactions', 'thing', 'things', 'stuff', 'go', 'went', 'gone',
  'going', 'make', 'made', 'happen', 'happened', 'much', 'many', 'paypal', 'wallet', 'book', 'altogether', 'together', 'break', 'down', 'broken', 'split',
  'grouped', 'group', 'per', 'compared', 'them', 'they', 'their', 'as', 'like', 'number', 'kind', 'kinds', 'type', 'types', 'time', 'day', 'days', 'look',
  'check', 'been', 'whole', 'entire', 'everything', 'anything', 'something', 'ok', 'okay', 'did', "didn't", 'not', 'no', 'yes', 'please', 'thanks', 'via', 'since', 'during',
]);

function entries(): Array<[string, Entry]> {
  const e: Array<[string, Entry]> = [];
  const add = (ps: string[], x: Entry) => { for (const p of ps) e.push([p, x]); };
  const c = (k: keyof typeof CHIPS) => ({ chip: CHIPS[k] });
  add(['how many', 'number of', 'count', 'how often'], c('count'));
  add(['how much', 'total', 'totals', 'amount', 'amounts', 'sum', 'money', 'value', 'cost', 'costs'], c('amount'));
  add(['vs market', 'vs the market', 'versus market', 'versus the market', 'compared with the market', 'compared to the market', 'compared with market',
    'compared to market', 'against the market', 'against market', 'market', 'market price', 'market prices', 'average price', 'average prices', 'avg price',
    'typical price', 'good deal', 'good deals', 'overpaid', 'overpay'], c('market'));
  add(['recovered', 'recover', 'rescued money', 'brought back', 'bring back', 'won back', 'win back', 'recovered money'], c('recovered'));
  add(['statement', 'paypal statement', 'paypal agree', 'paypal agrees', 'does paypal agree', 'reconciled', 'reconciliation'], c('statement'));
  add(['paid', 'pay', 'paid out', 'pay out', 'payout', 'payouts', 'spent', 'spend', 'spending', 'spends', 'received', 'receive', 'came in', 'come in',
    'coming in', 'went out', 'gone out', 'going out', 'earned', 'earn', 'earnings', 'income', 'collected', 'got paid', 'paid in', 'settled', 'captured'], c('paid'));
  add(['on hold', 'held', 'hold', 'holds', 'holding', 'authorized', 'authorised', 'set aside', 'reserved'], c('held'));
  add(['stopped', 'stop', 'stops', 'cancelled', 'canceled', 'cancel', 'voided', 'void', 'released', 'withdrawn', 'expired', 'lapsed', 'never paid',
    "didn't go through", 'did not go through', 'fell through', 'not paid'], c('stopped'));
  add(['refused', 'turned down', 'rejected', 'blocked', 'declined', 'denied'], c('refused'));
  add(['refunded', 'refund', 'refunds', 'paid back', 'money back', 'gave back'], c('refunded'));
  add(["didn't match", 'did not match', 'mismatch', 'mismatched', 'mismatches', 'wrong amount', 'wrong amounts', "amounts that didn't match"], c('mismatch'));
  add(['in progress', 'pending', 'open', 'ongoing', 'waiting', 'still going', 'not finished', 'unfinished'], c('moving'));
  add(['failed', 'failing', 'failures', 'fail'], c('failed'));
  add(['disputed', 'dispute', 'disputes'], c('disputed'));
  add(['haggle', 'haggles', 'haggled', 'haggling', 'negotiation', 'negotiations', 'negotiated', 'bargain', 'bargains', 'bargaining'], c('haggle'));
  add(['purchase', 'purchases', 'purchased', 'bought', 'buy', 'buys', 'buying'], c('purchase'));
  add(['shop order', 'shop orders', 'order', 'orders', 'shop sale', 'shop sales'], c('shop_order'));
  add(['rescue', 'rescues', 'renewal', 'renewals'], c('rescue'));
  add(['invoice', 'invoices', 'invoiced'], c('invoice'));
  add(['by day', 'per day', 'each day', 'every day', 'daily', 'day by day', 'by date', 'per date', 'each date'], { group: 'day' });
  add(['by shop', 'per shop', 'each shop', 'by shops', 'by payee', 'per payee', 'by payees', 'each payee', 'by seller', 'by sellers', 'per seller',
    'by buyer', 'by buyers', 'by customer', 'by customers', 'per customer', 'by supplier', 'by suppliers', 'per supplier', 'by merchant', 'by counterparty',
    'per counterparty', 'by who', 'by whom', 'to whom', 'with whom', 'who with', 'who', 'whom', 'each person', 'by person', 'by name'], { group: 'counterparty' });
  add(['by kind', 'by type', 'by kind of deal', 'by type of deal', 'per kind', 'per type', 'by agent', 'per agent', 'each agent', 'by agents', 'by role'], { group: 'kind' });
  add(['by status', 'per status', 'by state', 'by outcome', 'by result'], { group: 'state' });
  add(['who decided', 'by who decided', 'decided by', 'by decision', 'my rules vs me', 'rules vs me', 'me vs my rules', 'my rules or me', 'rules or me',
    'by rule', 'by rules', 'by my rules', 'policy vs me', 'rules decided', 'my rules decided', 'rules decide', 'my rules decide', 'on their own',
    'on its own', 'by itself', 'by themselves'], { group: 'decided_by' });
  add(['today', 'so far today'], { when: { k: 'today' } });
  add(['yesterday'], { when: { k: 'yesterday' } });
  add(['this week', 'the week', 'week', 'this past week'], { when: { k: 'this_week' } });
  add(['last week', 'previous week'], { when: { k: 'last_week' } });
  add(['past week'], { when: { k: 'days', n: 7 } });
  add(['fortnight', 'last fortnight', 'past fortnight'], { when: { k: 'days', n: 14 } });
  add(['this month', 'month', 'the month'], { when: { k: 'this_month' } });
  add(['last month', 'previous month'], { when: { k: 'last_month' } });
  add(['past month'], { when: { k: 'days', n: 30 } });
  add(['this year', 'year'], { when: { k: 'this_year' } });
  add(['all time', 'ever', 'overall', 'any time', 'anytime', 'since the start', 'since the beginning', 'on record'], { when: { k: 'any' } });
  WEEKDAYS.forEach((d, wd) => {
    add([d, `on ${d}`, `last ${d}`], { when: { k: 'on', wd } });
    add([`since ${d}`], { when: { k: 'since', wd } });
  });
  MONTHS.forEach((name, m) => {
    // "may" alone is a verb; it reads as the month only after "in" or "during".
    add(name === 'may' ? ['in may', 'during may'] : [name, `in ${name}`, `during ${name}`], { when: { k: 'month', m } });
  });
  for (const [abbr, m] of [['jan', 0], ['feb', 1], ['mar', 2], ['apr', 3], ['jun', 5], ['jul', 6], ['aug', 7], ['sep', 8], ['sept', 8], ['oct', 9], ['nov', 10], ['dec', 11]] as const) {
    add([abbr, `in ${abbr}`], { when: { k: 'month', m } });
  }
  add(['by currency', 'per currency', 'each currency'], { skip: true });
  add(['by item', 'per item', 'each item', 'by items', 'by product', 'per product', 'by products', 'by week', 'per week', 'weekly', 'each week',
    'by month', 'per month', 'monthly', 'each month', 'by hour', 'per hour', 'hourly', 'by year', 'per year', 'yearly'], { unsupported: true });
  return e;
}
const LEXICON: ReadonlyMap<string, Entry> = new Map(entries());
const MAX_PHRASE = 6;

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fourteen: 14, thirty: 30, sixty: 60, ninety: 90 };

// ---- tokens ----------------------------------------------------------------------------------------------

type Tok = { norm: string; raw: string };
const WORD = /[\p{L}\p{N}$€£&]+(?:['’\-.][\p{L}\p{N}]+)*/gu;
function tokens(text: string): Tok[] {
  return [...text.matchAll(WORD)].map((m) => {
    const raw = m[0];
    let norm = raw.toLowerCase().replace(/’/g, "'");
    if (norm.endsWith("'s")) norm = norm.slice(0, -2);
    return { norm, raw };
  });
}
const phrase = (toks: readonly Tok[]) => toks.map((t) => t.norm).join(' ');

// ---- counterparties -----------------------------------------------------------------------------------------

/** The known list as the reader matches it: names the owner sees, never a counterparty that is not
 *  connected. Each alias is plain text to compare, nothing more. */
export function knownParties(list: readonly CounterpartyDisplay[]): KnownParty[] {
  return list.filter((c) => c.pairing !== 'unpaired').map((c) => {
    const name = c.house ? houseWords(c.display_name) : c.display_name;
    const parts = name.split(/\s+·\s+/);
    const aliases = new Set<string>([name, ...parts]);
    for (const p of parts) { const m = /^(.+?)['’]s\b/.exec(p); if (m?.[1]) aliases.add(m[1]); }
    if (c.house) aliases.add('house');
    if (c.declared_payee) aliases.add(c.declared_payee);
    return { key: c.key_id, name, aliases: [...aliases] };
  });
}

/** alias phrase -> party keys. An alias made only of known words never counts as a name. */
function aliasIndex(parties: readonly KnownParty[]): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const p of parties) {
    for (const a of p.aliases) {
      const toks = tokens(a);
      const key = phrase(toks);
      if (key.length < 3 || toks.length > MAX_PHRASE || LEXICON.has(key)) continue;
      if (toks.every((t) => STOP.has(t.norm) || LEXICON.has(t.norm))) continue;
      const keys = idx.get(key) ?? [];
      if (!keys.includes(p.key)) idx.set(key, [...keys, p.key]);
    }
  }
  return idx;
}

// ---- reading ------------------------------------------------------------------------------------------------

const SLOT_ORDER: readonly Slot[] = ['measure', 'view', 'status', 'kind', 'who', 'when', 'group'];
const METRIC_ORDER: readonly BookMetric[] = ['count', 'sum_amount', 'avg_vs_market_pct', 'recovered_sum'];

/** Read a typed question. Every word is read, a filler, or reported back as not understood. */
export function understand(text: string, ctx: AskCtx): Understanding {
  if (text.length > MAX_ASK) return { unsure: [], why: 'too_long' };
  const toks = tokens(text);
  if (!toks.length) return { unsure: [], why: 'empty' };
  const names = aliasIndex(ctx.parties);
  const byKey = new Map(ctx.parties.map((p) => [p.key, p]));
  const reading: ReadingChip[] = [];
  const unknown: string[] = [];
  let read = 0;
  const push = (c: ReadingChip) => { if (!reading.some((x) => x.id === c.id)) reading.push(c); };
  for (let i = 0; i < toks.length;) {
    // "last 7 days", "past thirty days"
    const t0 = toks[i]?.norm;
    const t1 = toks[i + 1]?.norm;
    const t2 = toks[i + 2]?.norm;
    if ((t0 === 'last' || t0 === 'past' || t0 === 'previous') && t1 !== undefined && (t2 === 'days' || t2 === 'day')) {
      const n = /^\d{1,3}$/.test(t1) ? Number(t1) : NUMBER_WORDS[t1];
      if (n !== undefined && n >= 1 && n <= 366) { push(whenChip({ k: 'days', n }, ctx)); read++; i += 3; continue; }
    }
    let matched = 0;
    for (let len = Math.min(MAX_PHRASE, toks.length - i); len >= 1 && !matched; len--) {
      const slice = toks.slice(i, i + len);
      const key = phrase(slice);
      const entry = LEXICON.get(key);
      if (entry) {
        if ('chip' in entry) push(entry.chip);
        else if ('when' in entry) push(whenChip(entry.when, ctx));
        else if ('group' in entry) push(groupChip(entry.group));
        else if ('unsupported' in entry) unknown.push(slice.map((t) => t.raw).join(' '));
        if (!('unsupported' in entry)) read++;
        matched = len;
      } else {
        const keys = names.get(key);
        if (keys) {
          for (const k of keys) { const p = byKey.get(k); if (p) push(chip(`p:${k}`, 'who', p.name, `Only deals with ${p.name}`, { party: k })); }
          read++;
          matched = len;
        }
      }
    }
    if (matched) { i += matched; continue; }
    const tok = toks[i];
    if (tok && !STOP.has(tok.norm)) unknown.push(tok.raw);
    i++;
  }
  if (unknown.length) return { unsure: unknown, why: 'words' };
  if (!read) return { unsure: [], why: 'nothing' };
  // "How much" adds nothing to the default (how many and how much) or to "recovered" (already an
  // amount), so it is not a chip of its own there.
  const others = reading.filter((c) => c.slot === 'measure' && c.id !== CHIPS.amount.id);
  const tidy = others.every((c) => c.id === CHIPS.recovered.id) ? reading.filter((c) => c.id !== CHIPS.amount.id) : reading;
  if (!tidy.some((c) => c.slot === 'when')) tidy.push(whenChip({ k: 'any' }, ctx));
  return compose(tidy, ctx);
}

/** Build the closed query from chips (after reading, or after the owner removed or changed one). */
export function compose(chips: readonly ReadingChip[], ctx: Pick<AskCtx, 'now' | 'offsetMin'>): Understanding {
  const reading = [...chips].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  const whens = reading.filter((c) => c.part.when);
  if (whens.length > 1) return { unsure: whens.map((c) => c.text), why: 'two_times' };
  const groups = [...new Set(reading.flatMap((c) => (c.part.group ? [c.part.group] : [])))];
  if (groups.length > 2) return { unsure: reading.filter((c) => c.part.group).map((c) => c.text), why: 'too_many_groups' };
  const asked = new Set(reading.flatMap((c) => c.part.metrics ?? []));
  const metrics = asked.size ? METRIC_ORDER.filter((m) => m === 'count' || asked.has(m)) : (['count', 'sum_amount'] as BookMetric[]);
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];
  const kinds = uniq(reading.flatMap((c) => c.part.kinds ?? []));
  const states = uniq(reading.flatMap((c) => c.part.states ?? []));
  const parties = uniq(reading.flatMap((c) => (c.part.party ? [c.part.party] : [])));
  const filters: Filter[] = [];
  const filter = (field: Filter['field'], vs: string[]) => {
    if (vs.length === 1 && vs[0] !== undefined) filters.push({ field, op: 'eq', value: vs[0] });
    else if (vs.length > 1) filters.push({ field, op: 'in', value: vs });
  };
  filter('kind', kinds);
  filter('state', states);
  filter('counterparty', parties.slice(0, 32));
  const when = whens[0]?.part.when;
  const query: BookQuery = {
    view: reading.some((c) => c.part.view === 'reconciliation') ? 'reconciliation' : 'deals',
    metrics, filters, group_by: groups, range: when ? whenRange(when, ctx) : null, limit: null,
  };
  if (bookRejection(query)) return { unsure: [], why: 'nothing' };
  return { query, reading };
}

/** The same query in the window's own lens shape (it lights the rows in the grid). */
export function lensQuery(q: BookQuery): LensQuery {
  const filters: Filter[] = q.filters.flatMap((f): Filter[] => {
    if ((f.field !== 'kind' && f.field !== 'state' && f.field !== 'counterparty') || (f.op !== 'eq' && f.op !== 'in')) return [];
    const v = f.value;
    if (typeof v === 'string') return [{ field: f.field, op: f.op, value: v }];
    if (Array.isArray(v) && v.every((x): x is string => typeof x === 'string')) return [{ field: f.field, op: f.op, value: v }];
    return [];
  });
  return { view: q.view === 'reconciliation' ? 'reconciliation' : 'deals', filters, group_by: q.group_by, metrics: q.metrics, range: q.range };
}

/** A preset lens as it runs now. The week lens asks for this week (the same range a typed "this
 *  week" sends), worked out here at run time; every other preset names no time and stays as it is. */
export function lensAsRun(l: Lens, ctx: Pick<AskCtx, 'now' | 'offsetMin'>): Lens {
  return l.id === 'week' ? { ...l, query: { ...l.query, range: whenRange({ k: 'this_week' }, ctx) } } : l;
}

/** Swap one chip for another (an edited time or grouping), or drop it (`next` null). */
export function replaceChip(reading: readonly ReadingChip[], id: string, next: ReadingChip | null): ReadingChip[] {
  return reading.flatMap((c) => (c.id !== id ? [c] : next && !reading.some((x) => x.id === next.id && x.id !== id) ? [next] : []));
}

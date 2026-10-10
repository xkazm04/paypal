// "While you were away": a calm, true summary of what happened since Maya last looked, computed
// only from the wallet's own verified record (deal_history steps, closed facts), the deals' own
// terms for the amounts, and the attention count. Never from counterparty text. Pure: no React,
// no IO; the "last seen" moment is kept per viewer in localStorage by the helpers at the bottom.
import type { Currency } from '@bindings/Currency';
import type { Deal } from '@bindings/Deal';
import type { HistoryStep } from '@bindings/HistoryStep';
import type { Money } from '@bindings/Money';
import type { StatementRead } from '../../../lib/words';
import { dealTotal } from '../logic';
import { moneyList } from './model';

/** What happened, as Maya would group it. */
export type AwayOutcome =
  | 'paid' | 'collected' | 'invoice_paid' | 'on_hold' | 'released' | 'checking'
  | 'refused' | 'paused' | 'mismatch' | 'failed' | 'renewal' | 'lapsed' | 'unconfirmed' | 'refunded' | 'disputed';
/** On whose authority: you, a rule you signed, the buyer's approval under your shop rules, the safe
 *  default on a deadline, a safety check, or nobody recorded. */
export type AwayAuthority = 'owner' | 'rules' | 'buyer' | 'default' | 'safety' | 'none';
/** How a line reads: money out, money in, held, calm (released / lapsed), stopped, or being checked. */
export type AwayTone = 'out' | 'in' | 'held' | 'calm' | 'stopped' | 'check';

export type AwayLine = {
  key: string;
  outcome: AwayOutcome;
  authority: AwayAuthority;
  tone: AwayTone;
  /** Deals (or, for refusals, requests) behind the line. */
  count: number;
  /** Per-currency totals in integer minor units; empty for lines that carry no amount. */
  totals: Money[];
  /** Deals behind an amount line whose terms were not at hand, so not in `totals`. */
  uncounted: number;
  /** The sentence around its amount: `before` + `amount` + `after` (amount null when none). */
  before: string;
  amount: string | null;
  after: string;
  text: string;
  /** The deals behind the line, first seen first: one deal opens it, several open the Rewind. */
  deals: string[];
  /** The earliest step behind the line (Unix seconds): where the Rewind opens. */
  at: number;
};

export type AwaySummary = {
  since: number;
  now: number;
  /** "since yesterday 18:40" */
  sinceWords: string;
  lines: AwayLine[];
  /** Paid out and collected (including invoices paid), per currency. */
  out: Money[];
  inn: Money[];
  /** True when money was paid or collected in the window. */
  moved: boolean;
  /** True when nothing at all was recorded in the window. */
  quiet: boolean;
  /** "No money moved." when nothing was paid or collected, else null. */
  lead: string | null;
  needs: number;
  /** "2 things need you", or null. */
  needsLine: string | null;
  /** The record had more steps than one read returns, so older ones are not counted. */
  partial: boolean;
  /** The whole summary as one paragraph (for a screen reader and the tooltip). */
  text: string;
};

type Event = { outcome: AwayOutcome; authority: AwayAuthority; deal: string; at: number; seq: number; side: 'buyer' | 'seller'; read?: StatementRead };

const ORDER: readonly AwayOutcome[] = ['paid', 'collected', 'invoice_paid', 'on_hold', 'released', 'checking', 'refused', 'paused', 'mismatch', 'failed', 'renewal', 'lapsed', 'unconfirmed', 'refunded', 'disputed'];
const WHO_ORDER: readonly AwayAuthority[] = ['owner', 'rules', 'buyer', 'default', 'safety', 'none'];
const WITH_AMOUNT: ReadonlySet<AwayOutcome> = new Set(['paid', 'collected', 'invoice_paid', 'on_hold', 'released', 'checking']);
const TONE: Record<AwayOutcome, AwayTone> = {
  paid: 'out', collected: 'in', invoice_paid: 'in', on_hold: 'held', released: 'calm', checking: 'check',
  refused: 'stopped', paused: 'stopped', mismatch: 'stopped', failed: 'stopped', renewal: 'stopped', lapsed: 'calm', unconfirmed: 'check', refunded: 'calm', disputed: 'stopped',
};

/** The recorded authority of a step, in the summary's terms. */
function authorityOf(s: HistoryStep): AwayAuthority {
  switch (s.authority.type) {
    case 'owner': return 'owner';
    case 'signed_rule': case 'house_mandate': return 'rules';
    case 'seller_mandate': return 'buyer';
    case 'safe_default': case 'group_rule': return 'default';
    case 'agent_intent': case 'none': return 'none';
  }
}

/** One step as an event the summary counts, or null for steps that tell Maya nothing new here
 *  (offers, receipts, order creation and the like stay in the Rewind). */
function eventOf(s: HistoryStep, deal: Deal | undefined, reads: ReadonlyMap<string, StatementRead>): Event | null {
  const who = authorityOf(s);
  const side: 'buyer' | 'seller' = deal ? deal.side : who === 'buyer' ? 'seller' : 'buyer';
  const base = { deal: s.deal_id, at: s.at, seq: s.seq, side };
  const answer = s.paypal.type === 'call' ? s.paypal.outcome : 'ok';
  const ev = (outcome: AwayOutcome, authority: AwayAuthority = who): Event => ({ ...base, outcome, authority });
  const money = (ok: AwayOutcome, by: AwayAuthority = who): Event => (answer === 'failed' ? ev('failed') : answer === 'unknown' ? ev('checking') : ev(ok, by));
  switch (s.kind) {
    case 'captured': return money(side === 'seller' ? 'collected' : 'paid');
    case 'authorized': return money('on_hold');
    case 'voided': return money('released');
    case 'auto_voided': return money('released', 'default');
    case 'invoice_paid': return ev('invoice_paid');
    case 'checking_with_paypal': return ev('checking');
    case 'refused': return ev('refused', who === 'rules' ? 'rules' : 'safety');
    case 'intent_refused': return ev('refused', 'rules');
    case 'shield_held': return ev('paused', 'safety');
    case 'mismatch': return ev('mismatch', 'safety');
    case 'failed': return ev('failed');
    case 'renewal_failed': return ev('renewal');
    case 'expired': case 'lapsed': return ev('lapsed', 'default');
    // The seller said it was paid and PayPal's statement did not confirm it in 72 hours.
    case 'unconfirmed': return { ...ev('unconfirmed', 'default'), read: reads.get(s.deal_id) };
    case 'refunded': return ev('refunded');
    case 'disputed': return ev('disputed');
    default: return null;
  }
}

/** Later outcomes on the same deal that settle an earlier one: a hold that was then paid,
 *  collected, released or questioned is told once, by what happened last; a check with PayPal
 *  that then resolved is told by its answer. */
const SETTLES: Partial<Record<AwayOutcome, ReadonlySet<AwayOutcome>>> = {
  on_hold: new Set(['paid', 'collected', 'released', 'checking', 'failed', 'refunded']),
  checking: new Set(['paid', 'collected', 'released', 'failed', 'on_hold']),
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The sentence for one line, around its amount (A). */
function words(outcome: AwayOutcome, who: AwayAuthority, n: number, read?: StatementRead): [string, string] {
  switch (outcome) {
    case 'paid':
      if (who === 'rules') return ['Your agents paid ', ` under your rules (${plural(n, 'purchase', 'purchases')})`];
      if (who === 'owner') return ['You paid ', ` (${plural(n, 'purchase', 'purchases')})`];
      return ['', ` was paid (${plural(n, 'purchase', 'purchases')}; who decided is not recorded)`];
    case 'collected': {
      const sales = n > 1 ? ` (${n} sales)` : '';
      if (who === 'buyer') return ['Your shop collected ', ` after the buyer approved${sales}`];
      if (who === 'rules') return ['Your shop collected ', ` under your rules${sales}`];
      if (who === 'owner') return ['You collected ', sales];
      return ['', ` was collected${sales}; who decided is not recorded`];
    }
    case 'invoice_paid': return n === 1 ? ['A subscriber paid ', ' by invoice'] : ['Subscribers paid ', ` on ${n} invoices`];
    case 'on_hold': {
      const deals = n > 1 ? `, ${n} deals` : '';
      if (who === 'buyer') return ['', ` from buyers is on hold at PayPal for your shop${deals}`];
      if (who === 'owner') return ['You put ', ` on hold at PayPal (not paid yet${deals})`];
      if (who === 'rules') return ['', ` is on hold at PayPal under your rules (not paid yet${deals})`];
      return ['', ` is on hold at PayPal (not paid yet${deals})`];
    }
    case 'released': {
      const holds = plural(n, 'hold', 'holds');
      if (who === 'default') return [`${holds} released ${n === 1 ? 'itself' : 'themselves'} (`, ', nothing was paid)'];
      if (who === 'owner') return [`You released ${holds} (`, ', nothing was paid)'];
      if (who === 'rules') return [`${holds} released under your rules (`, ', nothing was paid)'];
      return [`${holds} released (`, ', nothing was paid)'];
    }
    case 'checking': return [`Checking with PayPal on ${plural(n, 'payment', 'payments')} (`, '): nothing is collected until PayPal confirms'];
    case 'refused': return who === 'rules'
      ? [`${plural(n, 'request was', 'requests were')} refused by your rules (PayPal was never asked)`, '']
      : [`${plural(n, 'request was', 'requests were')} stopped by a safety check (PayPal was never asked)`, ''];
    case 'paused': return [`A safety check paused ${plural(n, 'deal', 'deals')} before PayPal was asked`, ''];
    case 'mismatch': return n === 1
      ? ['1 payment request didn’t match its deal (no pay button was offered)', '']
      : [`${n} payment requests didn’t match their deals (no pay button was offered)`, ''];
    case 'failed': return [`PayPal said no on ${plural(n, 'deal', 'deals')} (no money moved)`, ''];
    case 'renewal': return [`${plural(n, 'subscription renewal', 'subscription renewals')} failed (nothing is sent until you approve a fix)`, ''];
    case 'lapsed': return [`${plural(n, 'deal', 'deals')} ran out of time (no money moved)`, ''];
    case 'unconfirmed': {
      // True in every case: only a statement read that came back unmatched may say it did not show.
      const said = `${plural(n, 'deal ended', 'deals ended')} as not confirmed by PayPal: the seller said ${n === 1 ? 'it was' : 'they were'} paid, but `;
      const was = n === 1 ? 'it' : 'them';
      if (read === true) return [`${said}PayPal’s statement did not show ${was} (this wallet moved nothing)`, ''];
      if (read === false) return [`${said}your wallet did not check PayPal’s statement (this wallet moved nothing)`, ''];
      return [`${said}your wallet has no match for ${was} on PayPal’s statement (this wallet moved nothing)`, ''];
    }
    case 'refunded': return [`${plural(n, 'payment was', 'payments were')} refunded`, ''];
    case 'disputed': return [`${plural(n, 'payment is', 'payments are')} disputed at PayPal`, ''];
  }
}

const sumByCurrency = (items: readonly Money[]): Money[] => {
  const by = new Map<Currency, number>();
  for (const m of items) by.set(m.currency, (by.get(m.currency) ?? 0) + m.minor);
  return [...by.entries()].map(([currency, minor]) => ({ currency, minor }));
};

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** "since yesterday 18:40" (local time): today / yesterday / a weekday within the week / a date. */
export function sinceWords(since: number, now: number): string {
  const s = new Date(since * 1000);
  const n = new Date(now * 1000);
  const days = Math.round((startOfDay(n).getTime() - startOfDay(s).getTime()) / 86_400_000);
  const midnight = s.getHours() === 0 && s.getMinutes() === 0;
  if (days <= 0) return midnight ? 'since the start of today' : `since today ${hm(s)}`;
  if (days === 1) return midnight ? 'since yesterday morning' : `since yesterday ${hm(s)}`;
  if (days < 7) return `since ${s.toLocaleDateString('en-GB', { weekday: 'short' })} ${hm(s)}`;
  return `since ${s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${hm(s)}`;
}

/** Lower-cases a line's first letter to run it into the paragraph ("PayPal" keeps its capital). */
const runOn = (t: string): string => (t.startsWith('PayPal') ? t : t.charAt(0).toLowerCase() + t.slice(1));

/** What happened between `lastSeen` and `now` (Unix seconds), grouped by outcome and authority,
 *  with totals per currency. `steps` is the record as deal_history returns it (any order);
 *  `deals` give the amounts and which side of a deal Maya is on. */
export function awaySummary(
  steps: readonly HistoryStep[], deals: readonly Deal[], lastSeen: number, now: number,
  opts: { needs?: number; truncated?: boolean; /** Per deal: did a statement read come back unmatched (absent = not known). */ reads?: ReadonlyMap<string, StatementRead> } = {},
): AwaySummary {
  const byId = new Map(deals.map((d) => [d.id, d]));
  const inWindow = steps.filter((s) => s.at >= lastSeen && s.at <= now).sort((a, b) => a.at - b.at || a.seq - b.seq);
  const events: Event[] = [];
  for (const s of inWindow) {
    const e = eventOf(s, byId.get(s.deal_id), opts.reads ?? new Map());
    if (e) events.push(e);
  }
  // Drop what a later step on the same deal settled.
  const kept = events.filter((e, i) => {
    const later = SETTLES[e.outcome];
    return !later || !events.some((x, j) => j > i && x.deal === e.deal && later.has(x.outcome));
  });

  const groups = new Map<string, Event[]>();
  for (const e of kept) {
    // Deals that ended unconfirmed are told apart by what the wallet did, so a line never claims a read it did not make.
    const key = e.outcome === 'unconfirmed' ? `${e.outcome}:${e.authority}:${String(e.read ?? 'unknown')}` : `${e.outcome}:${e.authority}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const lines: AwayLine[] = [...groups.entries()].map(([key, es]) => {
    const first = es[0] as Event;
    const { outcome, authority } = first;
    const ids = [...new Set(es.map((e) => e.deal))];
    // A refusal is one request each time; everything else counts deals.
    const count = outcome === 'refused' ? es.length : ids.length;
    const known = ids.map((id) => byId.get(id)).filter((d): d is Deal => !!d);
    const totals = WITH_AMOUNT.has(outcome) ? sumByCurrency(known.map(dealTotal)) : [];
    const uncounted = WITH_AMOUNT.has(outcome) ? ids.length - known.length : 0;
    const [before, after] = words(outcome, authority, count, first.read);
    const amount = !WITH_AMOUNT.has(outcome) ? null : totals.length ? `${moneyList(totals)}${uncounted ? ' and more' : ''}` : 'an amount not shown';
    const body = `${before}${amount ?? ''}${after}`;
    const text = body.charAt(0).toUpperCase() + body.slice(1);
    return { key, outcome, authority, tone: TONE[outcome], count, totals, uncounted, before, amount, after, text, deals: ids, at: first.at };
  }).sort((a, b) => ORDER.indexOf(a.outcome) - ORDER.indexOf(b.outcome) || WHO_ORDER.indexOf(a.authority) - WHO_ORDER.indexOf(b.authority));

  const out = sumByCurrency(lines.filter((l) => l.outcome === 'paid').flatMap((l) => l.totals));
  const inn = sumByCurrency(lines.filter((l) => l.outcome === 'collected' || l.outcome === 'invoice_paid').flatMap((l) => l.totals));
  const moved = lines.some((l) => l.outcome === 'paid' || l.outcome === 'collected' || l.outcome === 'invoice_paid');
  const quiet = lines.length === 0;
  // A deal that ended unconfirmed may have been paid at PayPal: the summary does not say no money moved then.
  const unconfirmed = lines.some((l) => l.outcome === 'unconfirmed');
  const lead = quiet ? 'Nothing happened. No money moved.' : moved || unconfirmed ? null : 'No money moved.';
  const needs = Math.max(0, opts.needs ?? 0);
  const needsLine = needs ? `${plural(needs, 'thing needs', 'things need')} you` : null;
  const since = sinceWords(lastSeen, now);
  const body = lines.map((l) => runOn(l.text)).join(', ');
  const text = [
    `While you were away (${since}): ${quiet ? 'nothing happened and no money moved' : `${moved || unconfirmed ? '' : 'no money moved; '}${body}`}.`,
    needsLine ? `${needsLine.charAt(0).toUpperCase()}${needsLine.slice(1)}.` : '',
  ].filter(Boolean).join(' ');
  return { since: lastSeen, now, sinceWords: since, lines, out, inn, moved, quiet, lead, needs, needsLine, partial: !!opts.truncated, text };
}

/** A quiet summary over a moment ago is noise (Maya just looked): the card shows only when
 *  something happened, or when the quiet stretch is long enough to be news. */
export const QUIET_NEWS_AFTER = 30 * 60;
export const worthShowing = (s: AwaySummary): boolean => !s.quiet || s.now - s.since >= QUIET_NEWS_AFTER;

// ---- last seen, per viewer -------------------------------------------------------------------------

export const LAST_SEEN_KEY = 'table-last-seen';
/** How long Home must be on screen before it counts as seen. */
export const SEEN_AFTER_MS = 4000;

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const local = (): Store | null => {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
};

/** Local midnight of the day around `now` (Unix seconds). */
export const startOfToday = (now: number): number => Math.floor(startOfDay(new Date(now * 1000)).getTime() / 1000);

/** When this viewer last looked at Home. Absent, unreadable or in the future = the start of today. */
export function readLastSeen(now: number, store: Store | null = local()): { at: number; stored: boolean } {
  try {
    const raw = store?.getItem(LAST_SEEN_KEY);
    const at = raw ? Number(raw) : NaN;
    if (Number.isInteger(at) && at > 0 && at <= now) return { at, stored: true };
  } catch { /* blocked storage: fall through */ }
  return { at: startOfToday(now), stored: false };
}

/** Remembers that this viewer looked at Home at `at` (best effort; never throws). */
export function writeLastSeen(at: number, store: Store | null = local()): void {
  try { store?.setItem(LAST_SEEN_KEY, String(Math.floor(at))); } catch { /* blocked storage */ }
}

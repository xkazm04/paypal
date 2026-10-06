// Pure logic for the Shield page (Evidence matrix, prototype/pages/shield/variant-2): the grid's
// rows, what each check cell can honestly say, the PayPal line and the keyboard cursor.
//
// The contract gives the client the verdict only (Deal.shield). It returns no per-check result,
// no deciding check and no counterparty note. So a check cell is one of:
//   - "fact": what the check reads, from data the client does hold (counterparty_list first_seen /
//     deals_closed, Deal.market) — shown as facts, never as the shield's own pass/hit;
//   - "skip": the market rule had no reference to compare with (no Deal.market) — not passed;
//   - "na":   not exposed to this window (drawn dashed, never as passed). The three checks that are
//     always "na" here (UNSHOWN) are not grid rows: one quiet line says they ran and are not shown.
// No React, no IPC; unit-tested in matrix.test.ts.
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import type { Deal } from '@bindings/Deal';
import type { ShieldVerdict } from '@bindings/ShieldVerdict';
import { formatMinor } from '../../../../lib/format';
import { isTerminal, moneyNow } from '../../logic';

export type CheckKey = 'payee' | 'ff' | 'newcp' | 'market' | 'typology';
export type RowKey = 'head' | 'verdict' | 'paypal' | 'move' | CheckKey | 'words';
export type Stage = 'rules' | 'market' | 'engine';

/** Focusable rows, top to bottom (group label rows and the unshown-checks line are not focusable). */
export const ROWS: readonly RowKey[] = ['head', 'verdict', 'paypal', 'move', 'newcp', 'market', 'words'];

/** The checks the shield runs, in pipeline order (report §7): rules, market band, quarantined engine. */
export const CHECKS: ReadonlyArray<{ k: CheckKey; name: string; short: string; stage: Stage; kind: string; effect: ShieldVerdict }> = [
  { k: 'payee', name: 'Payee matches the agreed deal', short: 'Payee match', stage: 'rules', kind: 'A fixed check', effect: 'BLOCK' },
  { k: 'ff', name: 'Asks to be paid as “friends & family”', short: 'Friends & family', stage: 'rules', kind: 'A fixed check on their note or invoice text', effect: 'BLOCK' },
  { k: 'newcp', name: 'New payee', short: 'New payee', stage: 'rules', kind: 'A fixed check: first seen in the last 24 hours, and a large amount', effect: 'ASK' },
  { k: 'market', name: 'Price far above typical', short: 'Price', stage: 'market', kind: 'A price check: more than 1.4 × the typical price', effect: 'HOLD' },
  { k: 'typology', name: 'Scam patterns in their message', short: 'Message check', stage: 'engine', kind: 'An AI second opinion that reads their message as data only', effect: 'HOLD' },
];
export const STAGES: Record<Stage, string> = { rules: 'Fixed checks', market: 'Price check', engine: 'AI second opinion' };
/** Checks whose result never reaches this window: shown once, as a line, not as a row of unknowns. */
export const UNSHOWN: readonly CheckKey[] = ['payee', 'ff', 'typology'];

export type CheckCell = { r: 'fact' | 'skip' | 'na'; s: string; l: string };

const DAY = 86400;
/** "today", "1 day ago", "17 days ago". */
export function ago(unix: number, now: number): string {
  const d = Math.floor(Math.max(0, now - unix) / DAY);
  return d === 0 ? 'today' : `${d} ${d === 1 ? 'day' : 'days'} ago`;
}

/** Percent of the unit price over (or under) the market median, or null without a usable reference. */
export function overMedian(d: Pick<Deal, 'terms' | 'market'>): number | null {
  const m = d.market;
  if (!m || m.median.currency !== d.terms.unit_price.currency || m.median.minor <= 0) return null;
  return Math.round((d.terms.unit_price.minor / m.median.minor - 1) * 100);
}

const NOT_SHOWN = 'not shown here';
export function checkCell(k: CheckKey, d: Pick<Deal, 'terms' | 'market'>, cp: CounterpartyDisplay | undefined, now: number): CheckCell {
  switch (k) {
    case 'payee':
      return { r: 'na', s: NOT_SHOWN, l: 'The shield checks that the money goes to the payee you agreed with. It ran; only its verdict above is shown here.' };
    case 'ff':
      return { r: 'na', s: NOT_SHOWN, l: 'The shield looks for a request to be paid as “friends & family”, which removes buyer protection. It ran; only its verdict above is shown here.' };
    case 'typology':
      return { r: 'na', s: NOT_SHOWN, l: 'An AI second opinion reads their message for known scam patterns. It can only make things safer. It ran; only its verdict above is shown here.' };
    case 'newcp': {
      if (!cp) return { r: 'na', s: 'unknown payee', l: 'The wallet has no record of this payee, so when you first met them is unknown.' };
      const fresh = now - cp.first_seen < DAY;
      const n = cp.deals_closed;
      const s = fresh ? (n ? 'New today' : 'New: first deal today') : n ? `${n} deal${n === 1 ? '' : 's'} before` : 'No deals yet';
      return { r: 'fact', s, l: `First seen ${ago(cp.first_seen, now)}, ${n ? `${n} finished deal${n === 1 ? '' : 's'} before` : 'no finished deals before'}${cp.house ? '. This is the house seller' : ''}. A new payee asking for a large amount needs your OK.` };
    }
    case 'market': {
      const p = overMedian(d);
      if (p === null) return { r: 'skip', s: 'no price to compare', l: 'There is no typical price on file for this item. The shield never waves through a price it cannot compare, so it asks you.' };
      const m = d.market!;
      const flag = Math.round(m.median.minor * 1.4);
      const s = p === 0 ? 'typical price' : `${Math.abs(p)}% ${p > 0 ? 'above' : 'below'} typical`;
      return { r: 'fact', s, l: `${formatMinor(d.terms.unit_price.minor, d.terms.unit_price.currency)} each, where a typical price is ${formatMinor(m.median.minor, m.median.currency)} (most sell between ${formatMinor(m.p25.minor, m.p25.currency)} and ${formatMinor(m.p75.minor, m.p75.currency)}). Above ${formatMinor(flag, m.median.currency)} the shield pauses the payment for you.` };
    }
  }
}

/** Which fact a reason stands on (round 2 writes its "Why?" from it). */
export type ReasonKind = 'price' | 'noprice' | 'newcp' | 'norecord' | 'other';
export type Reason = { kind: ReasonKind; icon: 'tag' | 'you' | 'eye' | 'shield'; text: string; detail: string };

/** Why a payment was paused, as two or three plain facts for the decision card. Only facts the
 *  client holds (price against typical, how new the payee is) are named; the shield's own deciding
 *  check is not exposed, so when none of those facts explains the pause, one honest line says so. */
export function reasonsFor(d: Pick<Deal, 'terms' | 'market'>, cp: CounterpartyDisplay | undefined, now: number): Reason[] {
  const out: Reason[] = [];
  const p = overMedian(d);
  if (p === null) out.push({ kind: 'noprice', icon: 'eye', text: 'No usual price to compare with, so it asks you', detail: checkCell('market', d, cp, now).l });
  else if (p >= 40) {
    out.push({ kind: 'price', icon: 'tag', text: `${p}% above the usual price`, detail: checkCell('market', d, cp, now).l });
  }
  if (!cp) out.push({ kind: 'norecord', icon: 'eye', text: 'The wallet has no record of this payee', detail: checkCell('newcp', d, cp, now).l });
  else if (now - cp.first_seen < DAY) out.push({ kind: 'newcp', icon: 'you', text: cp.deals_closed ? 'New payee: first seen today' : 'New payee: first deal today', detail: checkCell('newcp', d, cp, now).l });
  if (!out.length) out.push({ kind: 'other', icon: 'shield', text: 'One of the shield’s other checks paused it', detail: 'Only its verdict is shown in this window, not which check found something.' });
  return out.slice(0, 3);
}

/** The PayPal row: what has been sent, in two short parts. */
export function paypalLine(d: Pick<Deal, 'state' | 'paypal' | 'shield' | 'side' | 'kind'>): [string, string] {
  const p = d.paypal;
  const ids = p.order || p.authorization || p.capture;
  if (!ids && (d.state === 'REFUSED' || d.shield === 'BLOCK')) return ['Nothing sent', d.shield === 'BLOCK' ? 'no PayPal link ever opened' : 'refused before PayPal was asked'];
  if (!ids && d.shield === 'HOLD' && !isTerminal(d)) return ['Nothing sent', 'paused before PayPal was asked'];
  if (!ids) return [isTerminal(d) ? 'Nothing sent' : 'Nothing sent yet', moneyNow(d)];
  return ['Order made', moneyNow(d)];
}

export const VERDICT_RANK: Record<ShieldVerdict, number> = { CLEAR: 0, ASK: 1, HOLD: 2, BLOCK: 3 };

/** Release is offered (as a hand-off) only for a live HOLD; a BLOCK never, a closed deal never. */
/** The attention item this page acts on: the shield's own, or a live HOLD's. Another module's
 *  decision (a Tables countersign on a CLEAR deal) stays in that module. */
export function shieldNeed<T extends { module: string }>(d: Pick<Deal, 'shield' | 'state' | 'kind'>, need: T | undefined): T | undefined {
  return need && (need.module === 'shield' || releasable(d)) ? need : undefined;
}

export function releasable(d: Pick<Deal, 'shield' | 'state' | 'kind'>): boolean {
  return d.shield === 'HOLD' && !isTerminal(d);
}

/** Move the grid cursor, clamped to the grid. */
export function moveCursor(c: { r: number; c: number }, dr: number, dc: number, rows: number, cols: number): { r: number; c: number } {
  return { r: Math.max(0, Math.min(rows - 1, c.r + dr)), c: Math.max(0, Math.min(cols - 1, c.c + dc)) };
}

export type BandGeometry = { iqr: [number, number]; median: number; flag: number; price: number; pct: number };

/** Positions (0-100 %) for the shield's market band: IQR box, median tick, the 1.4 × median flag
 *  line and the deal's unit price. Null without a usable, same-currency reference. */
export function bandGeometry(d: Pick<Deal, 'terms' | 'market'>): BandGeometry | null {
  const m = d.market;
  const price = d.terms.unit_price;
  if (!m || m.median.currency !== price.currency || m.median.minor <= 0) return null;
  const flag = Math.round(m.median.minor * 1.4);
  const pts = [m.p25.minor, m.p75.minor, flag, price.minor];
  const lo = Math.min(...pts) * 0.93;
  const hi = Math.max(...pts) * 1.04;
  const x = (v: number) => Math.round(((v - lo) / (hi - lo)) * 1000) / 10;
  return { iqr: [x(m.p25.minor), x(m.p75.minor)], median: x(m.median.minor), flag: x(flag), price: x(price.minor), pct: Math.round((price.minor / m.median.minor - 1) * 100) };
}

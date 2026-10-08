// The Tumbler's pure logic: no React, no IPC. Everything here is a projection of what Rust
// already decided (AttentionSnapshot, ReceiptEvent, VisualState) into what the page draws.
// Money, defaults and authority stay in Rust; this file only chooses forms, rungs and buttons.
import type { AttentionItem } from '@bindings/AttentionItem';
import type { AttentionSnapshot } from '@bindings/AttentionSnapshot';
import type { ClauseRef } from '@bindings/ClauseRef';
import type { Currency } from '@bindings/Currency';
import type { DealState } from '@bindings/DealState';
import type { Form } from '@bindings/Form';
import type { Mode } from '@bindings/Mode';
import type { ReceiptEvent } from '@bindings/ReceiptEvent';
import type { TumblerPreferences } from '@bindings/TumblerPreferences';
import type { VisualState } from '@bindings/VisualState';
import { clockLabel, countdown, formatMinor } from '../../lib/format';
import { headlineWords, moneyCheckWord, ruleNameOf, silenceWords, timeLeftWords } from '../../lib/words';

/** Rust's size table (crates/table-attention placement.rs). The page never sends pixels;
 *  this copy exists only so the browser preview can draw a frame of the same size. */
export const FORM_SIZE: Record<Form, readonly [number, number]> = {
  rest: [88, 88],
  tab: [28, 96],
  ticker: [420, 88],
  card: [440, 152],
  stack: [440, 336],
  handoff: [440, 160],
  welcome: [440, 228],
};

export const SECONDS = {
  /** deadline ≤ 2 h: the ring breathes */
  soon: 2 * 3600,
  /** deadline ≤ 15 min: tray dot + one OS notification (Rust) */
  now: 15 * 60,
  /** Snooze exists only when the deadline is more than 45 min away */
  snoozeMinLeft: 45 * 60,
  snooze: 30 * 60,
} as const;

export const TICKER_MS = { default: 6000, receipt: 2500, info: 2500 } as const;

// ---------------------------------------------------------------------------------------
// the attention ladder

/** Where one deadline sits on the ladder. `past` = Rust is applying the default right now. */
export type Rung = 'none' | 'calm' | 'soon' | 'now' | 'past';

export function rung(deadline: number | null, now: number): Rung {
  if (deadline === null) return 'none';
  const left = deadline - now;
  if (left <= 0) return 'past';
  if (left <= SECONDS.now) return 'now';
  if (left <= SECONDS.soon) return 'soon';
  return 'calm';
}

const RUNG_ORDER: Record<Rung, number> = { none: 0, calm: 1, soon: 2, now: 3, past: 4 };

/**
 * What a screen reader hears when the most urgent decision climbs a rung of the ladder - once per
 * rung, never every second (the clocks themselves are not live regions). Null when nothing new:
 * a first sighting on a calm rung, the same rung again, or a step down (a snooze, a new deadline).
 * `what` is the plain headline ("Approve $329.00"); `silence` the default in plain words.
 */
export function rungNotice(prev: Rung | null, next: Rung, what: string, silence: string | null): string | null {
  if (prev === next || RUNG_ORDER[next] <= RUNG_ORDER[prev ?? 'calm']) return null;
  switch (next) {
    case 'soon': return `${what}: under 2 hours left to decide.`;
    case 'now': return `${what}: under 15 minutes left to decide.`;
    case 'past': return `${what}: time is up${silence ? `, so ${silence}` : ''}.`;
    default: return null;
  }
}

/** GATE and HOLD items sorted by deadline (no clock last), then id - the same order Rust uses. */
export function sortItems(items: readonly AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity) || (a.deal_id < b.deal_id ? -1 : a.deal_id > b.deal_id ? 1 : 0));
}

export type PuckLook = {
  /** open items that need Maya (the centre count). A snoozed GATE is simply absent from
   *  Rust's snapshot until its snooze ends or the 15-minute rung pierces it. */
  needs: number;
  /** gold = a decision waits; coral = only holds wait */
  ring: 'none' | 'gold' | 'coral';
  /** the most urgent live GATE's rung */
  urgency: 'none' | 'calm' | 'soon' | 'now';
  breathe: boolean;
  opacity: number;
};

/**
 * The puck's look for a snapshot. Steady ring > 2 h, breathing ≤ 2 h, `now` styling ≤ 15 min.
 * Breathing needs both sides to agree: Rust's VisualState hint (which already folds in DND and
 * Focus Assist) AND the local rung over the snapshot's gates; reduced motion always wins.
 */
export function puckLook(
  snapshot: AttentionSnapshot | undefined,
  o: { now: number; visual: VisualState | null; reducedMotion: boolean; dnd: boolean },
): PuckLook {
  const live = sortItems(snapshot?.items ?? []);
  const gates = live.filter((i) => i.kind === 'gate');
  const ring = live.length === 0 ? 'none' : gates.length ? 'gold' : 'coral';
  let urgency: PuckLook['urgency'] = gates.length ? 'calm' : 'none';
  for (const g of gates) {
    const r = rung(g.deadline, o.now);
    if (r === 'now' || r === 'past') urgency = 'now';
    else if (r === 'soon' && urgency !== 'now') urgency = 'soon';
  }
  const localBreathe = urgency === 'soon' || urgency === 'now';
  const hinted = o.visual ? o.visual.breathe : !o.dnd;
  const opacity = Math.min(100, Math.max(20, o.visual?.opacity_percent ?? 100));
  return { needs: live.length, ring, urgency, breathe: localBreathe && hinted && !o.reducedMotion, opacity };
}

// ---------------------------------------------------------------------------------------
// forms

export type Target = { form: 'handoff' } | { form: 'card'; id: string } | { form: 'stack' };

/** What a click on the resting puck opens: the hand-off in progress, else the most urgent open
 *  item's card, else the stack (stopped today, in motion, meters). */
export function puckTarget(o: { snapshot: AttentionSnapshot | undefined; handoff: boolean; preferId?: string | null }): Target {
  if (o.handoff) return { form: 'handoff' };
  const live = sortItems(o.snapshot?.items ?? []);
  const preferred = o.preferId ? live.find((i) => i.deal_id === o.preferId) : undefined;
  const first = preferred ?? live[0];
  return first ? { form: 'card', id: first.deal_id } : { form: 'stack' };
}

/** "Back to rest": the puck, or the tab while docked to a screen edge. */
export function restForm(docked: boolean): Form {
  return docked ? 'tab' : 'rest';
}

/** The preferences a Do-not-disturb toggle writes. settings_write replaces the whole record and
 *  re-applies its form, so it starts from a fresh read (native drag/snap persistence emits no
 *  settings:changed), keeps the form the page is showing and the pin it holds, and changes dnd only. */
export function dndPreferences(fresh: TumblerPreferences, live: { form: Form; pinned: boolean | null }, dnd: boolean): TumblerPreferences {
  return { ...fresh, form: live.form, pinned: live.pinned ?? fresh.pinned, dnd };
}

/** The item a card shows after the snapshot changed: the same one if still open, else the next
 *  in order, else null (go back to rest). */
export function nextFocus(prev: readonly AttentionItem[], next: readonly AttentionItem[], id: string | null): string | null {
  if (id && next.some((i) => i.deal_id === id)) return id;
  const sorted = sortItems(next);
  if (!sorted.length) return null;
  const was = id ? sortItems(prev).findIndex((i) => i.deal_id === id) : -1;
  return (sorted[Math.max(0, Math.min(was, sorted.length - 1))] ?? sorted[0])?.deal_id ?? null;
}

/** Tickers never interrupt an open card, stack or welcome; they wait for rest. */
export function tickerMayShow(form: Form): boolean {
  return form === 'rest' || form === 'ticker' || form === 'handoff';
}

// ---------------------------------------------------------------------------------------
// card actions

export type CardAction = {
  action: 'review' | 'withdraw' | 'let_lapse' | 'snooze30' | 'open_in_table';
  label: string;
  style: 'gold' | 'plain' | 'danger' | 'link';
};

/** Whether to offer Snooze 30 (deal_snooze). Rust's `actions` must carry it, and the page
 *  re-checks the same rule on its own clock as a pre-filter: a GATE whose deadline is more than
 *  45 min away. Rust is authoritative and refuses (INVALID) anything else, so a 30-minute snooze
 *  can never carry a decision past its 15-minute notice. The page remembers no snooze: a snoozed
 *  GATE just leaves Rust's snapshot. */
export function snoozeEligible(item: AttentionItem, now: number): boolean {
  return item.kind === 'gate' && item.actions.includes('snooze30') && item.deadline !== null && item.deadline - now > SECONDS.snoozeMinLeft;
}

/** Review opens the approval window for a decision. Only a GATE may offer it: a HOLD
 *  (MISMATCH, Shield BLOCK/HOLD) never gets a path toward paying, whatever the list says. */
export function canReview(item: AttentionItem): boolean {
  return item.kind === 'gate' && item.actions.includes('review');
}

/**
 * Which actions a card may show, in display order. Rust's `actions` is the allow-list; the
 * client only ever narrows it (a HOLD drops Review, Let it lapse and Snooze; Snooze 30 also
 * needs the 45-minute rule on the page's clock). There is no approve action of any kind.
 */
export function cardActions(item: AttentionItem, now: number): CardAction[] {
  const has = (a: CardAction['action']) => item.actions.includes(a);
  if (item.kind === 'hold') {
    const out: CardAction[] = [];
    if (has('withdraw')) out.push({ action: 'withdraw', label: 'Withdraw', style: 'danger' });
    out.push({ action: 'open_in_table', label: 'See why in The Table ↗', style: 'plain' });
    return out;
  }
  if (item.kind !== 'gate') return [{ action: 'open_in_table', label: 'Open in The Table ↗', style: 'link' }];
  const out: CardAction[] = [];
  if (canReview(item)) out.push({ action: 'review', label: 'Review ↗', style: 'gold' });
  if (has('withdraw')) out.push({ action: 'withdraw', label: 'Withdraw', style: 'plain' });
  out.push({ action: 'open_in_table', label: 'Open in The Table ↗', style: 'link' });
  if (has('let_lapse')) out.push({ action: 'let_lapse', label: 'Let it lapse', style: 'link' });
  if (snoozeEligible(item, now)) out.push({ action: 'snooze30', label: 'Remind me in 30 min', style: 'link' });
  return out;
}

/** The state chip on a card or stack row: text plus colour, never colour alone. A snoozed GATE
 *  never reaches the page (Rust drops it from the snapshot), so there is no "Snoozed" state. */
export type StateChip = { tone: 'gold' | 'coral'; text: 'Paused' | 'In approval' | 'Needs you' | 'Checking' };
export function stateChip(item: AttentionItem, inApproval: boolean): StateChip {
  // A payment step being checked with PayPal is not paused for a decision: nothing is asked of you.
  if (item.money_check) return { tone: 'coral', text: 'Checking' };
  if (item.kind === 'hold') return { tone: 'coral', text: 'Paused' };
  return { tone: 'gold', text: inApproval ? 'In approval' : 'Needs you' };
}

/** The card's one sentence. A decision reads as a question about people and money ("Approve $329.00
 *  with Dan?"); a paused item as a statement. `who` is only Rust's composed display name for the
 *  counterparty, never anything they wrote: free text has no path into the Tumbler. */
export function cardQuestion(item: Pick<AttentionItem, 'headline' | 'amount_minor' | 'currency' | 'kind' | 'counterparty'>): { lead: string; amount: string | null; tail: string } {
  const end = item.kind === 'gate' ? '?' : '';
  const who = item.counterparty ? ` with ${item.counterparty}` : '';
  const s = splitHeadline(item.headline, item.amount_minor, item.currency);
  if (s) return { lead: s.lead, amount: s.amount, tail: `${who}${end}` };
  return { lead: `${item.headline}${who}${end}`, amount: null, tail: '' };
}

/** The card's clock in words: "3 h 57 min left", "time is up", or, for a paused item with no
 *  deadline, that it waits for you. Never a ticking second counter: the rung carries urgency. */
export function cardClock(item: Pick<AttentionItem, 'deadline' | 'kind' | 'money_check'>, now: number): { text: string; urgent: boolean } {
  if (item.deadline === null && item.money_check) return { text: 'checking with PayPal', urgent: false };
  if (item.deadline === null) return { text: item.kind === 'hold' ? 'paused until you act' : 'no deadline', urgent: false };
  const left = item.deadline - now;
  if (left <= 0) return { text: 'time is up', urgent: true };
  return { text: `${timeLeftWords(left)} left`, urgent: left <= SECONDS.now };
}

/** How full the ladder gauge is for `left` seconds: 0-20 % is the ≤ 15 min rung, 20-50 % the
 *  ≤ 2 h rung, 50-100 % the steady stretch up to a day (anything longer reads as full). */
export function ladderFill(left: number): number {
  if (left <= 0) return 0;
  if (left <= SECONDS.now) return (left / SECONDS.now) * 20;
  if (left <= SECONDS.soon) return 20 + ((left - SECONDS.now) / (SECONDS.soon - SECONDS.now)) * 30;
  return Math.min(100, 50 + ((left - SECONDS.soon) / (24 * 3600 - SECONDS.soon)) * 50);
}

/** One plain line under the gauge: how much time is left, in words. The ladder (breathing, the
 *  15-minute notice) is for decisions only; a paused item just shows its clock. */
export function ladderCaption(r: Rung, hold = false, checking = false): string {
  if (checking) return 'checking with PayPal · nothing more is sent until it confirms';
  if (hold && r !== 'none' && r !== 'past') return 'paused · it can’t be paid · its safe default runs at the deadline';
  switch (r) {
    case 'none': return hold ? 'no deadline · paused until you act' : 'no deadline';
    case 'calm': return 'plenty of time';
    case 'soon': return 'less than 2 hours left';
    case 'now': return 'less than 15 min left · last reminder';
    case 'past': return 'time is up · the safe default runs';
  }
}

/** r2-tumbler: how full the countdown ring is, 0-100, from the item's deadline only (the same ladder
 *  as the 2 px rule: it empties fastest in the last two hours). No deadline: null, drawn dashed, never full. */
export function ringFill(deadline: number | null, now: number): number | null {
  return deadline === null ? null : ladderFill(deadline - now);
}

/** r2-tumbler: the two sentences behind "Why?" in the details popover. Deterministic: only the item's
 *  kind, the rule Rust named, its deadline and its own safe default. Nothing the counterparty wrote
 *  (W4), no number that is not already on the card, no prediction. */
export function cardWhy(item: Pick<AttentionItem, 'kind' | 'clause' | 'on_silence' | 'money_check'>): [string, string] {
  const rule = clauseText(item.clause);
  if (item.money_check) {
    const silence = silenceWords(item.on_silence).trim().replace(/[.,\s]+$/, '');
    return [moneyCheckWord(item.money_check).means, `If you do nothing, ${silence}.`];
  }
  const ask = item.kind === 'hold'
    ? (rule ? `It is paused because of ${rule}, so it can’t be paid until you decide.` : 'It is paused, so it can’t be paid until you decide.')
    : (rule ? `${rule.charAt(0).toUpperCase()}${rule.slice(1)} sends this one to you.` : 'It needs your decision before it can go ahead.');
  const silence = item.on_silence.trim().replace(/\s*·\s*/g, ', ').replace(/[.,\s]+$/, '');
  return [ask, `If you do nothing, ${silence}.`];
}

// ---------------------------------------------------------------------------------------
// arrivals and tickers

/** Items that are new since the previous snapshot, or that turned into a HOLD. */
export function arrivals(prev: readonly AttentionItem[] | undefined, next: readonly AttentionItem[]): AttentionItem[] {
  if (!prev) return [];
  const before = new Map(prev.map((i) => [i.deal_id, i]));
  return sortItems(next).filter((i) => {
    const b = before.get(i.deal_id);
    return !b || (i.kind === 'hold' && b.kind !== 'hold');
  });
}

export type TickerKind = 'gate' | 'hold' | 'stop' | 'receipt' | 'info';
export type Ticker = {
  key: string;
  kind: TickerKind;
  /** line one: plain lead, a mono-bold part, plain tail */
  l1: readonly [string, string, string];
  l2: string;
  mode: Mode;
  /** the deal a click opens, if it is still open */
  dealId: string | null;
  ms: number;
};

export function hhmm(unix: number): string {
  const d = new Date(unix * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "Countersign $329.00" → { lead: "Countersign", amount: "$329.00" } when the Rust headline
 *  ends with the item's own amount, so the amount can be set in the money face. */
export function splitHeadline(headline: string, minor: number, currency: Currency): { lead: string; amount: string } | null {
  for (const amount of [formatMinor(minor, currency), formatMinor(minor, currency, { code: true })]) {
    if (headline.endsWith(amount)) return { lead: headline.slice(0, -amount.length).trimEnd(), amount };
  }
  return null;
}

/** The rule that asked for the owner, by its plain name (ids stay out of the Tumbler). */
export function clauseText(c: ClauseRef | null): string | null {
  return c ? `your rule “${ruleNameOf(c.number)}”` : null;
}

let seq = 0;
const key = (p: string) => `${p}:${++seq}`;

// Tickers name a deal by who it is with (Rust's composed display name), never by its id:
// UX-GUIDE keeps ids in Details, and a raw id ("01JD…7Q") would mean nothing to the owner.
const withWho = (i: AttentionItem | undefined): string => (i?.counterparty ? ` · ${i.counterparty}` : '');

export function arrivalTicker(item: AttentionItem): Ticker {
  const hold = item.kind === 'hold';
  const when = item.deadline !== null ? `until ${hhmm(item.deadline)}` : 'no clock';
  const split = splitHeadline(item.headline, item.amount_minor, item.currency);
  return {
    key: key('arrive'),
    kind: hold ? 'hold' : 'gate',
    // who it is with is on line two ("Dan · until 18:00"), so line one is only what and how much
    l1: split ? [`${split.lead} `, split.amount, ''] : [item.headline, '', ''],
    l2: item.money_check ? `checking with PayPal · ${silenceWords(item.on_silence)}` : hold ? `paused · can’t be paid · ${item.on_silence}` : `${item.counterparty ?? 'a connected wallet'} · ${when}`,
    mode: item.mode,
    dealId: item.deal_id,
    ms: TICKER_MS.default,
  };
}

export function arrivalsTicker(items: readonly AttentionItem[]): Ticker | null {
  const first = items[0];
  if (!first) return null;
  if (items.length === 1) return arrivalTicker(first);
  return {
    key: key('arrive'),
    kind: items.some((i) => i.kind === 'gate') ? 'gate' : 'hold',
    l1: ['', String(items.length), ' new items need you'],
    l2: `first: ${first.headline}${withWho(first)}`,
    mode: first.mode,
    dealId: first.deal_id,
    ms: TICKER_MS.default,
  };
}

const RECEIPT_VERB: Partial<Record<DealState, string>> = {
  APPROVED: 'Approved on PayPal',
  AUTHORIZED: 'On hold',
  CAPTURED: 'Paid',
  RECEIPTED: 'Receipt saved',
  RECONCILED: 'On PayPal statement',
  WITHDRAWN: 'Withdrawn',
  EXPIRED: 'Lapsed',
  VOIDED: 'Hold released',
  AUTO_VOIDED: 'Hold released',
  REFUNDED: 'Refunded',
  REFUSED: 'Refused',
  MISMATCH: 'Paused · amount didn’t match the deal',
  FAILED: 'Failed',
  DISPUTED: 'Disputed',
};

/** A receipt from Rust. REFUSED reads as a STOP, MISMATCH as a HOLD, everything else is green.
 *  `known` is the last attention item for the deal, used only for its amount and who it is with;
 *  a deal the Tumbler never saw says only what happened. */
export function receiptTicker(ev: ReceiptEvent, known?: AttentionItem): Ticker {
  const kind: TickerKind = ev.state === 'REFUSED' ? 'stop' : ev.state === 'MISMATCH' ? 'hold' : 'receipt';
  const verb = RECEIPT_VERB[ev.state] ?? 'Updated';
  return {
    key: key('receipt'),
    kind,
    l1: known && kind !== 'hold' ? [`${verb} `, formatMinor(known.amount_minor, known.currency), withWho(known)] : [verb, '', withWho(known)],
    l2: silenceWords(ev.on_silence),
    mode: ev.mode,
    dealId: ev.deal_id,
    ms: kind === 'receipt' ? TICKER_MS.receipt : TICKER_MS.default,
  };
}

export function stopTicker(stoppedToday: number, mode: Mode): Ticker {
  return {
    key: key('stop'),
    kind: 'stop',
    l1: ['Request ', 'stopped', ' by your rules'],
    l2: `${stoppedToday} stopped today · nothing was paid`,
    mode,
    dealId: null,
    ms: TICKER_MS.default,
  };
}

export function snoozeTicker(item: AttentionItem, until: number): Ticker {
  return {
    key: key('snooze'),
    kind: 'info',
    l1: ['Reminder set · back at ', hhmm(until), withWho(item)],
    l2: 'the deadline still runs · you still get the 15-minute reminder',
    mode: item.mode,
    dealId: item.deal_id,
    ms: TICKER_MS.info,
  };
}

/** Local acknowledgement of a safe-direction action when Rust sends no receipt for it. */
export function ackTicker(item: AttentionItem, action: 'withdraw' | 'let_lapse'): Ticker {
  return {
    key: key('ack'),
    kind: 'info',
    l1: [action === 'withdraw' ? 'Withdrawn' : 'Left to lapse', '', withWho(item)],
    l2: action === 'withdraw' ? 'nothing was sent to PayPal' : item.on_silence,
    mode: item.mode,
    dealId: null,
    ms: TICKER_MS.info,
  };
}

// ---------------------------------------------------------------------------------------
// hand-off (PayPal's approve window in the owner's browser)

/** What the page knows about a hand-off: `tumbler:handoff` names the deal and PayPal's approve
 *  window; a `handoff` form without that event (older shell, preview) stays generic. */
export type Handoff = { active: boolean; dealId: string | null; approveUntil: number | null };
export const NO_HANDOFF: Handoff = { active: false, dealId: null, approveUntil: null };

/** The hand-off ends when its deal leaves Rust's list or turns into a HOLD. */
export function handoffEnded(h: Handoff, items: readonly AttentionItem[]): boolean {
  if (!h.active || !h.dealId) return false;
  const still = items.find((i) => i.deal_id === h.dealId);
  return !still || still.kind === 'hold';
}

export type ApproveWindow =
  | { state: 'unknown' }
  | { state: 'open'; left: string; until: string; rung: Exclude<Rung, 'none' | 'past'> }
  | { state: 'closed'; until: string };

/** PayPal's approve window as Rust reported it (approve_until, from the ledger deadline). */
export function approveWindow(approveUntil: number | null, now: number): ApproveWindow {
  if (approveUntil === null) return { state: 'unknown' };
  const r = rung(approveUntil, now);
  const left = approveUntil - now;
  const until = left > 20 * 3600 ? clockLabel(approveUntil) : hhmm(approveUntil);
  if (r === 'past' || r === 'none') return { state: 'closed', until };
  return { state: 'open', left: left >= 3600 ? countdown(approveUntil, now) : countdown(approveUntil, now).replace(/^0:/, ''), until, rung: r };
}

// ---------------------------------------------------------------------------------------
// meters

/** The wallet-spend meter. Rust names the currency only when every deal shares one; null (or an
 *  older shell that omits it) means empty or mixed, and the page then refuses to sum. */
export function spendMeter(s: Pick<AttentionSnapshot, 'wallet_spend_today_minor' | 'wallet_spend_today_currency'>): { value: string | null; note: string } {
  const c = s.wallet_spend_today_currency;
  if (c) return { value: formatMinor(s.wallet_spend_today_minor, c), note: 'paid today' };
  return { value: null, note: 'empty or mixed currency' };
}

export const MODE_SHORT: Record<Mode, string> = { sandbox: 'SANDBOX', replay: 'REPLAY', scripted_engine: 'PRACTICE' };

/** The core's attention items in plain words (lib/words.ts); ids, amounts and actions untouched. */
export function plainItems(items: readonly AttentionItem[]): AttentionItem[] {
  return items.map((i) => ({ ...i, headline: headlineWords(i.headline), on_silence: silenceWords(i.on_silence) }));
}

// ---------------------------------------------------------------------------------------
// if you walk away (the walk-away forecast, T4)
//
// Every number and line comes from `AttentionSnapshot.forecast`, which Rust computes from the
// scheduler's own rules. Labels are deal numbers; no counterparty text is read here (W4).

/** The forecast's horizon (crates/table-runtime/src/forecast.rs FORECAST_HORIZON_SECS). */
export const WALK_AWAY_HOURS = 72;

export type WalkLine = {
  key: string;
  /** "Now", "If the buyer approves" or "Thu 18:00". */
  when: string;
  /** "D-0189 $90.00 collected" */
  what: string;
  /** On whose authority, in plain words. */
  who: 'your rule' | 'safe default' | 'the buyer already approved';
  /** Depends on an outside event (the buyer approving on PayPal). */
  conditional: boolean;
};
export type WalkAway =
  | { known: false; summary: string }
  | {
      known: true;
      /** "$0.00" per currency (" + " between currencies); null when no currency is known. */
      out: string | null;
      /** Money that comes in without anyone deciding anything more; null when none. */
      inSure: string | null;
      /** Sure money plus money that comes in only if a buyer approves; null without the latter. */
      inUpTo: string | null;
      /** Holds released by the safe default (not counting ones that start only on approval). */
      releases: number;
      /** At most three lines, the ones that act first. */
      lines: WalkLine[];
      more: number;
      /** One line for the stack: "$0.00 out · up to $90.00 in · 1 hold released". */
      summary: string;
    };

type ForecastRow = NonNullable<AttentionSnapshot['forecast']>[number];
const WALK_LINES = 3;

function perCurrency(sums: Map<Currency, number>): string | null {
  const parts = [...sums].filter(([, v]) => v !== 0).map(([c, v]) => formatMinor(v, c));
  return parts.length ? parts.join(' + ') : null;
}
function walkWhat(l: ForecastRow): string {
  const amt = formatMinor(l.amount_minor, l.currency);
  switch (l.action) {
    case 'lapse': return `${l.label} lapses, nothing is paid`;
    case 'expire': return `${l.label} payment request expires, nothing is paid`;
    case 'auto_void': return `${l.label} hold of ${amt} released`;
    case 'create_order': return `${l.label} payment request sent to the buyer`;
    case 'authorize': return `${l.label} ${amt} put on hold for you`;
    case 'capture': return `${l.label} ${amt} collected`;
  }
}
function walkWho(l: ForecastRow): WalkLine['who'] {
  if (l.authority === 'safe_default') return 'safe default';
  if (l.authority === 'seller_mandate' && l.trigger !== 'buyer_approves') return 'the buyer already approved';
  return 'your rule';
}
function walkWhen(l: ForecastRow): string {
  if (l.trigger === 'buyer_approves') return 'If the buyer approves';
  if (l.trigger === 'next_tick' || l.at === null) return 'Now';
  return clockLabel(l.at);
}
const TRIGGER_ORDER: Record<ForecastRow['trigger'], number> = { next_tick: 0, buyer_approves: 1, deadline: 2 };

/** The "If you walk away" block: totals per currency and the first few lines, or an honest
 *  "can't forecast" when the snapshot carries no forecast (an older shell, or a failed read). */
export function walkAway(s: Pick<AttentionSnapshot, 'forecast' | 'wallet_spend_today_currency'> | undefined): WalkAway {
  const forecast = s?.forecast;
  if (!s || !forecast) return { known: false, summary: 'Can’t forecast right now' };
  const out = new Map<Currency, number>();
  const sure = new Map<Currency, number>();
  const upTo = new Map<Currency, number>();
  let conditionalIn = false;
  let releases = 0;
  const add = (m: Map<Currency, number>, c: Currency, v: number) => m.set(c, (m.get(c) ?? 0) + v);
  for (const l of forecast) {
    add(out, l.currency, l.direction === 'out' ? l.amount_minor : 0);
    if (l.direction === 'in') {
      add(upTo, l.currency, l.amount_minor);
      if (l.trigger === 'buyer_approves') conditionalIn = true;
      else add(sure, l.currency, l.amount_minor);
    }
    if (l.action === 'auto_void' && l.trigger !== 'buyer_approves') releases += 1;
  }
  if (!out.size && s.wallet_spend_today_currency) out.set(s.wallet_spend_today_currency, 0);
  const outText = out.size ? [...out].map(([c, v]) => formatMinor(v, c)).join(' + ') : null;
  const inSure = perCurrency(sure);
  const inUpTo = conditionalIn ? perCurrency(upTo) : null;

  // One line per step that matters: a capture stands for the authorize before it, and a hold
  // that would start only on approval is not a line of its own.
  const shown = forecast.filter((l) => {
    if (l.action === 'auto_void' && l.trigger === 'buyer_approves') return false;
    if (l.action === 'authorize') return !forecast.some((c) => c.deal_id === l.deal_id && c.action === 'capture' && c.trigger === l.trigger);
    return true;
  });
  const ordered = [...shown].sort((a, b) => TRIGGER_ORDER[a.trigger] - TRIGGER_ORDER[b.trigger] || (a.at ?? 0) - (b.at ?? 0));
  const lines = ordered.slice(0, WALK_LINES).map((l, i): WalkLine => ({
    key: `${l.deal_id}:${l.action}:${i}`,
    when: walkWhen(l),
    what: walkWhat(l),
    who: walkWho(l),
    conditional: l.trigger === 'buyer_approves',
  }));

  const parts = [outText ? `${outText} out` : 'nothing goes out'];
  if (inUpTo) parts.push(`up to ${inUpTo} in`);
  else if (inSure) parts.push(`${inSure} in`);
  if (releases) parts.push(`${releases} hold${releases === 1 ? '' : 's'} released`);
  if (!forecast.length) parts.push('nothing scheduled');
  return { known: true, out: outText, inSure, inUpTo, releases, lines, more: Math.max(0, ordered.length - WALK_LINES), summary: parts.join(' · ') };
}

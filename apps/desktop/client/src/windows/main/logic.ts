// Pure logic for the Main window: which module a deal belongs to, how its state reads as a bead
// and a chip, the state path for its kind, the ledger summary, routing and the Dial's geometry.
// No React, no IPC - everything here is unit-tested in logic.test.ts.
//
// MODULE MAPPING (documented contract for the Dial and the rail):
//   1. A live AttentionItem wins: Rust already says which module owns the decision.
//   2. shield HOLD or BLOCK (any kind)     -> shield   (the one decision there is "release or keep")
//   3. kind haggle                         -> tables
//   4. kind purchase                       -> spend
//   5. kind shop_order                     -> counter  (seller side; the buyer approves on PayPal)
//   6. kind rescue | invoice               -> rescue   (a rescue lever issues one invoice)
//   Book owns no deals: it reads every deal and its PayPal evidence.
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Clause } from '@bindings/Clause';
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import type { Currency } from '@bindings/Currency';
import type { Deal } from '@bindings/Deal';
import type { DealKind } from '@bindings/DealKind';
import type { DealState } from '@bindings/DealState';
import type { Module } from '@bindings/Module';
import type { Money } from '@bindings/Money';
import type { Side } from '@bindings/Side';
import type { HistoryAuthority } from '@bindings/HistoryAuthority';
import type { HistoryStep } from '@bindings/HistoryStep';
import type { PaypalMethod } from '@bindings/PaypalMethod';
import type { ReceiptEvent } from '@bindings/ReceiptEvent';
import { formatMinor } from '../../lib/format';
import { ENDING_UNREAD_NOW, ENDING_UNREAD_PILL, endingUnreadSentence, moneyCheckNow, moneyCheckPillText, receiptRefusedSentence, refusedBecause, RULE_NAME, ruleNameOf, ruleSentence, sellerSaysOnly, stateWord, unconfirmedSentence } from '../../lib/words';

export const MODULE_KEYS: readonly Module[] = ['tables', 'spend', 'counter', 'book', 'shield', 'rescue'];
export const moduleIndex = (m: Module): number => MODULE_KEYS.indexOf(m);

type DealLike = Pick<Deal, 'kind' | 'shield' | 'state'> & Partial<Pick<Deal, 'side'>>;

export function moduleOf(deal: Pick<Deal, 'kind' | 'shield'>, attention?: Pick<AttentionItem, 'module'> | null): Module {
  if (attention) return attention.module;
  if (deal.shield === 'HOLD' || deal.shield === 'BLOCK') return 'shield';
  switch (deal.kind) {
    case 'haggle': return 'tables';
    case 'purchase': return 'spend';
    case 'shop_order': return 'counter';
    case 'rescue':
    case 'invoice': return 'rescue';
  }
}

/** Modules whose one decision depends on a backend that is not attached yet. */
export const PENDING_BACKEND: Partial<Record<Module, string>> = {
  counter: 'Your shop’s catalog is not connected yet, so list prices, stock and quotes can’t be shown. Orders you already have still appear here.',
};

// ---- states -------------------------------------------------------------------------------

const SETTLED: ReadonlySet<DealState> = new Set(['CAPTURED', 'RECEIPTED', 'RECONCILED']);
/** Paid as far as this wallet knows: money moved and, for a buyer, PayPal said so. */
const paid = (d: DealLike): boolean => SETTLED.has(d.state) && !sellerSaysOnly(d);
const OFF: ReadonlySet<DealState> = new Set(['WITHDRAWN', 'EXPIRED', 'VOIDED', 'AUTO_VOIDED', 'REFUNDED']);
const LIVE: ReadonlySet<DealState> = new Set(['PAIRING', 'LISTED', 'NEGOTIATING', 'AGREED', 'SETTLING']);

export type BeadKind = 'moving' | 'held' | 'settled' | 'stopped' | 'off';

/** Bead on the middle ring: teal moving / gold+lock held / green settled / x stopped / hollow off. */
export function beadKind(d: DealLike): BeadKind {
  const s = d.state;
  if (OFF.has(s)) return 'off';
  if (s === 'REFUSED' || s === 'MISMATCH' || s === 'DISPUTED') return 'stopped';
  // PayPal's statement never showed the seller's payment: an end that went wrong, like a dispute.
  if (s === 'FAILED' || s === 'UNCONFIRMED') return 'stopped';
  if (d.shield === 'BLOCK') return 'stopped';
  if (paid(d)) return 'settled';
  if (s === 'AUTHORIZED' || d.shield === 'HOLD') return 'held';
  return 'moving';
}

export type ChipClass = 'live' | 'wait' | 'held' | 'done' | 'bad' | 'off';

/** State chip colour class (shared vocabulary with the prototype). */
export function chipClass(d: DealLike): ChipClass {
  const s = d.state;
  if (OFF.has(s)) return 'off';
  if (paid(d)) return 'done';
  if (sellerSaysOnly(d)) return 'wait';
  if (s === 'AUTHORIZED') return 'held';
  if (s === 'REFUSED' || s === 'MISMATCH' || s === 'DISPUTED') return 'bad';
  if (s === 'FAILED' || s === 'UNCONFIRMED') return 'bad';
  // A failed renewal waits at AGREED for the owner's fix (Rust rescue.rs).
  if (s === 'AGREED' && d.kind === 'rescue') return 'wait';
  if (s === 'AWAITING_APPROVAL' || s === 'APPROVED') return 'wait';
  return 'live';
}

/** The main window's toast for a receipt event from Rust. A receipt that is only the seller's word
 *  reads "Seller says paid" in the waiting tone, never as paid (DECISIONS.md section 23); a deal
 *  PayPal never confirmed reads as a problem. */
export function receiptToast(r: Pick<ReceiptEvent, 'state' | 'evidence'>): { text: string; tone: 'ok' | 'info' | 'bad' | 'gold' } {
  if (r.state === 'RECEIPTED' && r.evidence.receipt === 'SELLER_ATTESTED') return { text: stateWord('RECEIPTED', { side: 'buyer' }).text, tone: 'gold' };
  if (r.state === 'UNCONFIRMED') return { text: stateWord('UNCONFIRMED').text, tone: 'bad' };
  return { text: stateWord(r.state).text, tone: r.state === 'CAPTURED' || r.state === 'RECEIPTED' ? 'ok' : 'info' };
}

/** A deal state in plain words (lib/words.ts); pass side/kind where the deal is at hand. */
export const stateLabel = (s: DealState, ctx?: { side?: Side; kind?: DealKind }): string => stateWord(s, ctx).text;
/** The raw protocol name, for Details and exports only. */
export const stateCode = (s: DealState): string => s.replace(/_/g, ' ');

export function isTerminal(d: DealLike): boolean {
  return OFF.has(d.state) || SETTLED.has(d.state) || d.state === 'REFUSED' || d.state === 'MISMATCH' || d.state === 'DISPUTED' || d.state === 'FAILED' || d.state === 'UNCONFIRMED';
}
export const isLive = (d: DealLike): boolean => !isTerminal(d);
export const isSettled = (d: DealLike): boolean => paid(d);
export const isStopped = (d: DealLike): boolean => beadKind(d) === 'stopped';

/** States from which the owner may send a signed WITHDRAW (Rust re-checks; this only hides the button). */
const WITHDRAWABLE: ReadonlySet<DealState> = new Set(['PAIRING', 'LISTED', 'NEGOTIATING', 'AGREED', 'SETTLING', 'AWAITING_APPROVAL']);
export const canWithdraw = (d: DealLike): boolean => WITHDRAWABLE.has(d.state);

/** States in which an agent run makes sense (bargaining, not money). */
export const canStartAgent = (d: Pick<Deal, 'state' | 'kind'>): boolean => d.kind === 'haggle' && (d.state === 'LISTED' || d.state === 'NEGOTIATING');

// ---- the state strip ------------------------------------------------------------------------

const PATHS: Record<DealKind, DealState[]> = {
  haggle: ['PAIRING', 'LISTED', 'NEGOTIATING', 'AGREED', 'SETTLING', 'AWAITING_APPROVAL', 'APPROVED', 'CAPTURED', 'RECEIPTED', 'RECONCILED'],
  purchase: ['AGREED', 'AWAITING_APPROVAL', 'APPROVED', 'AUTHORIZED', 'CAPTURED', 'RECONCILED'],
  shop_order: ['LISTED', 'AGREED', 'AWAITING_APPROVAL', 'APPROVED', 'AUTHORIZED', 'CAPTURED', 'RECONCILED'],
  rescue: ['AGREED', 'SETTLING', 'AWAITING_APPROVAL', 'RECEIPTED'],
  invoice: ['AWAITING_APPROVAL', 'CAPTURED', 'RECONCILED'],
};
/** A seller-side haggle authorizes and captures itself. */
const HAGGLE_SELLER: DealState[] = ['PAIRING', 'LISTED', 'NEGOTIATING', 'AGREED', 'SETTLING', 'AWAITING_APPROVAL', 'APPROVED', 'AUTHORIZED', 'CAPTURED', 'RECEIPTED', 'RECONCILED'];
/** Where a terminal state branches off the happy path (last step known to be reached). */
// UNCONFIRMED: the order was out for approval; that PayPal approved or collected it was never shown.
const BRANCH_AFTER: Partial<Record<DealState, DealState>> = { VOIDED: 'AUTHORIZED', AUTO_VOIDED: 'AUTHORIZED', REFUNDED: 'CAPTURED', DISPUTED: 'CAPTURED', MISMATCH: 'SETTLING', UNCONFIRMED: 'AWAITING_APPROVAL' };

export type StripStep = { state: DealState; label: string; status: 'done' | 'cur' | 'todo'; tone: 'gold' | 'ok' | 'bad' | 'off' | null };

export function pathFor(kind: DealKind, side: Side): DealState[] {
  return kind === 'haggle' && side === 'seller' ? HAGGLE_SELLER : PATHS[kind];
}

export function stripFor(d: Pick<Deal, 'kind' | 'side' | 'state' | 'shield'>): StripStep[] {
  const path = pathFor(d.kind, d.side);
  const label = (s: DealState) => stateLabel(s, { side: d.side, kind: d.kind });
  const at = path.indexOf(d.state);
  if (at >= 0) {
    const tone: StripStep['tone'] = paid(d) ? 'ok' : d.shield === 'BLOCK' ? 'bad' : 'gold';
    return path.map((s, i) => ({ state: s, label: label(s), status: i < at ? 'done' : i === at ? 'cur' : 'todo', tone: i === at ? tone : null }));
  }
  // Terminal (or off-path) state: mark the known-reached prefix, then append the terminal step.
  const after = BRANCH_AFTER[d.state];
  let reached = after ? path.indexOf(after) : -1;
  if (d.state === 'MISMATCH' && reached < 0) reached = path.indexOf('AGREED');
  const steps: StripStep[] = path.map((s, i) => ({ state: s, label: label(s), status: i <= reached ? 'done' : 'todo', tone: null }));
  const termTone: StripStep['tone'] = OFF.has(d.state) ? 'off' : 'bad';
  steps.push({ state: d.state, label: stateLabel(d.state, { side: d.side, kind: d.kind }), status: 'cur', tone: termTone });
  return steps;
}

// ---- money ----------------------------------------------------------------------------------

export const dealTotal = (d: Pick<Deal, 'terms'>): Money => ({ minor: d.terms.unit_price.minor * d.terms.qty, currency: d.terms.unit_price.currency });

/** Sum per currency (display only; integer minor units, never mixed currencies). */
export function sumByCurrency(items: Money[]): Money[] {
  const by = new Map<Currency, number>();
  for (const m of items) by.set(m.currency, (by.get(m.currency) ?? 0) + m.minor);
  return [...by.entries()].map(([currency, minor]) => ({ currency, minor }));
}

/** What the money is doing right now, in words. Never claims more than the state says. */
export function moneyNow(d: Pick<Deal, 'state' | 'side' | 'kind' | 'shield'>): string {
  if (d.shield === 'HOLD' && !isTerminal(d)) return 'paused by a scam check · nothing sent to PayPal';
  if (d.kind === 'rescue') {
    if (d.state === 'AGREED') return 'nothing sent · a fix waits for you';
    if (d.state === 'SETTLING') return 'nothing paid · the invoice you approved is being made';
    if (d.state === 'AWAITING_APPROVAL') return 'nothing paid yet · the subscriber has an invoice to pay';
  }
  switch (d.state) {
    case 'PAIRING': case 'LISTED': case 'NEGOTIATING': case 'AGREED': return 'nothing moved · nothing sent to PayPal yet';
    case 'SETTLING': return 'nothing moved · the PayPal order is being made';
    case 'AWAITING_APPROVAL': return d.side === 'seller' ? 'nothing moved · waiting for the buyer to approve on PayPal' : 'nothing moved · waiting for approval on PayPal';
    case 'APPROVED': return 'approved on PayPal · not yet authorized or captured';
    case 'AUTHORIZED': return 'on hold at PayPal · not paid until collected';
    case 'CAPTURED': case 'RECEIPTED': case 'RECONCILED': return d.side === 'seller' ? 'paid to you' : sellerSaysOnly(d) ? 'the seller says paid · not checked with PayPal yet' : 'paid';
    case 'WITHDRAWN': case 'EXPIRED': return 'nothing moved';
    case 'VOIDED': case 'AUTO_VOIDED': return 'hold released · nothing paid';
    case 'REFUSED': return 'nothing moved · refused before PayPal was asked';
    case 'MISMATCH': return 'nothing moved · no pay button was offered';
    case 'FAILED': return d.kind === 'rescue' ? 'invoice cancelled · nothing recovered' : 'failed · see the PayPal proof';
    case 'REFUNDED': return 'refunded';
    case 'DISPUTED': return 'disputed at PayPal';
    case 'UNCONFIRMED': return 'the seller says paid · no match on PayPal’s statement';
  }
}

/** Row amount styling: proposed vs moved vs struck never look alike. */
export function amountTone(d: DealLike): 'moved' | 'held' | 'proposed' | 'struck' {
  if (paid(d)) return 'moved';
  if (OFF.has(d.state) || d.state === 'REFUSED' || d.shield === 'BLOCK') return 'struck';
  if (beadKind(d) === 'held') return 'held';
  return 'proposed';
}
export function amountNote(d: Pick<Deal, 'state' | 'side' | 'shield' | 'kind'>): string {
  if (d.shield === 'BLOCK') return 'never sent';
  if (d.shield === 'HOLD' && !isTerminal(d)) return 'paused';
  switch (d.state) {
    case 'AUTHORIZED': return 'on hold at PayPal';
    case 'CAPTURED': case 'RECEIPTED': case 'RECONCILED': return d.side === 'seller' ? 'paid to you' : sellerSaysOnly(d) ? 'the seller says paid · not checked with PayPal yet' : 'paid';
    case 'REFUSED': return 'never sent';
    case 'VOIDED': case 'AUTO_VOIDED': return 'hold released';
    case 'WITHDRAWN': case 'EXPIRED': return 'no money moved';
    case 'FAILED': return d.kind === 'rescue' ? 'invoice cancelled' : 'failed';
    case 'UNCONFIRMED': return 'not confirmed by PayPal';
    default: return 'proposed';
  }
}

// ---- who decided (Deal.decided_by, the authority Rust recorded) ------------------------------

export type DecidedWho = 'you' | 'policy' | 'default' | 'none';
export type DecidedFact = { who: DecidedWho; text: string; why: string };

/** Who decided this deal, from the authority Rust recorded with the decision (the same value the
 *  audit log carries). Absent means nothing has decided it yet, or an older shell: said as such. */
export function decidedBy(d: Pick<Deal, 'decided_by'>): DecidedFact {
  const v = d.decided_by;
  if (!v) return { who: 'none', text: 'not decided yet', why: 'Nobody, no rule and no deadline has decided this deal yet.' };
  switch (v.type) {
    case 'human': return { who: 'you', text: 'you', why: 'You decided it yourself, in the approval window.' };
    case 'policy': return { who: 'policy', text: `your rule · ${ruleNameOf(v.clause).toLowerCase()}`, why: `A rule you signed decided it without asking you: “${ruleNameOf(v.clause)}” (rule ${v.clause}).` };
    case 'seller_mandate': return { who: 'policy', text: 'your shop rules', why: 'Your signed shop rules collected it after the buyer approved on PayPal.' };
    case 'house_mandate': return { who: 'policy', text: 'house seller rules', why: 'The house seller’s fixed rules decided it.' };
    case 'safe_default': return { who: 'default', text: 'the deadline', why: 'Nobody acted before the deadline, so the safe default applied. It never pays.' };
  }
}

// ---- pairing (CounterpartyDisplay.pairing) ---------------------------------------------------------

export type PairingFact = { text: string; tone: 'ok' | 'line' | 'red' | 'dashed'; why: string };

/** How this counterparty's key was pinned, as counterparty_list reports it; absent = not listed. */
export function pairingFact(entry: Pick<CounterpartyDisplay, 'pairing'> | undefined): PairingFact {
  switch (entry?.pairing) {
    case 'words_confirmed': return { text: 'verified', tone: 'ok', why: 'You matched all four pairing words with them, so this is really their wallet and payee.' };
    case 'house_pinned': return { text: 'house seller', tone: 'ok', why: 'The house seller built into this app. You confirmed its words, and its rules are fixed.' };
    case 'unpaired': return { text: 'not verified', tone: 'red', why: 'You never matched pairing words with this wallet, so your rules for connected wallets do not cover it.' };
    case undefined: return { text: 'unknown', tone: 'dashed', why: 'The wallet has no record of how this one was connected.' };
  }
}

// ---- the week's ledger (left column) ---------------------------------------------------------

export type LedgerSummary = { out: Money[]; inn: Money[]; held: Deal[]; moving: Deal[]; stopped: Deal[] };

/** Ledger summary from list_deals. `needs` = deal ids with an open attention item (they are
 *  shown on the right, so "in motion" lists only what runs on its own). */
export function summarize(deals: Deal[], needs: ReadonlySet<string>): LedgerSummary {
  const settled = deals.filter((d) => paid(d));
  return {
    out: sumByCurrency(settled.filter((d) => d.side === 'buyer').map(dealTotal)),
    inn: sumByCurrency(settled.filter((d) => d.side === 'seller').map(dealTotal)),
    held: deals.filter((d) => beadKind(d) === 'held'),
    moving: deals.filter((d) => beadKind(d) === 'moving' && LIVE.has(d.state) && !needs.has(d.id))
      .concat(deals.filter((d) => beadKind(d) === 'moving' && !LIVE.has(d.state) && !needs.has(d.id))),
    stopped: deals.filter((d) => beadKind(d) === 'stopped'),
  };
}

/** The wallet-spend meter in words. Rust names the currency; null or absent means no spend today
 *  or spend in more than one currency, and the client never picks one for it. */
export function spendToday(minor: number, currency: Currency | null | undefined): { text: string; exact: boolean; why: string | null } {
  if (currency) return { text: formatMinor(minor, currency), exact: true, why: null };
  if (minor === 0) return { text: 'nothing', exact: false, why: 'Your agents have not spent anything today.' };
  return { text: 'mixed', exact: false, why: 'Spending today is in more than one currency, so it is not added up.' };
}

// ---- this week (Mon-Sun, local) ------------------------------------------------------------------

/** Local Monday 00:00 to the next Monday 00:00 around `nowUnix`, in Unix seconds (DST-safe). */
export function weekBounds(nowUnix: number): { start: number; end: number } {
  const d = new Date(nowUnix * 1000);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) };
}

export type LedgerScope = { scope: 'week'; deals: Deal[]; start: number; end: number } | { scope: 'all'; deals: Deal[] };

/** The left column's deals. With Rust's stored timestamps on every deal it is a true "This week":
 *  everything still in play, plus whatever was created or last changed since Monday 00:00 local.
 *  If any deal lacks timestamps (an older shell), it is the whole ledger, said as such. */
export function ledgerScope(deals: Deal[], nowUnix: number): LedgerScope {
  const stamp = (d: Deal): number | undefined => d.updated_at ?? d.created_at;
  if (!deals.length || deals.some((d) => stamp(d) === undefined)) return { scope: 'all', deals };
  const { start, end } = weekBounds(nowUnix);
  const touched = (d: Deal) => [d.created_at, d.updated_at].some((t) => t !== undefined && t >= start && t < end);
  return { scope: 'week', deals: deals.filter((d) => isLive(d) || touched(d)), start, end };
}

// ---- the hub's verb ---------------------------------------------------------------------------

/** True when a Tables gate asks the owner to ACCEPT the buyer haggle's latest inbound counter
 *  (deal_owner_accept), not to countersign an agreed deal. Rust's attention projection raises a
 *  gate on a NEGOTIATING deal only for that case (an inbound counter above clause 6); an AGREED or
 *  APPROVED gate is a countersign. A headline that already says "Accept" is taken at its word. */
export function isOwnerAccept(item: Pick<AttentionItem, 'kind' | 'module' | 'headline'>, deal?: Pick<Deal, 'state' | 'side' | 'kind'> | null): boolean {
  if (item.kind !== 'gate' || item.module !== 'tables') return false;
  if (/^accept\b/i.test(item.headline)) return true;
  return !!deal && deal.kind === 'haggle' && deal.side === 'buyer' && deal.state === 'NEGOTIATING';
}

/** The gold button's words for an attention item. Every one opens the approval window. */
export function reviewVerb(item: Pick<AttentionItem, 'kind' | 'module' | 'headline'>, deal?: Pick<Deal, 'state' | 'side' | 'kind'> | null): string {
  if (item.kind === 'hold') return 'Review the pause';
  switch (item.module) {
    case 'tables': return isOwnerAccept(item, deal) ? 'Review & accept' : 'Review & approve';
    case 'spend': return 'Review & pay';
    case 'shield': return 'Review the pause';
    case 'rescue': return 'Review the fix';
    case 'counter': return 'Review the order';
    case 'book': return 'Review';
  }
}

/** Split "Countersign $329.00" into verb + gold amount when the headline ends with the amount. */
export function splitHeadline(headline: string, amount: string): [string, string | null] {
  if (amount && headline.endsWith(amount)) return [headline.slice(0, -amount.length).trimEnd(), amount];
  return [headline, null];
}

// ---- routing ----------------------------------------------------------------------------------

export type SheetTab = 'settings' | 'pairing' | 'mandates';
export type Route =
  | { level: 'home' }
  | { level: 'module'; module: Module }
  | { level: 'deal'; deal: string };

export function parseHash(hash: string): { route: Route; sheet: SheetTab | null } {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const m = params.get('m');
  const d = params.get('d');
  const s = params.get('s');
  const sheet: SheetTab | null = s === 'settings' || s === 'pairing' || s === 'mandates' ? s : null;
  if (d) return { route: { level: 'deal', deal: d }, sheet };
  if (m && (MODULE_KEYS as readonly string[]).includes(m)) return { route: { level: 'module', module: m as Module }, sheet };
  return { route: { level: 'home' }, sheet };
}

export function formatHash(route: Route, sheet: SheetTab | null): string {
  const parts: string[] = [];
  if (route.level === 'module') parts.push(`m=${route.module}`);
  if (route.level === 'deal') parts.push(`d=${encodeURIComponent(route.deal)}`);
  if (sheet) parts.push(`s=${sheet}`);
  return parts.length ? `#${parts.join('&')}` : '';
}

/** Resolve a deal reference from the hash: a ULID, or a display label like "D-0193". */
export function resolveDealRef(ref: string, deals: Deal[], labels: ReadonlyMap<string, string>): Deal | undefined {
  const byId = deals.find((d) => d.id === ref);
  if (byId) return byId;
  const want = ref.toUpperCase();
  return deals.find((d) => (labels.get(d.id) ?? '').toUpperCase() === want);
}

// ---- Dial geometry (1000 x 1000 viewBox, angles clockwise from 12 o'clock) ---------------------

export const C = 500;
export const STEP = 360 / MODULE_KEYS.length;
export const R = { hub: 300, track: 326, trackW: 34, secI: 348, secO: 458, rimI: 460, rimO: 476, bez: 487, bezW: 18, up: 404 } as const;

export function pol(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
}

const f1 = (n: number) => n.toFixed(1);

/** Annular sector path between angles a0..a1 and radii r0..r1. */
export function wedgePath(a0: number, a1: number, r0: number, r1: number): string {
  const [x0, y0] = pol(r1, a0);
  const [x1, y1] = pol(r1, a1);
  const [x2, y2] = pol(r0, a1);
  const [x3, y3] = pol(r0, a0);
  return `M${f1(x0)} ${f1(y0)}A${r1} ${r1} 0 0 1 ${f1(x1)} ${f1(y1)}L${f1(x2)} ${f1(y2)}A${r0} ${r0} 0 0 0 ${f1(x3)} ${f1(y3)}Z`;
}

/** The equivalent of `desired` closest to `current` (turn the short way round). */
export function shortestTarget(current: number, desired: number): number {
  const d = ((((desired - current) % 360) + 540) % 360) - 180;
  return current + d;
}

/** Rotation that brings module i under the gold index at 12 o'clock. */
export const rotationFor = (i: number): number => -i * STEP;

/** Which module sector sits at angle `theta` (screen degrees) when the rotor is at `rot`. */
export function sectorAt(theta: number, rot: number, n = MODULE_KEYS.length): number {
  const step = 360 / n;
  return ((Math.round((theta - rot) / step) % n) + n) % n;
}

/** Pointer position -> polar coordinates in viewBox units. */
export function toPolar(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): { rad: number; th: number } {
  const x = ((clientX - rect.left) / rect.width) * 1000 - C;
  const y = ((clientY - rect.top) / rect.height) * 1000 - C;
  return { rad: Math.hypot(x, y), th: ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360 };
}

export const angularDistance = (a: number, b: number): number => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

/** Bead angles (unrotated) for deals grouped by module index: spread around each sector's centre,
 *  never wider than the sector (+-23 degrees). */
export function beadAngles(moduleIdx: number[]): number[] {
  const groups = new Map<number, number[]>();
  moduleIdx.forEach((m, k) => groups.set(m, [...(groups.get(m) ?? []), k]));
  const out = new Array<number>(moduleIdx.length).fill(0);
  for (const [m, ks] of groups) {
    const n = ks.length;
    const sp = n > 1 ? Math.min(8.5, 46 / (n - 1)) : 0;
    ks.forEach((k, j) => { out[k] = m * STEP + (j - (n - 1) / 2) * sp; });
  }
  return out;
}

/** Intro easing: a spin-up that overshoots slightly and clicks back onto the decision. */
export function introEase(p: number, s = 0.55): number {
  const q = Math.min(1, Math.max(0, p)) - 1;
  return 1 + (s + 1) * q * q * q + s * q * q;
}

export const INTRO_MS = 2400;
export const INTRO_TURN = 400;

// ---- charts -----------------------------------------------------------------------------------

/** Round grid lines for a money axis (minor units): 3-7 lines on a 1/2/5 x 10^n step. */
export function niceTicks(min: number, max: number): { lo: number; hi: number; ticks: number[] } {
  if (max <= min) { max = min + 100; min = Math.max(0, min - 100); }
  const raw = (max - min) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => (max - min) / s <= 6) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(t);
  return { lo, hi, ticks };
}

/** Where a price sits on the market band: "below p25", "above p75" or an interpolated "p63". */
export function marketPosition(v: number, p25: number, median: number, p75: number): string {
  if (v < p25) return 'below p25';
  if (v > p75) return 'above p75';
  const p = v <= median
    ? 25 + (median === p25 ? 25 : ((v - p25) / (median - p25)) * 25)
    : 50 + (p75 === median ? 25 : ((v - median) / (p75 - median)) * 25);
  return `p${Math.round(p)}`;
}

// ---- mandate clauses in words ------------------------------------------------------------------


/** A rule's name in plain words (lib/words.ts RULE_NAME, lower-cased for running text). */
export const CLAUSE_NAME: Record<Clause['type'], string> = Object.fromEntries(
  (Object.entries(RULE_NAME) as [Clause['type'], string][]).map(([k, v]) => [k, v.toLowerCase()]),
) as Record<Clause['type'], string>;

/** One rule as a short sentence (lib/words.ts ruleSentence). */
export const clauseText = (c: Clause): string => ruleSentence(c);

/** Active mandates that can authorize a deal of `kind`: the mandate check requires a per-deal
 *  clause naming that kind, so a mandate without one never governs it. Order is mandate_list's. */
export function mandatesGoverning<M extends { payload: { clauses: Clause[] } }>(list: readonly M[], kind: DealKind): M[] {
  return list.filter((m) => m.payload.clauses.some((c) => c.type === 'per_deal' && c.kind === kind));
}

const BEAD_WORD: Record<BeadKind, string> = { moving: 'moving', held: 'held', settled: 'settled', stopped: 'stopped', off: 'withdrawn or voided' };

/** "1 held · 2 settled · 1 stopped" for a module's deals (hub headline when nothing needs you). */
export function beadSummary(deals: DealLike[]): string {
  if (!deals.length) return 'no deals yet';
  const order: BeadKind[] = ['moving', 'held', 'settled', 'stopped', 'off'];
  const n = new Map<BeadKind, number>();
  for (const d of deals) n.set(beadKind(d), (n.get(beadKind(d)) ?? 0) + 1);
  return order.filter((k) => n.get(k)).map((k) => `${n.get(k)} ${BEAD_WORD[k]}`).join(' · ');
}

// ---- Rewind: the week replayed from the verified record (deal_history) -----------------------------

/** Where each deal stood at time `t` (Unix seconds), from the history steps: the state after its
 *  latest step at or before `t`, and whether a safety check had paused it then. A deal whose first
 *  step is after `t` did not exist yet and is absent. A deal that began but has no state yet is
 *  still connecting. Steps may come in any order; equal times follow the record's order. */
export type HistoryPoint = { state: DealState; paused: boolean; last: HistoryStep };
export function historyAt(steps: readonly HistoryStep[], t: number): Map<string, HistoryPoint> {
  const ordered = [...steps].sort((a, b) => a.at - b.at || a.seq - b.seq);
  const out = new Map<string, HistoryPoint>();
  for (const s of ordered) {
    if (s.at > t) break;
    const was = out.get(s.deal_id);
    const paused = s.kind === 'shield_held' ? true : s.kind === 'hold_released' ? false : was?.paused ?? false;
    out.set(s.deal_id, { state: s.state_after ?? was?.state ?? 'PAIRING', paused, last: s });
  }
  return out;
}

/** True when a money step of `last`'s deal is still being checked with PayPal once `last` has happened:
 *  by the deal's steps up to and including `last` (by time, then record order), a check opened and
 *  no money call since answered ok or failed. A step of another deal, or after `last`, does not count. */
export function checkOpenThrough(steps: readonly HistoryStep[], last: HistoryStep): boolean {
  const through = steps
    .filter((s) => s.deal_id === last.deal_id && (s.at < last.at || (s.at === last.at && s.seq <= last.seq)))
    .sort((a, b) => a.at - b.at || a.seq - b.seq);
  let open = false;
  for (const s of through) {
    if (s.kind === 'checking_with_paypal') open = true;
    else if (isMoneyCall(s) && s.paypal.type === 'call') {
      if (s.paypal.outcome === 'unknown') open = true;
      else if (s.paypal.outcome === 'ok' || s.paypal.outcome === 'failed') open = false;
    }
  }
  return open;
}

/** True when `end` is a deal's ending at its deadline (expired or lapsed) while a money step was still
 *  being checked with PayPal: PayPal never showed what happened, so "no money moved" is not known. */
export function endedBeforePayPalShowed(steps: readonly HistoryStep[], end: HistoryStep): boolean {
  if (end.kind !== 'expired' && end.kind !== 'lapsed') return false;
  return checkOpenThrough(steps, end);
}

/** How a deadline ending `s` reads: `unshown` when it came while a money step was open (by the steps,
 *  or by the deal's own record), else `unread` when that record could not be read. */
export function endingCtx(steps: readonly HistoryStep[], s: HistoryStep, unshown: ReadonlySet<string>, unread: ReadonlySet<string>): { unshown: boolean; unread: boolean } {
  const shown = endedBeforePayPalShowed(steps, s) || unshown.has(s.deal_id);
  return { unshown: shown, unread: !shown && unread.has(s.deal_id) };
}

const NO_IDS: ReadonlySet<string> = new Set();

/** The Rewind's bead tip for a deal whose money step is open at the playhead (the pill and the money
 *  line the live tip shows at Home), or null when nothing is open. `unshown` holds the deals whose
 *  ending came after a check that began before the week; `unread` the endings whose own record could
 *  not be read, which read as not available yet rather than as nothing moved. */
export function rewindCheckTip(steps: readonly HistoryStep[], p: HistoryPoint, deal: Deal, unshown: ReadonlySet<string>, unread: ReadonlySet<string> = NO_IDS): { state: string; money: string } | null {
  const ended = isTerminal({ ...deal, state: p.state });
  if (checkOpenThrough(steps, p.last) || (ended && unshown.has(deal.id))) return { state: moneyCheckPillText(ended), money: moneyCheckNow(ended) };
  if (ended && unread.has(deal.id)) return { state: ENDING_UNREAD_PILL, money: ENDING_UNREAD_NOW };
  return null;
}

/** A tick's colour on the PayPal lane: who decided the call. */
export type TickTone = 'owner' | 'rule' | 'buyer' | 'default' | 'refused' | 'unknown';
const MONEY_CALLS: ReadonlySet<PaypalMethod> = new Set(['create_order', 'authorize', 'capture', 'void', 'create_invoice', 'send_invoice']);
/** True for a step that asked PayPal to move money (an order, a hold, a payment, a release). */
export const isMoneyCall = (s: HistoryStep): boolean => s.paypal.type === 'call' && MONEY_CALLS.has(s.paypal.method);
/** True for a step your rules or a check refused before PayPal was asked. */
export const isRefusal = (s: HistoryStep): boolean => s.kind === 'refused' || s.kind === 'intent_refused';
/** The steps the lane draws: every money call, and every refusal (an × with no PayPal call). */
export const laneSteps = (steps: readonly HistoryStep[]): HistoryStep[] => steps.filter((s) => isMoneyCall(s) || isRefusal(s));

/** Owner = gold, a rule you signed = teal, the buyer's approval under your shop rules = green, a
 *  safe default = grey; a refusal is an ×. An agent or nobody is never a money call's authority,
 *  so that shows as unknown (dashed) rather than borrowing a colour. */
export function tickTone(s: HistoryStep): TickTone {
  if (isRefusal(s)) return 'refused';
  switch (s.authority.type) {
    case 'owner': return 'owner';
    case 'signed_rule': case 'house_mandate': return 'rule';
    case 'seller_mandate': return 'buyer';
    case 'safe_default': return 'default';
    case 'agent_intent': case 'none': return 'unknown';
    // The shop-around rule only ever says no to a seller; it never moves money.
    case 'group_rule': return 'default';
  }
}
export const TICK_WORD: Record<TickTone, string> = {
  owner: 'You decided',
  rule: 'Your signed rule',
  buyer: 'Buyer approved, your shop rules collected',
  default: 'Safe default',
  refused: 'Refused, PayPal never asked',
  unknown: 'Not recorded',
};

/** Who decided a step, in Maya's words ("You", "Your rules", ...); empty when nobody decided. */
export function whoDecided(a: HistoryAuthority): string {
  switch (a.type) {
    case 'owner': return 'You';
    case 'signed_rule': return 'Your rules';
    case 'seller_mandate': return 'Your shop rules';
    case 'house_mandate': return 'The house seller’s rules';
    case 'safe_default': return 'The safe default';
    case 'agent_intent': return 'Your agent';
    case 'none': return '';
    case 'group_rule': return 'Your shop-around choice';
  }
}

/** "Tue 14:02" (local), the moment a step happened. */
export function stepTime(unix: number): string {
  const d = new Date(unix * 1000);
  return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/** One step in plain words, without its time: who did what to which deal, and what PayPal saw.
 *  `title` is the deal's short title; `side` adjusts paying vs collecting. Never a clause number. */
export function stepSentence(s: HistoryStep, ctx: { title: string; side?: Side; unshown?: boolean; unread?: boolean }): string {
  const x = ctx.title;
  const who = whoDecided(s.authority);
  const by = (fallback: string) => who || fallback;
  const call = s.paypal.type === 'call' ? s.paypal.outcome : null;
  const tail = call === 'failed' ? ' PayPal said no.' : call === 'unknown' ? ' PayPal’s answer is not confirmed yet.' : '';
  const seller = ctx.side === 'seller';
  switch (s.kind) {
    case 'refused': {
      const clause = s.authority.type === 'signed_rule' ? s.authority.clause : null;
      return clause !== null
        ? `Your rules refused ${x}: ${refusedBecause(clause)}. PayPal was never asked.`
        : `A safety check refused ${x}. PayPal was never asked.`;
    }
    case 'intent_refused': return `Your rules stopped your agent on ${x}. PayPal was never asked.`;
    case 'created': return `${x} started.`;
    case 'offer_sent': return `Your agent made an offer on ${x}.`;
    case 'offer_received': return `They made an offer on ${x}.`;
    case 'accept_sent': return `Your agent accepted ${x}.`;
    case 'accept_received': return `They accepted ${x}.`;
    case 'owner_accepted': return `You accepted ${x}.`;
    case 'agreed': return who && who !== 'Your agent' ? `${who} agreed ${x}.` : `${x} was agreed.`;
    case 'proposed': return `Your agent asked to buy ${x}.`;
    case 'countersigned': return `${by('Someone')} approved ${x}.`;
    case 'pay_link_sent': return `The PayPal link for ${x} went to the buyer.`;
    case 'pay_link_received': return `The seller sent the PayPal link for ${x}.`;
    case 'approval_notice': return `The buyer says ${x} is approved on PayPal.`;
    case 'order_created': return `${by('The wallet')} asked PayPal for the order for ${x}.${tail}`;
    case 'approved_by_buyer': return seller ? `The buyer approved ${x} on PayPal.` : `${x} was approved on PayPal.`;
    case 'authorized': return s.authority.type === 'seller_mandate'
      ? `The buyer approved, so your shop rules put ${x} on hold at PayPal.${tail}`
      : `${by('The wallet')} put ${x} on hold at PayPal.${tail}`;
    case 'captured': return s.authority.type === 'seller_mandate'
      ? `The buyer approved, so your shop rules collected ${x}.${tail}`
      : `${by('The wallet')} ${seller ? 'collected' : 'paid for'} ${x}.${tail}`;
    case 'voided': return `${by('The wallet')} released the hold on ${x}. Nothing was paid.${tail}`;
    case 'auto_voided': return `The hold on ${x} ran out and released itself. Nothing was paid.${tail}`;
    case 'receipt_sent': case 'receipt_received': case 'receipted': return `The receipt for ${x} was saved.`;
    case 'receipt_refused': return receiptRefusedSentence(x);
    case 'unconfirmed': return unconfirmedSentence(x);
    case 'reporting_checked': return `${x} was checked against PayPal’s statement.`;
    case 'reconciled': return `${x} is on PayPal’s statement.`;
    case 'withdraw_sent': return `Your side walked away from ${x}. No money moved.`;
    case 'withdraw_received': return `They walked away from ${x}. No money moved.`;
    case 'withdrawn': return `${x} was withdrawn. No money moved.`;
    case 'expired': case 'lapsed':
      if (ctx.unshown) return `${x} ended at its deadline before PayPal showed what happened to its payment. Look at the payment in PayPal.`;
      if (ctx.unread) return endingUnreadSentence(x);
      return s.kind === 'expired' ? `The deadline passed on ${x}. No money moved.` : `Nobody acted on ${x} in time, so it lapsed. No money moved.`;
    case 'shield_held': return `A safety check paused ${x} before PayPal was asked.`;
    case 'hold_released': return `You let ${x} go on after a safety pause.`;
    case 'mismatch': return `The payment request for ${x} did not match the deal. No pay button was offered.`;
    case 'failed': return `${x} failed at PayPal.`;
    case 'refunded': return `${x} was refunded.`;
    case 'disputed': return `${x} is disputed at PayPal.`;
    case 'checking_with_paypal': return `PayPal’s answer about ${x} didn’t arrive, so the wallet is asking PayPal what happened. Nothing more is sent until it knows.`;
    case 'other': return `Something was recorded on ${x}.`;
    case 'renewal_failed': return `A renewal failed on ${x}. A fix waits for you; nothing is sent until you approve it.`;
    case 'invoice_created': return `${by('The wallet')} had PayPal make the invoice for ${x}. Nobody is asked to pay yet.${tail}`;
    case 'invoice_sent': return `${by('The wallet')} had PayPal send the invoice for ${x} to the subscriber.${tail}`;
    case 'invoice_paid': return `The subscriber paid the invoice for ${x} on PayPal.`;
    case 'group_withdrawn': return `Another seller agreed first, so your wallet told this seller no on ${x}. No money moved.`;
  }
}

/** The hub's line for the step under the playhead: "Tue 14:02 · Your rules refused 40 × GPU: …". */
export const narrate = (s: HistoryStep, ctx: { title: string; side?: Side; unshown?: boolean; unread?: boolean }): string => `${stepTime(s.at)} · ${stepSentence(s, ctx)}`;

/** The latest step at or before `t` (the record's order breaks ties): what the hub tells. */
export function stepUnder(steps: readonly HistoryStep[], t: number): HistoryStep | null {
  let best: HistoryStep | null = null;
  for (const s of steps) {
    if (s.at > t) continue;
    if (!best || s.at > best.at || (s.at === best.at && s.seq > best.seq)) best = s;
  }
  return best;
}

/** Where `t` sits on a [start, end) week, 0..1, clamped. */
export const weekFraction = (t: number, start: number, end: number): number => (end <= start ? 0 : Math.min(1, Math.max(0, (t - start) / (end - start))));

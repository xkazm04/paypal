// Pure logic for the Main window: which module a deal belongs to, how its state reads as a bead
// and a chip, the state path for its kind, the ledger summary and routing.
// No React, no IPC - everything here is unit-tested in logic.test.ts.
//
// MODULE MAPPING (documented contract for the bead strip, the tabs and every module layer):
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

type DealLike = Pick<Deal, 'kind' | 'shield' | 'state'> & Partial<Pick<Deal, 'side'>>;

export function moduleOf(deal: Pick<Deal, 'kind' | 'shield'>, attention?: Pick<AttentionItem, 'module'> | null): Module {
  if (attention) return attention.module;
  if (deal.shield === 'HOLD' || deal.shield === 'BLOCK') return 'shield';
  switch (deal.kind) {
    case 'haggle': return 'tables';
    case 'purchase': return 'spend';
    case 'shop_order': return 'counter';
    case 'rescue': return 'rescue';
    case 'invoice': return 'book';
  }
}

/** Modules whose one decision depends on a backend that is not attached yet. */
export const PENDING_BACKEND: Partial<Record<Module, string>> = {
  counter: 'Your shop’s catalog is not connected yet, so list prices, stock and quotes can’t be shown. Orders you already have still appear here.',
};

// ---- states -------------------------------------------------------------------------------

export const SETTLED: ReadonlySet<DealState> = new Set(['CAPTURED', 'RECEIPTED', 'RECONCILED']);
/** Paid as far as this wallet knows: money moved and, for a buyer, PayPal said so. */
const paid = (d: DealLike): boolean => SETTLED.has(d.state) && !sellerSaysOnly(d);
export const OFF: ReadonlySet<DealState> = new Set(['WITHDRAWN', 'EXPIRED', 'VOIDED', 'AUTO_VOIDED', 'REFUNDED']);
const LIVE: ReadonlySet<DealState> = new Set(['PAIRING', 'LISTED', 'NEGOTIATING', 'AGREED', 'SETTLING']);

/** `unknown` (a dashed outline) is never a state's own kind: beadKind does not return it. The dial
 *  draws it for a payment whose outcome is not known (beadLook.ts), so it never looks on hold. */
export type BeadKind = 'moving' | 'held' | 'settled' | 'stopped' | 'off' | 'unknown';

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
export const BRANCH_AFTER: Partial<Record<DealState, DealState>> = { VOIDED: 'AUTHORIZED', AUTO_VOIDED: 'AUTHORIZED', REFUNDED: 'CAPTURED', DISPUTED: 'CAPTURED', MISMATCH: 'SETTLING', UNCONFIRMED: 'AWAITING_APPROVAL' };

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

/** One word per authority, read by decidedBy (the answer line) and whoDecided (the story's
 *  "Who decided"), so a deal page never names one decider two ways. */
export const AUTHORITY_WORD = { you: 'You', policy: 'Your rules', shop: 'Your shop rules', house: 'The house seller’s rules', default: 'The safe default' } as const;
const lc = (w: string): string => w.charAt(0).toLowerCase() + w.slice(1);

export type DecidedWho = 'you' | 'policy' | 'default' | 'none';
export type DecidedFact = { who: DecidedWho; text: string; why: string };

/** Who decided this deal, from the authority Rust recorded with the decision (the same value the
 *  audit log carries). Absent means nothing has decided it yet, or an older shell: said as such. */
export function decidedBy(d: Pick<Deal, 'decided_by'>): DecidedFact {
  const v = d.decided_by;
  if (!v) return { who: 'none', text: 'not decided yet', why: 'Nobody, no rule and no deadline has decided this deal yet.' };
  switch (v.type) {
    case 'human': return { who: 'you', text: lc(AUTHORITY_WORD.you), why: 'You decided it yourself, in the approval window.' };
    case 'policy': return { who: 'policy', text: `${lc(AUTHORITY_WORD.policy)} · ${ruleNameOf(v.clause).toLowerCase()}`, why: `A rule you signed decided it without asking you: “${ruleNameOf(v.clause)}” (rule ${v.clause}).` };
    case 'seller_mandate': return { who: 'policy', text: lc(AUTHORITY_WORD.shop), why: 'Your signed shop rules collected it after the buyer approved on PayPal.' };
    case 'house_mandate': return { who: 'policy', text: lc(AUTHORITY_WORD.house), why: 'The house seller’s fixed rules decided it.' };
    case 'safe_default': return { who: 'default', text: lc(AUTHORITY_WORD.default), why: 'Nobody acted before the deadline, so the safe default applied. It never pays.' };
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

/** The three tabs of the old owner configuration sheet. They are layers now (`Place`); modules
 *  still name them this way (`Nav.onSheet`), and `placeOfSheet` maps each to its layer. */
export type SheetTab = 'settings' | 'pairing' | 'mandates';
/** The five in-app setup steps (#s=setup&step=...), in order. The first is the fallback. */
export const SETUP_STEPS = ['keys', 'rules', 'practice', 'agent', 'unlock'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
/** Where a deal page was opened from (its parent in the stack): a module, or one of its detail views. */
export type DealFrom = { module: Module; view?: string };
/** The owner's places, each a layer of the console (rebuild WP2.5; they were sheets before):
 *  agent rules and the wallet limits under them, connections and the pairing desk, settings, and
 *  the safety record. */
export const PLACES = ['rules', 'limits', 'connections', 'pairing', 'settings', 'safety'] as const;
export type Place = (typeof PLACES)[number];
/** Where a place was opened from, when that is not its usual parent: a module page, or Settings. */
export type PlaceFrom = Module | 'settings';
export type Route =
  /** The decision centre (the console's first layer). */
  | { level: 'home' }
  /** `view` is a nested detail page of the module (absent = the summary page). */
  | { level: 'module'; module: Module; view?: string }
  /** `from` is the module page the deal was opened from; absent = the deal's own module. `view` is
   *  one of the page's nested views (a card's view on the same sheet; absent = none open). */
  | { level: 'deal'; deal: string; from?: DealFrom; view?: string }
  /** The in-app Set up page (the Charter); `step` absent = the first step. */
  | { level: 'setup'; step?: SetupStep }
  /** Everything that waits on the owner; `module` narrows it to one module. */
  | { level: 'waiting'; module?: Module }
  /** The week replayed from the wallet's record. */
  | { level: 'rewind' }
  /** One of the owner's places; `from` is where it was opened (Back returns there); `view` is one
   *  of its cards' nested views on the same sheet (absent = none open). */
  | { level: 'place'; place: Place; from?: PlaceFrom; view?: string };

const isSetupStep = (v: string | null): v is SetupStep => !!v && (SETUP_STEPS as readonly string[]).includes(v);
const isModule = (v: string | null): v is Module => !!v && (MODULE_KEYS as readonly string[]).includes(v);
const isPlace = (v: string | null): v is Place => !!v && (PLACES as readonly string[]).includes(v);
/** A view key is a short slug; anything else is dropped so the hash can never carry free text. */
const VIEW_KEY = /^[a-z][a-z0-9-]{0,39}$/;

/** The layer an old sheet tab opens. */
export const placeOfSheet = (t: SheetTab): Place => (t === 'mandates' ? 'rules' : t);

/**
 * The hash forms (every older link still parses): `#m=<module>[&v=<view>]`, `#d=<deal>[&m=..&v=..][&dv=<view>]`
 * (the deal, the module page it was opened from, and the deal's own open view; `#d=<deal>&v=<view>`
 * with no `&m=` is read as the deal's view too), `#p=<place>[&m=<module>|&m=settings][&v=<view>]` (an
 * owner place, where it was opened from, and its open view),`#s=setup&step=<step>`, `#w=waiting[&f=<module>]`, `#r=rewind`,
 * `#c=centre` (= no hash). Older forms: `#s=settings|pairing|mandates` (the old sheet, drawn over any
 * route) opens that place; `#m=<module>&p=safety` (the old safety sheet over a module) opens the safety
 * record from that module.
 */
export function parseHash(hash: string): { route: Route } {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const m = params.get('m');
  const d = params.get('d');
  const s = params.get('s');
  const v = params.get('v');
  const p = params.get('p');
  // An old sheet or the safety sheet was drawn over the route: the place is what was in front.
  if (s === 'settings' || s === 'pairing' || s === 'mandates') return { route: { level: 'place', place: placeOfSheet(s) } };
  if (isPlace(p)) {
    const from: PlaceFrom | null = !d && (isModule(m) || m === 'settings') && m !== p ? m : null;
    const route: Route = from ? { level: 'place', place: p, from } : { level: 'place', place: p };
    return { route: !d && v && VIEW_KEY.test(v) ? { ...route, view: v } : route };
  }
  if (d) {
    const from: DealFrom | null = isModule(m) ? (v && VIEW_KEY.test(v) ? { module: m, view: v } : { module: m }) : null;
    const route: Route = from ? { level: 'deal', deal: d, from } : { level: 'deal', deal: d };
    // The deal's own view is `dv` (`v` after `&m=` is the module view it was opened from); with no
    // `&m=`, `v` is taken as the deal's view too.
    const dv = params.get('dv') ?? (isModule(m) ? null : v);
    return { route: dv && VIEW_KEY.test(dv) ? { ...route, view: dv } : route };
  }
  if (s === 'setup') {
    const step = params.get('step');
    return { route: { level: 'setup', step: isSetupStep(step) ? step : 'keys' } };
  }
  if (params.get('r') === 'rewind') return { route: { level: 'rewind' } };
  if (params.get('w') === 'waiting') {
    const f = params.get('f');
    return { route: isModule(f) ? { level: 'waiting', module: f } : { level: 'waiting' } };
  }
  if (isModule(m)) {
    return { route: v && VIEW_KEY.test(v) ? { level: 'module', module: m, view: v } : { level: 'module', module: m } };
  }
  return { route: { level: 'home' } };
}

export function formatHash(route: Route): string {
  const parts: string[] = [];
  switch (route.level) {
    case 'home': break;
    case 'setup': return `#s=setup&step=${route.step ?? 'keys'}`;
    case 'module':
      parts.push(`m=${route.module}`);
      if (route.view) parts.push(`v=${encodeURIComponent(route.view)}`);
      break;
    case 'deal':
      parts.push(`d=${encodeURIComponent(route.deal)}`);
      if (route.from) {
        parts.push(`m=${route.from.module}`);
        if (route.from.view) parts.push(`v=${encodeURIComponent(route.from.view)}`);
      }
      if (route.view) parts.push(`dv=${encodeURIComponent(route.view)}`);
      break;
    case 'waiting':
      parts.push('w=waiting');
      if (route.module) parts.push(`f=${route.module}`);
      break;
    case 'rewind': parts.push('r=rewind'); break;
    case 'place':
      parts.push(`p=${route.place}`);
      if (route.from) parts.push(`m=${route.from}`);
      if (route.view) parts.push(`v=${encodeURIComponent(route.view)}`);
      break;
  }
  return parts.length ? `#${parts.join('&')}` : '';
}

/** The nested view open on a deal's or a place's sheet (null: none, or another kind of layer). */
export const sheetViewOf = (r: Route): string | null => ((r.level === 'deal' || r.level === 'place') && r.view ? r.view : null);

/** The same deal or place with no nested view open (any other route unchanged). */
export function withoutView(r: Route): Route {
  if (r.level !== 'deal' && r.level !== 'place') return r;
  if (!r.view) return r;
  const { view: _view, ...rest } = r;
  return rest;
}

/** A place's usual parent when it was not opened from anywhere in particular (null = the centre). */
export const PLACE_PARENT: Readonly<Record<Place, Place | null>> = { rules: null, limits: 'rules', connections: null, pairing: 'connections', settings: null, safety: null };

/**
 * Where Esc / the back button goes from `route` (overlays are handled before this): a module's
 * detail page -> its summary, a module, setup, the waiting list or the Rewind -> home, a deal -> the
 * page it was opened from, else its module (or home); a place -> where it was opened from, else its
 * usual parent (the wallet limits -> agent rules, the pairing desk -> connections), else home.
 * `knownView` says whether the route's view is a real page (an unknown one already shows the
 * summary, so it steps straight on). Null at home.
 */
export function stepBack(route: Route, dealModule: Module | null, knownView = true): Route | null {
  // A deal's or a place's open view closes first: the same sheet with nothing open.
  if ((route.level === 'deal' || route.level === 'place') && route.view) return withoutView(route);
  switch (route.level) {
    case 'home': return null;
    case 'setup': case 'waiting': case 'rewind': return { level: 'home' };
    case 'deal':
      if (route.from) return route.from.view && knownView ? { level: 'module', module: route.from.module, view: route.from.view } : { level: 'module', module: route.from.module };
      return dealModule ? { level: 'module', module: dealModule } : { level: 'home' };
    case 'module': return route.view && knownView ? { level: 'module', module: route.module } : { level: 'home' };
    case 'place': {
      if (route.from === 'settings') return { level: 'place', place: 'settings' };
      if (route.from) return { level: 'module', module: route.from };
      const up = PLACE_PARENT[route.place];
      return up ? { level: 'place', place: up } : { level: 'home' };
    }
  }
}

/** Resolve a deal reference from the hash: a ULID, or a display label like "D-0193". */
export function resolveDealRef(ref: string, deals: Deal[], labels: ReadonlyMap<string, string>): Deal | undefined {
  const byId = deals.find((d) => d.id === ref);
  if (byId) return byId;
  const want = ref.toUpperCase();
  return deals.find((d) => (labels.get(d.id) ?? '').toUpperCase() === want);
}

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
    case 'owner': return AUTHORITY_WORD.you;
    case 'signed_rule': return AUTHORITY_WORD.policy;
    case 'seller_mandate': return AUTHORITY_WORD.shop;
    case 'house_mandate': return AUTHORITY_WORD.house;
    case 'safe_default': return AUTHORITY_WORD.default;
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

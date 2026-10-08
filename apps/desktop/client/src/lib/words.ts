// The Table's user-facing vocabulary (docs/ux/UX-GUIDE.md). Every page speaks through these
// helpers so a term is spelled once: plain words on Layer 1, the exact protocol / PayPal facts
// one layer down in Details. Display only: nothing here decides, gates or moves money.
import type { Clause } from '@bindings/Clause';
import type { DealKind } from '@bindings/DealKind';
import type { DealState } from '@bindings/DealState';
import type { HouseRecord } from '@bindings/HouseRecord';
import type { Mode } from '@bindings/Mode';
import type { MoneyCheck } from '@bindings/MoneyCheck';
import type { MoneyCheckStep } from '@bindings/MoneyCheckStep';
import type { ReceiptEvidence } from '@bindings/ReceiptEvidence';
import type { Reconciliation } from '@bindings/Reconciliation';
import type { Role } from '@bindings/Role';
import type { Side } from '@bindings/Side';
import type { ShieldVerdict } from '@bindings/ShieldVerdict';
import { formatMoney } from './format';

/** Tone of a status pill: maps onto the `ui-chip` tones. */
export type WordTone = 'teal' | 'gold' | 'ok' | 'red' | 'coral' | 'line';
export type Word = { text: string; tone: WordTone; /** One sentence for a tooltip / popover. */ means: string };

// ---- deal states --------------------------------------------------------------------------------

const STATE: Record<DealState, Word> = {
  PAIRING: { text: 'Connecting', tone: 'teal', means: 'The two wallets are confirming each other. Nothing is offered yet.' },
  LISTED: { text: 'Listed', tone: 'teal', means: 'On the table. No offer has been made yet.' },
  NEGOTIATING: { text: 'Negotiating', tone: 'teal', means: 'The agents are trading offers inside your price range. No money has moved.' },
  AGREED: { text: 'Agreed', tone: 'teal', means: 'Both sides signed the same price. No money has moved yet.' },
  SETTLING: { text: 'Preparing payment', tone: 'teal', means: 'The seller is creating the PayPal order. No money has moved yet.' },
  AWAITING_APPROVAL: { text: 'Waiting for approval', tone: 'gold', means: 'Waiting for an approval on PayPal. No money has moved yet.' },
  APPROVED: { text: 'Approved on PayPal', tone: 'gold', means: 'The buyer approved on PayPal. The money is not taken yet.' },
  AUTHORIZED: { text: 'On hold', tone: 'gold', means: 'PayPal is holding the money. It is paid only when collected, and released if not.' },
  CAPTURED: { text: 'Paid', tone: 'ok', means: 'The money moved at PayPal.' },
  RECEIPTED: { text: 'Paid, receipt saved', tone: 'ok', means: 'Paid, and the receipt is stored with the deal.' },
  RECONCILED: { text: 'Paid, on statement', tone: 'ok', means: 'Paid, and PayPal’s own statement shows the same payment.' },
  WITHDRAWN: { text: 'Withdrawn', tone: 'line', means: 'Someone walked away before paying. No money moved.' },
  EXPIRED: { text: 'Expired', tone: 'line', means: 'The deadline passed. No money moved.' },
  REFUSED: { text: 'Refused', tone: 'red', means: 'Your rules or a safety check refused it before PayPal was ever asked.' },
  MISMATCH: { text: 'Amount didn’t match', tone: 'red', means: 'The payment request did not match the agreed deal, so no pay button was offered.' },
  FAILED: { text: 'Failed', tone: 'red', means: 'The payment failed at PayPal.' },
  VOIDED: { text: 'Hold released', tone: 'line', means: 'The hold was cancelled. Nothing was paid.' },
  AUTO_VOIDED: { text: 'Hold released', tone: 'line', means: 'The hold ran out and released itself. Nothing was paid.' },
  REFUNDED: { text: 'Refunded', tone: 'line', means: 'The payment was returned.' },
  DISPUTED: { text: 'Disputed', tone: 'red', means: 'There is an open dispute at PayPal.' },
};

/** A deal state in Maya's words. `side` / `kind` adjust the few states that read differently. */
export function stateWord(state: DealState, ctx: { side?: Side; kind?: DealKind } = {}): Word {
  if (state === 'AWAITING_APPROVAL' && ctx.side === 'seller' && ctx.kind !== 'rescue') {
    return { text: 'Waiting for buyer', tone: 'gold', means: 'The buyer has a PayPal link to approve. No money has moved yet.' };
  }
  if (state === 'AWAITING_APPROVAL' && ctx.kind === 'rescue') {
    return { text: 'Waiting for subscriber', tone: 'gold', means: 'The subscriber has an invoice to pay. No money has moved yet.' };
  }
  if ((state === 'AGREED' || state === 'FAILED') && ctx.kind === 'rescue') {
    return state === 'AGREED'
      ? { text: 'Renewal failed', tone: 'coral', means: 'The subscription renewal did not go through. A fix waits for you; nothing is sent until you approve it.' }
      : { text: 'Fix failed', tone: 'red', means: 'The invoice was cancelled at PayPal. Nothing was recovered.' };
  }
  if (state === 'SETTLING' && ctx.kind === 'rescue') {
    return { text: 'Sending invoice', tone: 'gold', means: 'PayPal is making or sending the invoice you approved. Nothing is paid until the subscriber pays it.' };
  }
  if ((state === 'CAPTURED' || state === 'RECEIPTED' || state === 'RECONCILED') && ctx.side === 'seller') {
    const base = STATE[state];
    return { ...base, text: base.text.replace(/^Paid/, 'Paid to you') };
  }
  return STATE[state];
}

// ---- the big picture: five milestones instead of ten protocol states ----------------------------

export type Milestone = 'talk' | 'agree' | 'approve' | 'pay' | 'proof';
export const MILESTONES: readonly { key: Milestone; text: string }[] = [
  { key: 'talk', text: 'Talk' },
  { key: 'agree', text: 'Agree' },
  { key: 'approve', text: 'Approve' },
  { key: 'pay', text: 'Pay' },
  { key: 'proof', text: 'Proof' },
];
const MILESTONE_OF: Partial<Record<DealState, Milestone>> = {
  PAIRING: 'talk', LISTED: 'talk', NEGOTIATING: 'talk',
  AGREED: 'agree', SETTLING: 'agree',
  AWAITING_APPROVAL: 'approve', APPROVED: 'approve', AUTHORIZED: 'pay',
  CAPTURED: 'pay', RECEIPTED: 'proof', RECONCILED: 'proof',
};
/** Which of the five milestones a state belongs to; null for states that end a deal early. */
export const milestoneOf = (s: DealState): Milestone | null => MILESTONE_OF[s] ?? null;

// ---- shield ---------------------------------------------------------------------------------------

const SHIELD: Record<ShieldVerdict, Word> = {
  CLEAR: { text: 'Looks safe', tone: 'ok', means: 'No check found a reason to stop it.' },
  ASK: { text: 'Check with you', tone: 'gold', means: 'A check wants you to confirm before it goes on.' },
  HOLD: { text: 'Paused for you', tone: 'gold', means: 'Paused before any PayPal call. Only you can release it, by typing the payee’s name.' },
  BLOCK: { text: 'Blocked', tone: 'red', means: 'Stopped for good. A block cannot be released.' },
};
export const shieldWord = (v: ShieldVerdict): Word => SHIELD[v];

// ---- PayPal evidence --------------------------------------------------------------------------------

const RECON: Record<Reconciliation, Word> = {
  not_applicable: { text: 'No statement needed', tone: 'line', means: 'No money moved, so there is nothing to find on PayPal’s statement.' },
  pending_reporting: { text: 'Not on statement yet', tone: 'gold', means: 'PayPal’s statement can lag up to 3 hours behind a payment.' },
  matched: { text: 'On statement', tone: 'ok', means: 'PayPal’s own statement shows the same payment.' },
  mismatch: { text: 'Statement differs', tone: 'red', means: 'PayPal’s statement does not match this deal. Look at the details.' },
};
export const reconWord = (r: Reconciliation): Word => RECON[r];

const RECEIPT: Record<ReceiptEvidence, Word> = {
  NONE: { text: 'No receipt yet', tone: 'line', means: 'Nothing has been paid, or the receipt has not arrived.' },
  SELLER_ATTESTED: { text: 'Seller’s receipt', tone: 'gold', means: 'The seller says it was paid. Your own proof from PayPal is still on its way.' },
  PAYPAL_VERIFIED: { text: 'PayPal receipt', tone: 'ok', means: 'Your wallet checked the payment with PayPal itself.' },
};
export const receiptWord = (r: ReceiptEvidence): Word => RECEIPT[r];

// ---- mode ---------------------------------------------------------------------------------------------

const MODE: Record<Mode, string> = { sandbox: 'Sandbox', replay: 'Replay', scripted_engine: 'Practice agent' };
export const modeWord = (m: Mode): string => MODE[m];

// ---- rules (mandates) -------------------------------------------------------------------------------

export const RULE_NAME: Record<Clause['type'], string> = {
  roles: 'What agents may do',
  counterparties: 'Who they deal with',
  per_deal: 'Limit per deal',
  band: 'Price range',
  velocity: 'Daily limit',
  human_present_over: 'Ask me above',
  payees: 'Approved payees',
  lever: 'Fixes for failed renewals',
  market_watch: 'Keep prices fresh',
};
/** Clause number (1-8) for a clause type: Details only. */
export const RULE_NUMBER: Record<Clause['type'], number> = {
  roles: 1, counterparties: 2, per_deal: 3, band: 4, velocity: 5, human_present_over: 6, payees: 7, lever: 8,
  market_watch: 9,
};
const RULE_BY_NUMBER = Object.fromEntries(Object.entries(RULE_NUMBER).map(([k, n]) => [n, k])) as Record<number, Clause['type']>;
/** "Limit per deal" for clause 3; falls back to "Rule N" for numbers outside 1-7. */
export function ruleNameOf(n: number): string {
  const t = RULE_BY_NUMBER[n];
  return t ? RULE_NAME[t] : `Rule ${n}`;
}

const ROLE: Record<Role, string> = { buy: 'buy', sell: 'sell', shop: 'run your shop', rescue: 'rescue renewals' };
const KIND: Record<DealKind, string> = { purchase: 'purchase', haggle: 'haggle', shop_order: 'shop order', rescue: 'rescue', invoice: 'invoice' };
export const kindWord = (k: DealKind): string => KIND[k];

/** One rule as a short sentence Maya can check at a glance. */
export function ruleSentence(c: Clause): string {
  switch (c.type) {
    case 'roles': return c.roles.length ? `may ${joinWords(c.roles.map((r) => ROLE[r]))}` : 'may do nothing';
    case 'counterparties': return c.rule.type === 'paired' ? 'only wallets you connected' : c.rule.type === 'house' ? 'only the house seller' : c.rule.type === 'subscribers' ? 'only your own subscribers' : `only ${c.rule.keys.length} verified ${c.rule.keys.length === 1 ? 'wallet' : 'wallets'}`;
    case 'per_deal': return `up to ${formatMoney(c.max_amount)} per ${KIND[c.kind]}`;
    case 'band': {
      const parts = [c.ceiling ? `most you'll pay ${formatMoney(c.ceiling)}` : null, c.floor ? `least you'll accept ${formatMoney(c.floor)}` : null].filter(Boolean);
      return `${parts.join(', ') || 'no price limit'} · ${c.max_rounds} offers`;
    }
    case 'velocity': return `up to ${c.max_deals_day} deals and ${formatMoney(c.max_total_day)} a day`;
    case 'human_present_over': return `asks you above ${formatMoney(c.amount)}`;
    case 'payees': return c.payees.length ? `only ${joinWords(c.payees)}` : 'no one yet';
    case 'lever': return `a discount on one missed cycle: up to ${percentWords(c.max_discount_bp)} and ${formatMoney(c.max_discount)} per subscriber`;
    case 'market_watch': return `keeps prices fresh for ${joinWords(c.items.map((i) => i.item_ref))} · ${checksADay(c.max_refreshes_day)}`;
  }
}

/** A basis-point share in words: "20%", "12.5%", "8.33%" (the wallet's own invoice wording). */
export function percentWords(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  if (frac === 0) return `${whole}%`;
  if (frac % 10 === 0) return `${whole}.${frac / 10}%`;
  return `${whole}.${String(frac).padStart(2, '0')}%`;
}

/** A rule set's display name, from the agent it is signed for: "Shopper rules". */
export function rulesName(agent: string | null | undefined): string {
  if (!agent) return 'Rules';
  return `${agent.charAt(0).toUpperCase()}${agent.slice(1)} rules`;
}

// ---- market -------------------------------------------------------------------------------------------

/** Where a price sits against the market reference, in words (percentile goes in the tooltip). */
export function marketWords(v: number, p25: number, median: number, p75: number): Word {
  if (v < p25) return { text: 'below typical', tone: 'ok', means: 'Cheaper than three quarters of comparable listings.' };
  if (v <= median) return { text: 'typical', tone: 'ok', means: 'At or under the middle of comparable listings.' };
  if (v <= p75) return { text: 'a bit above typical', tone: 'line', means: 'Above the middle, inside the usual range.' };
  if (v <= p75 * 1.15) return { text: 'above typical', tone: 'gold', means: 'Above the usual range of comparable listings.' };
  return { text: 'well above typical', tone: 'red', means: 'Far above the usual range of comparable listings.' };
}

/** "up to 12 checks a day": a market-watch rule's daily allowance (T15). */
export const checksADay = (n: number): string => `up to ${n} ${n === 1 ? 'check' : 'checks'} a day`;
/** "Price checks today: 3 of 12": a market-watch rule's day so far (owner facts). */
export const priceChecksToday = (used: number, max: number): string => `Price checks today: ${used} of ${max}`;
/** A deal whose item a signed rule keeps priced (T15). */
export const KEPT_FRESH = 'Kept fresh by your rules';
/** The rule's price checks for today are used up: prices are not checked again until tomorrow. */
export const PRICE_CHECKS_USED_UP = 'Today’s price checks are used up. Prices are checked again tomorrow; until then, a deal with an old price waits for you.';

// ---- small helpers --------------------------------------------------------------------------------------

/** "a, b and c". */
export function joinWords(xs: readonly string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** "2 days 18 h", "3 h 57 min", "9 min": a spoken remaining time (the ticking clock stays `countdown`). */
export function timeLeftWords(seconds: number): string {
  if (seconds <= 0) return 'now';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} ${d === 1 ? 'day' : 'days'}${h ? ` ${h} h` : ''}`;
  if (h) return `${h} h${m ? ` ${m} min` : ''}`;
  return `${Math.max(1, m)} min`;
}

// ---- attention copy from the wallet core ------------------------------------------------------------
// The core (table-attention) writes a short verb plus the amount ("Countersign $329.00"). These
// rewrite only the known leading verbs; anything else passes through unchanged.

const HEADLINE_VERBS: readonly (readonly [RegExp, string])[] = [
  [/^Countersign\b/, 'Approve'],
  [/^Capture or void\b/, 'Pay or release'],
  [/^Release or keep hold\b/, 'Release or keep paused'],
  [/^Payment held\b/, 'Payment paused'],
  [/^Request stopped\b/, 'Stopped'],
  [/^Approve rescue lever\b/, 'Approve a fix'],
];
/** "Countersign $329.00" → "Approve $329.00"; "Mismatch · SETTLE $339 ≠ deal $329" → plain words. */
export function headlineWords(h: string): string {
  const mm = /^Mismatch · SETTLE (\S+) ≠ deal (\S+)/.exec(h);
  if (mm) return `Asked ${mm[1]}, not the agreed ${mm[2]}`;
  for (const [re, to] of HEADLINE_VERBS) if (re.test(h)) return h.replace(re, to);
  return h;
}

const SILENCE_EXACT: Readonly<Record<string, string>> = {
  'authorization auto-voids at the deadline; no capture': 'the hold releases itself at the deadline, nothing is paid',
  'the offer or order lapses at the deadline; no money moves': 'the offer lapses at the deadline, no money moves',
  'Deadline or safe decision completed; no capture was made': 'deadline passed, nothing paid',
};
/** The core's default-on-silence sentence, in plain words where it is a known phrase. */
export const silenceWords = (s: string): string => SILENCE_EXACT[s] ?? s.replace(/\bauto-void\b/g, 'auto-release');

const REASON_EXACT: readonly (readonly [RegExp, string])[] = [
  [/^Seller-owned order: approve on PayPal/i, 'The seller makes this payment request. You approve it on PayPal, and the seller collects.'],
  [/^buyer haggle resources belong to the seller/i, 'The seller makes this payment request. You approve it on PayPal, and the seller collects.'],
  [/^This executor is deferred or replay-only/i, 'This kind of payment can’t be sent from the wallet yet. Nothing will be sent.'],
  [/^rescue executor not attached/i, 'Sending fixes isn’t connected yet. Nothing will be sent.'],
  [/^Enter PayPal sandbox credentials/i, 'Connect PayPal first: add your sandbox keys in wallet setup.'],
];
/** Why the wallet can't act here (ApprovalSummary.unavailable_reason), in plain words; unknown text passes through. */
export function reasonWords(r: string): string {
  for (const [re, to] of REASON_EXACT) if (re.test(r)) return to;
  return r;
}

// ---- proof files --------------------------------------------------------------------------------

/** What each check on a proof file means, keyed by the verifier's stable check id. */
export const PROOF_CHECKS: Readonly<Record<string, string>> = {
  format: 'The file is a proof file this wallet can read.',
  mandate: 'The owner signed the rules this deal ran under.',
  transcript: 'Both agents signed every message, in order, with nothing missing.',
  countersign: 'Each approval names this deal’s price and an approved payee.',
  authority: 'Every money step had the owner’s approval, a signed rule, or a safe default behind it.',
  paypal_order: 'PayPal’s order shows the same price, payee and invoice the deal signed.',
  audit: 'The deal’s records link up, so a change to an earlier one would show.',
  receipt: 'Any receipt is one of the signed messages.',
  evidence: 'The deal’s agent signed the whole file, so nothing in it was changed afterwards.',
};
/** The checks trust the keys inside the file, so the owner key is the anchor a person compares. */
export const PROOF_KEY_ANCHOR = 'Compare this owner key with the key the owner shows you: the checks use the keys inside the file.';
/** What a proof file cannot show (T9). */
export const PROOF_LIMIT = 'The file cannot show whether newer records were removed from the end.';
/** Said once before a proof file is saved: the file is readable by anyone it is sent to. */
export const PROOF_SAVE_WARNING = 'This file carries this deal’s rules, including your price limits (the most you’ll pay or the least you’ll take), the payees and caps, and the other side’s notes. Anyone you send it to can read them.';

// ---- agent runs (T2) ----------------------------------------------------------------------------

/** A run's badge: "Practice agent" when it runs on the scripted engine (mode `scripted_engine`),
 *  null otherwise. Shown beside the run, in addition to the deal's own mode badge. */
export const runBadge = (run: { mode: Mode }): string | null => (run.mode === 'scripted_engine' ? MODE.scripted_engine : null);

// ---- the approval checklist (composed by the wallet, shown verbatim) ----------------------------

/** The wallet's exact refusal when the checklist changed between reading it and deciding. */
export const SUMMARY_CHANGED = 'The summary changed. Review it again.';
/** The wallet's exact refusal of a money decision while one of its checks fails. */
export const CHECK_FAILED = 'A check on this deal failed, so nothing was done.';
/** A check's reading in a word or two, for its mark. */
export const CHECK_STATUS_WORD = { pass: 'passed', fail: 'failed', wait: 'checked later', not_applicable: 'not needed' } as const;

// ---- who decided (the Rewind and the deal's "Who decided") ------------------------------------------

const REFUSED_BECAUSE: Readonly<Record<number, string>> = {
  1: 'not something your agents may do',
  2: 'not a shop you connected',
  3: 'over the per-deal limit',
  4: 'outside your price range',
  5: 'over the daily limit',
  6: 'above the amount you approve yourself',
  7: 'not an approved payee',
  0: 'over your wallet limits',
};
/** Why a rule refused, in words, for "Your rules refused 40 × GPU: over the per-deal limit". */
export const refusedBecause = (clause: number): string => REFUSED_BECAUSE[clause] ?? `against “${ruleNameOf(clause)}”`;

// ---- a payment step being checked with PayPal ---------------------------------------------------
// A money step whose PayPal answer never arrived (the connection dropped, or the answer could not be
// read). The wallet asks PayPal what happened before anything else moves: it is never "failed" and
// never "paid" until PayPal's own record says which.

/** What the step was, in Maya's words (the PayPal verb stays in Details). */
const CHECK_STEP: Record<MoneyCheckStep, string> = {
  create: 'the payment request',
  authorize: 'the hold',
  capture: 'the payment',
  void: 'releasing the hold',
  invoice_create: 'making the invoice',
  invoice_send: 'sending the invoice',
};
export const moneyCheckStep = (s: MoneyCheckStep): string => CHECK_STEP[s];
/** The one sentence for a parked check (the owner sees it on the card and the deal). */
export const MONEY_CHECK_PARKED = 'We couldn’t confirm a payment with PayPal. Nothing more will be sent until we can.';
/** The pill and its meaning. Dashed, like every unknown: never green, never red. */
export function moneyCheckWord(c: MoneyCheck): { text: string; means: string } {
  return c.state === 'parked'
    ? { text: 'Checking with PayPal', means: MONEY_CHECK_PARKED }
    : { text: 'Checking with PayPal', means: `PayPal’s answer about ${CHECK_STEP[c.step]} didn’t arrive. The wallet is asking PayPal what happened. Nothing more is sent until it knows.` };
}
/** The card's "if you do nothing" line while PayPal is being asked (the same words Rust sends). */
export const MONEY_CHECK_SILENCE = 'nothing more is sent until PayPal confirms';

// ---- wallet limits (T14): one cap above every set of rules ------------------------------------------

/** The three wallet limits, as the owner signs them and the meters read them. */
export const LIMIT_WORDS = {
  out: { name: 'Most your agents can pay out in a day', short: 'Paid out today', per: 'a day' },
  held: { name: 'Most on hold at once', short: 'On hold now', per: 'at once' },
  deals: { name: 'Most deals a day', short: 'Deals today', per: 'a day' },
} as const;
/** No limits signed: only each set of rules limits the agents. */
export const NO_WALLET_LIMIT = 'No wallet limit';
/** What the wallet limits are, in one sentence (approval window, owner configuration). */
export const WALLET_LIMITS_ABOUT = 'One cap above all your agents’ rules. It covers money your agents pay out, across every set of rules, and can only make your rules stricter, never looser. Money coming in is never limited.';
/** Signed limits ran out, or could not be checked: money out stops until they are signed again. */
export const LIMITS_EXPIRED = 'Your wallet limits ran out, so your agents can’t pay anyone until you set them again.';
export const LIMITS_UNVERIFIED = 'Your wallet limits couldn’t be checked, so your agents can’t pay anyone until you set them again.';

// ---- rescue: one fix for a failed renewal -----------------------------------------------------
// The fix is a one-time discount on the missed cycle, invoiced by PayPal. The invoice wording is
// the wallet's own (RescueView.text); these are the page's words around it.

/** The card's "if you do nothing" lines, the same words Rust sends (table-attention). */
export const RESCUE_SILENCE = 'nothing is sent · PayPal retries the payment by itself';
export const RESCUE_SENT_SILENCE = 'the invoice stays open until it expires · nothing is charged unless the subscriber pays';
/** Why a paid invoice is or is not counted as money you got back. */
export const RESCUE_COUNTED = 'PayPal shows this invoice paid and your wallet saved the receipt, so it counts as money you got back.';
export const RESCUE_REPLAY_NOT_COUNTED = 'This renewal failure was replayed, not reported by PayPal, so what it brings in is never counted as money you got back.';
export const RESCUE_SENT_NOT_COUNTED = 'Sent is not paid: it counts only once PayPal shows the invoice paid.';
/** What approving a fix does, before the owner holds the button. */
export const RESCUE_APPROVE_DOES = 'PayPal makes one invoice for this cycle at the discounted price and emails it to your subscriber. Nothing is charged: they pay it on PayPal’s page, or it expires.';
/** The replay form, in the approval window. */
export const RESCUE_REPLAY_ABOUT = 'PayPal can’t make a test renewal fail, so you can replay one: enter the subscription and its price, and your wallet suggests one fix inside your rules. The failure is marked as a replay. The invoice it leads to is real, and what it brings in is never counted.';
export const RESCUE_NO_RULES = 'Sign rules for fixing failed renewals first.';
/** A source of a failed renewal, in words. */
export const rescueSourceWord = (s: 'replay' | 'paypal'): string => (s === 'replay' ? 'Replayed failure' : 'Reported by PayPal');
/** A subscriber without a wallet entry, by their subscription: "subscriber I-BW452GLL…". */
export function subscriberName(key: string): string | null {
  if (!key.startsWith('sub:')) return null;
  const id = key.slice(4);
  return `subscriber ${id.length > 12 ? `${id.slice(0, 11)}…` : id}`;
}

// ---- the house seller's signed record (T9): kept with a receipt from the house seller ------------

/** The card's name for the house seller's signed record. */
export const HOUSE_RECORD_NAME = 'House seller’s record';
/** The warning on a deal when the house's record shrank since the receipt (evidence only). */
export const HOUSE_RECORD_SHORTER = 'The house’s record got shorter since your receipt';
/** How the house seller's later record compares with the one kept with your receipt. Evidence only:
 *  a warning changes nothing about the money; it tells you to keep your signed proof. */
export function houseRecordWord(r: HouseRecord): Word & { warns: boolean } {
  const kept = `${r.entries.toLocaleString('en-US')} entries, kept with your receipt`;
  switch (r.state) {
    case 'kept': return { text: 'Kept with your receipt', tone: 'line', warns: false, means: `The house seller signed its whole record when you were paid up: ${kept}. Your wallet compares it with the house’s later record.` };
    case 'holds': return { text: 'Still matches', tone: 'ok', warns: false, means: `The house seller’s later record still contains the one kept with your receipt (${kept}).` };
    case 'longer': return { text: 'Grown since', tone: 'line', warns: false, means: `The house seller’s record has grown since your receipt (${kept}). Your wallet checks that it still contains yours.` };
    case 'restarted': return { text: 'House started a new record', tone: 'coral', warns: true, means: 'The house seller started a new record since your receipt, for example after its storage was replaced. Your receipt and PayPal’s own records are unchanged. Keep your signed proof.' };
    case 'shorter': return { text: 'Record got shorter', tone: 'red', warns: true, means: `${HOUSE_RECORD_SHORTER}. No money moved. Keep your signed proof: it shows what the house agreed.` };
    case 'rewritten': return { text: 'Record changed', tone: 'red', warns: true, means: 'The house’s record no longer contains the one it signed at your receipt. No money moved. Keep your signed proof: it shows what the house agreed.' };
  }
}

// ---- permissions fingerprint (T11): who may do what, as one checkable code -------------------------

/** Details only: the fingerprint of which window may do what in this version of the app. */
export const PERMISSIONS_FINGERPRINT = 'Permissions fingerprint';
/** What the fingerprint means, for its tooltip. */
export const PERMISSIONS_FINGERPRINT_MEANS = 'A short code for which window may do what in this version of the app. The same code means the same permissions.';
/** The fingerprint in groups of eight, so it can be read out and compared. */
export function fingerprintGroups(hex: string): string {
  return (hex.match(/.{1,8}/g) ?? []).join(' ');
}

// ---- first run: from install to a first safe deal ---------------------------------------------------

/** The safety promise, said once per surface on the first-run path (Home hub, Tumbler, approval window). */
export const SAFETY_PROMISE = 'Nothing pays without you or a rule you signed. Waiting never sends money.';
/** The first-run heading: what the three steps lead to. */
export const FIRST_RUN_TITLE = 'Your first safe deal in 3 steps';
/** The three first-run steps, in the order every surface shows them. */
export type StartStepKey = 'paypal' | 'rules' | 'practice';
export const START_STEP: Record<StartStepKey, { title: string; sub: string; done: string; act: string; where: string }> = {
  paypal: {
    title: 'Connect PayPal sandbox', sub: 'Test money only · the keys stay on this computer', done: 'PayPal sandbox connected', act: 'Connect PayPal',
    where: 'Opens the approval window, where a secure dialog saves your sandbox keys',
  },
  rules: {
    title: 'Sign your agents’ rules', sub: 'How much, with whom, and when they ask you', done: 'Rules signed', act: 'Sign rules',
    where: 'Opens the approval window: start from a ready-made set of rules, check it, then sign',
  },
  practice: {
    title: 'Try a practice deal with the house seller', sub: 'A demo shop that is always open · sandbox money', done: 'House seller connected', act: 'Try the house seller',
    where: 'Opens Connections on the house seller, a practice shop built into the app',
  },
};

// ---- shop around (several sellers, one buyer intent) -------------------------------------------

export const SHOP_AROUND = 'Shop around';
/** What grouping does, in one breath: one item, several sellers, one deal at most. */
export const SHOP_AROUND_MEANS = 'Your agent bargains with each seller on its own table, inside the same price range. The first seller to agree wins, and your wallet tells the others no. Only one deal can be agreed, so you pay at most once.';
/** What happens to the other tables once one seller agrees. */
export const SHOP_AROUND_OTHERS = 'The other sellers get a signed “no thanks”. No money moves on their tables.';
/** "Shopping around for the 27-inch 4K monitor" (item already in plain words, with its article). */
export const shoppingFor = (item: string): string => `Shopping around for ${item}`;
export const sellersWord = (n: number): string => `${n} ${n === 1 ? 'seller' : 'sellers'}`;
/** A table the group rule closed because another seller agreed first. */
export const GROUP_CLOSED: Word = { text: 'Another seller agreed', tone: 'line', means: 'Another seller agreed first, so your wallet told this seller no with a signed message. No money moved.' };
/** The table that agreed first. */
export const GROUP_WINNER: Word = { text: 'Agreed first', tone: 'ok', means: 'This seller agreed first. It goes on like any single deal: nothing is paid until it is approved on PayPal.' };

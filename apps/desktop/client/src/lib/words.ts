// The Table's user-facing vocabulary (docs/ux/UX-GUIDE.md). Every page speaks through these
// helpers so a term is spelled once: plain words on Layer 1, the exact protocol / PayPal facts
// one layer down in Details. Display only: nothing here decides, gates or moves money.
import type { Clause } from '@bindings/Clause';
import type { DealKind } from '@bindings/DealKind';
import type { DealState } from '@bindings/DealState';
import type { HouseRecord } from '@bindings/HouseRecord';
import type { Mode } from '@bindings/Mode';
import type { Playbook } from '@bindings/Playbook';
import type { MoneyCheck } from '@bindings/MoneyCheck';
import type { MoneyCheckStep } from '@bindings/MoneyCheckStep';
import type { NotifySuppression } from '@bindings/NotifySuppression';
import type { ReceiptEvidence } from '@bindings/ReceiptEvidence';
import type { Reconciliation } from '@bindings/Reconciliation';
import type { Role } from '@bindings/Role';
import type { Side } from '@bindings/Side';
import type { ShieldRelease } from '@bindings/ShieldRelease';
import type { ShieldRule } from '@bindings/ShieldRule';
import type { ShieldVerdict } from '@bindings/ShieldVerdict';
import type { FairPrice } from '@bindings/FairPrice';
import type { Money } from '@bindings/Money';
import { ordinal } from './fairPrice';
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
  MISMATCH: { text: 'Amount didn’t match', tone: 'red', means: 'The payment request did not match the agreed deal, so the wallet stopped it. It will not be paid.' },
  FAILED: { text: 'Failed', tone: 'red', means: 'The payment failed at PayPal.' },
  VOIDED: { text: 'Hold released', tone: 'line', means: 'The hold was cancelled. Nothing was paid.' },
  AUTO_VOIDED: { text: 'Hold released', tone: 'line', means: 'The hold ran out and released itself. Nothing was paid.' },
  REFUNDED: { text: 'Refunded', tone: 'line', means: 'The payment was returned.' },
  DISPUTED: { text: 'Disputed', tone: 'red', means: 'There is an open dispute at PayPal.' },
};

/** What the seller's receipt is worth to the buyer's wallet until PayPal's own statement matches it. */
export const SELLER_SAYS_PAID = 'The seller says the payment went through. Your wallet has not checked it with PayPal yet.';

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
  // A buyer's deal reaches RECEIPTED only on the seller's signed receipt (evidence seller_attested);
  // it is paid for the buyer only once PayPal's statement matches (RECONCILED).
  if (sellerSaysOnly({ state, ...ctx })) {
    return { text: 'Seller says paid', tone: 'gold', means: SELLER_SAYS_PAID };
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

/** Which check decided the verdict, as the wallet core names it (Deal.shield_rule, a closed list;
 *  never the other side's words). `text` is a short label, `means` the plain sentence. */
const SHIELD_RULE: Record<ShieldRule, Word> = {
  payee_mismatch: { text: 'Different payee', tone: 'red', means: 'The money would go to someone other than the payee you agreed with.' },
  friends_and_family: { text: 'Friends & family', tone: 'red', means: 'It asks to be paid as friends & family, which has no buyer protection.' },
  no_market_reference: { text: 'No usual price', tone: 'gold', means: 'There is no recent usual price to compare it with, so the shield asks you.' },
  price_over_market: { text: 'Price far above usual', tone: 'gold', means: 'The price is more than 1.4 × the usual price.' },
  new_counterparty_over_threshold: { text: 'New payee, large amount', tone: 'gold', means: 'A payee first seen in the last 24 hours is asking for more than 100.00, so the shield asks you.' },
  model_caution: { text: 'A second look', tone: 'gold', means: 'A second look asked for caution. It can only make things safer.' },
};
export const shieldRuleWord = (r: ShieldRule): Word => SHIELD_RULE[r];

/** Whether the owner released this deal's pause for its current terms (Deal.shield_release, from
 *  the wallet core; it is dropped there when the terms change). */
export const shieldReleased = (d: { shield: ShieldVerdict | null; shield_rule?: ShieldRule | null; shield_release?: ShieldRelease | null }): boolean =>
  !!d.shield_release && !!d.shield_rule && d.shield_release.rules.includes(d.shield_rule) && (d.shield === 'ASK' || d.shield === 'HOLD');

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
    case 'payees': return c.payees.length ? `only ${joinWords(c.payees.map(houseWords))}` : 'no one yet';
    case 'lever': return `a discount on one missed cycle: up to ${percentWords(c.max_discount_bp)} and ${formatMoney(c.max_discount)} per subscriber`;
    case 'market_watch': return `keeps prices fresh for ${joinWords(c.items.map((i) => itemWords(i.item_ref)))} · ${checksADay(c.max_refreshes_day)}`;
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

/** The name of the fair-price line on a deal's proof (market-data-2). */
export const FAIR_PRICE_NAME = 'Price vs market';
/** The deal's price against the market prices it was agreed on (DealEvidence.fair_price), worked
 *  out again by the wallet: "$329.00 is the 62nd percentile of 13 market prices · re-checked". */
export function fairPriceWords(fp: FairPrice, price: Money): Word & { short: string } {
  if (fp.state === 'rechecked' && fp.percentile !== null) {
    const n = `${fp.prices} market ${fp.prices === 1 ? 'price' : 'prices'}`;
    return {
      text: `${formatMoney(price)} is the ${ordinal(fp.percentile)} percentile of ${n} · re-checked`,
      short: `${ordinal(fp.percentile)} percentile of ${fp.prices}`,
      tone: 'ok',
      means: fp.committed
        ? 'Worked out again from the market prices this deal was agreed on, kept with the deal.'
        : 'Worked out again from the latest market prices; the deal is not agreed yet.',
    };
  }
  if (fp.state === 'not_recheckable') {
    return {
      text: 'Older market record, not re-checkable',
      short: 'older record',
      tone: 'line',
      means: 'This deal was priced before the wallet kept the market prices behind the typical price, so it can’t be worked out again.',
    };
  }
  return {
    text: 'Market record doesn’t add up',
    short: 'doesn’t add up',
    tone: 'red',
    means: 'The market prices kept with this deal no longer give the typical price it was agreed on.',
  };
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

/** The house seller's payee name and display name read as a name, never a shout: the payee
 *  "HOUSE" is "House seller", and "HOUSE seller" is "House seller". Every place a payee or
 *  counterparty label can carry the house seller's name goes through this (UX guide vocabulary). */
export function houseWords(s: string): string {
  return s.replace(/\bHOUSE\b(?: seller\b)?/g, 'House seller');
}

/** What is on hold, by direction, as one sentence for an answer line:
 *  "$64.00 going out and $118.00 coming in are on hold at PayPal, not paid yet." (one direction
 *  keeps the singular "is"). Each list is already one figure per currency; null when nothing is held. */
export function heldWords(out: string, inn: string): string | null {
  if (out && inn) return `${out} going out and ${inn} coming in are on hold at PayPal, not paid yet.`;
  const one = out || inn;
  return one ? `${one} is on hold at PayPal, not paid yet.` : null;
}

/** A check whose own result never reaches this window, in a few words: never green, never a guess.
 *  `clear`: the shield found nothing to stop; `notIt`: another check decided the pause, so this one
 *  did not stop the payment; `unsaid`: the wallet did not record which check decided. */
export const CHECK_QUIET = {
  clear: { text: 'No alert', means: 'The shield let this payment through, so this check raised no alert. Its own result isn’t reported to this screen, so it isn’t marked as passed.' },
  notIt: { text: 'Didn’t stop it', means: 'Another check paused this payment, not this one. Its own result isn’t reported to this screen, so it isn’t marked as passed.' },
  unsaid: { text: 'Not reported', means: 'Its own result isn’t reported to this screen, so it isn’t marked as passed.' },
} as const;

/** A value the wallet did not give this window (a comparison's other side). */
export const NOT_REPORTED = { text: 'not reported', means: 'Your wallet didn’t give this window this value, so the row is never counted as a pass.' } as const;

const ITEM_ABBR = new Set(['hdmi', 'usb', 'ssd', 'hdd', 'ips', 'qhd', 'uhd', 'lcd', 'led', 'oled', 'gpu', 'cpu', 'psu', 'ram']);
/** An item known only by the code in your shop rules, as a plain name: "dp-cable-2m" → "DP cable 2m",
 *  "hdmi-21" → "HDMI 21", "monitor-27-4k" → "Monitor 27 4K". Display only; the code stays in Details. */
export function itemWords(ref: string): string {
  const parts = ref.split(/[-_\s]+/).filter(Boolean).map((p) => {
    const l = p.toLowerCase();
    if (ITEM_ABBR.has(l) || /^[b-df-hj-np-tv-xz]{2,4}$/.test(l)) return l.toUpperCase();
    if (/^\d+k$/.test(l)) return l.toUpperCase();
    return l;
  });
  const s = parts.join(' ');
  return s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}` : 'Item';
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
  if (mm) return `Asked ${mm[1]}, not ${mm[2]}`;
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
  owner_saw: 'Before each payment you approved, the wallet recorded the checklist you saw.',
  one_request: 'A payment the wallet checked again with PayPal was never sent a second time.',
  group: 'When you shopped around, only one seller’s deal was agreed; the others were called off.',
  shield: 'Nothing was paid while a safety check paused or blocked the deal, unless you released the pause.',
  house_record: 'The house seller’s signed record, kept with your receipt, checks out and never got shorter.',
  permissions: 'The file names the permissions of the app version that saved it.',
  evidence: 'The deal’s agent signed the whole file, so nothing in it was changed afterwards.',
  market: 'The market prices kept with the deal still give the typical price it was agreed on.',
};
/** Why a check reads "not checked": the deal had nothing of its kind, so it makes no claim either way. */
export const PROOF_NOT_APPLICABLE: Readonly<Record<string, string>> = {
  owner_saw: 'Not checked: you made no payment decision on this deal.',
  one_request: 'Not checked: no payment on this deal needed a second look at PayPal.',
  group: 'Not checked: this deal wasn’t part of shopping around.',
  shield: 'Not checked: no safety check paused or blocked this deal.',
  house_record: 'Not checked: no house seller’s record was kept with this deal.',
  permissions: 'Not checked: files saved by older versions of the wallet don’t name their permissions.',
  market: 'Not checked: the deal had no market price when it was agreed.',
};
/** The market line's other "not checked" reasons, told apart by the checker's own fixed words. */
export function proofMarketNotChecked(detail: string): string {
  if (/older market record/.test(detail)) return 'Not checked: the deal was agreed on an older market record, which kept no prices to work out again.';
  if (/not agreed yet/.test(detail)) return 'Not checked: the deal is not agreed yet.';
  return PROOF_NOT_APPLICABLE.market ?? 'Not checked.';
}
/** Said for any check when the file is an older kind that carries none of the newer records. */
export const PROOF_OLDER_FILE = 'Not checked: files saved by older versions of the wallet don’t carry this record.';
/** The file's permissions fingerprint against this wallet's own. */
export const PROOF_VERSION_MATCH = {
  same: 'Made by the same version: the same permissions as your wallet.',
  other: 'A different version: its permissions differ from your wallet’s. That alone is no problem.',
} as const;
/** The answer when every check that applies passed and some had nothing to check. */
export const PROOF_ALL_THAT_APPLY = 'Every check that applies passed';
/** What a saved proof file lets anyone check, listed before saving (plain words, in order). */
export const PROOF_FILE_SHOWS = [
  'Your signed rules, both agents’ signed messages and PayPal’s records for this deal.',
  'The checklist you saw before each payment you approved.',
  'That a payment checked again with PayPal was never sent twice.',
  'If you shopped around, that only one seller’s deal was agreed.',
  'If a safety check paused the deal, that nothing was paid unless you released it.',
  'If you bought from the house seller, its signed record kept with your receipt.',
  'The permissions of this version of the app.',
  'The market prices the deal was agreed on, so anyone can work out the typical price again.',
] as const;
/** The checks trust the keys inside the file, so the owner key is the anchor a person compares. */
export const PROOF_KEY_ANCHOR = 'Compare this owner key with the key the owner shows you: the checks use the keys inside the file.';
/** The file's owner key against this wallet's own (shown under the key, in full). */
export const PROOF_KEY_MATCH = {
  mine: 'Matches your wallet: this file names your owner key.',
  other: 'A different wallet: compare this key with the one its owner shows you.',
} as const;
/** A check the file could not support (it lacks the record compared), so it was not made. */
export const PROOF_NOT_CHECKED = 'Not checked: the file has no PayPal order record to compare. Files saved by older versions of the wallet don’t carry one.';
/** The answer when every check that could be made passed but one or more could not be made. */
export const PROOF_SOME_UNCHECKED = 'Not every check could be made';
/** Your owner key, in Details (Settings, the approval window): what it is and who compares it. */
export const OWNER_KEY = {
  label: 'Your owner key',
  why: 'The public id of the key that signs your rules and approvals; the key itself never leaves this computer. Anyone checking a proof file you send compares its owner key with this, group by group.',
  copied: 'Copied. Send it to whoever checks your proof files, through a channel you trust.',
  noCopy: 'Copy isn’t available here. Read the groups out instead.',
} as const;
/** The audit trail could not be read because the records failed their link check (LEDGER_TRUST). */
export const AUDIT_BROKEN = {
  title: 'Your records failed their link check',
  means: 'An entry was changed, removed or damaged after it was written, or the records could not be read. The wallet can’t vouch for its history, so it shows none of it rather than part of it.',
  todo: [
    'Don’t delete, move or edit the wallet’s files.',
    'Check your PayPal account for what actually moved: PayPal’s own record is unaffected.',
    'Keep the proof files you already saved: each one still checks on its own.',
  ],
} as const;
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
export const MONEY_CHECK_PARKED = 'We couldn’t confirm a payment with PayPal. At the deadline the wallet asks PayPal what happened, and what PayPal shows decides. A hold is released; nothing is collected.';
/** The pill and its meaning. Dashed, like every unknown: never green, never red. */
export function moneyCheckWord(c: MoneyCheck): { text: string; means: string } {
  return c.state === 'parked'
    ? { text: 'Checking with PayPal', means: MONEY_CHECK_PARKED }
    : { text: 'Checking with PayPal', means: `PayPal’s answer about ${CHECK_STEP[c.step]} didn’t arrive. The wallet is asking PayPal what happened. Nothing more is sent until it knows.` };
}
/** The card's "if you do nothing" line while PayPal is being asked (the same words Rust sends). */
export const MONEY_CHECK_SILENCE = 'at the deadline the wallet asks PayPal what happened, releases any hold and collects nothing';

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
/** The fixes a renewal can't have, as one quiet line under the ones it can: "Not offered for this
 *  renewal: pause for a while, retry later and smaller plan." (names as the cards spell them). */
export function notOfferedLine(names: readonly string[]): string {
  return `Not offered for this renewal: ${joinWords(names.map((n) => n.charAt(0).toLowerCase() + n.slice(1)))}.`;
}
/** A source of a failed renewal, in words. */
export const rescueSourceWord = (s: 'replay' | 'paypal'): string => (s === 'replay' ? 'Replayed failure' : 'Reported by PayPal');
/** A subscriber without a wallet entry, by their subscription: "subscriber I-BW452GLL…". */
export function subscriberName(key: string): string | null {
  if (!key.startsWith('sub:')) return null;
  const id = key.slice(4);
  return `subscriber ${id.length > 12 ? `${id.slice(0, 11)}…` : id}`;
}
/** Watching subscriptions for a failed renewal (the owner's list, read from PayPal). */
export const RESCUE_WATCH_ABOUT = 'Your wallet checks each subscription you watch with PayPal every few hours. If a renewal fails, it suggests one fix inside your rules and asks you here. Checking never sends anything and never moves money.';
export const RESCUE_WATCH_EMAIL = 'PayPal doesn’t give your wallet the subscriber’s email, so enter the one you have. A fix’s invoice goes there.';
export const RESCUE_WATCH_FULL = 'You’re watching as many subscriptions as your wallet checks. Stop watching one first.';
/** "Watching 2 subscriptions"; "Not watching any subscriptions yet" for none. */
export const watchingWords = (n: number): string => (n === 0 ? 'Not watching any subscriptions yet' : `Watching ${n} subscription${n === 1 ? '' : 's'}`);
/** What the wallet last learned about a watched subscription, in words, with its chip tone. */
export const RESCUE_WATCH_STATE: Record<'waiting' | 'paid' | 'fix_opened' | 'failed_no_fix' | 'cant_read', { text: string; tone: 'line' | 'ok' | 'gold' | 'coral' | 'dashed'; means: string }> = {
  waiting: { text: 'not checked yet', tone: 'line', means: 'Your wallet checks it with PayPal within a few minutes.' },
  paid: { text: 'renewals paid', tone: 'ok', means: 'The last check showed no failed payment.' },
  fix_opened: { text: 'fix suggested', tone: 'gold', means: 'A renewal failed and your wallet suggested one fix. It is not suggested again for the same failure.' },
  failed_no_fix: { text: 'failed · no fix', tone: 'coral', means: 'A renewal failed, but no fix fits your rules (or more than one payment is owed). Nothing is sent; PayPal retries by itself.' },
  cant_read: { text: 'can’t check now', tone: 'dashed', means: 'PayPal didn’t answer. Your wallet tries again later.' },
};

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
/** The first-run steps, in the order every surface shows them (lib/firstRun.ts START_ORDER). */
export type StartStepKey = 'paypal' | 'rules' | 'practice' | 'engine';
/** `done` heads a ticked step and `doneLine` sits under it; `doneAct` (practice only) is the quiet click a
 *  ticked step keeps, and `doneWhere` says where that click goes when this window cannot take it. */
export const START_STEP: Record<StartStepKey, { title: string; sub: string; done: string; doneLine: string; doneAct?: string; doneWhere?: string; act: string; where: string }> = {
  paypal: {
    title: 'Add your PayPal sandbox keys', sub: 'Test money only · the keys stay on this computer', done: 'PayPal sandbox keys saved', doneLine: 'Saved securely on this computer', act: 'Add PayPal keys',
    where: 'Opens the approval window, where a secure dialog saves your sandbox keys',
  },
  rules: {
    title: 'Sign your agents’ rules', sub: 'How much, with whom, and when they ask you', done: 'Rules signed', doneLine: 'Your agents act only inside them', act: 'Sign rules',
    where: 'Opens the approval window: start from a ready-made set of rules, check it, then sign',
  },
  practice: {
    title: 'Try a practice deal with the house seller', sub: 'A demo shop that is always open · sandbox money', done: 'House seller connected', doneLine: 'Its practice table is ready for you', doneAct: 'Start a practice deal', doneWhere: 'To start a practice deal, open The Table: Connections › House seller', act: 'Try the house seller',
    where: 'Opens Connections on the house seller, a practice shop built into the app',
  },
  engine: {
    title: 'Choose your agent app', sub: 'claude-code or codex-cli · the practice agent plays until then', done: 'Agent app chosen', doneLine: 'Your agents run in it', act: 'Choose agent app',
    where: 'Opens Setup in The Table on the agent app your agents run in',
  },
};
/** Step 4 for an owner with no agent app: keeping the practice agent is a choice, and says only that. */
export const KEEP_PRACTICE_AGENT = {
  act: 'Keep the practice agent for now',
  done: 'Practice agent kept. Add your own agent app any time.',
  where: 'The practice agent plays your deals until you add an agent app',
};
/** The first-run heading: what the steps lead to (the count follows START_STEP). */
export const FIRST_RUN_TITLE = `Your first safe deal in ${Object.keys(START_STEP).length} steps`;

// ---- the tour: a few coach marks on first run, one window at a time ------------------------------

/** Every stop of the tour, by window (lib/tour.ts holds their order and anchors). */
export type TourStopId =
  | 'main.hub' | 'main.promise' | 'main.steps' | 'main.engine' | 'main.approval'
  | 'tumbler.what' | 'tumbler.needs' | 'tumbler.engine' | 'tumbler.waiting'
  | 'approval.only' | 'approval.steps' | 'approval.engine' | 'approval.config';
/** A stop's words: a short title and one or two plain sentences. The tour only points; it never acts. */
export const TOUR_STOP: Record<TourStopId, { title: string; text: string }> = {
  'main.hub': { title: 'Start here', text: 'These steps get your wallet ready for a first safe deal. The gold button always takes you to the next one.' },
  'main.promise': { title: 'Your money stays put', text: 'This promise holds on every screen. If you do nothing, no money moves.' },
  'main.steps': { title: 'One click to each step', text: 'Each step opens where it happens. A tick means it is done, and you can do them in any order.' },
  'main.engine': { title: 'Your agent app', text: 'Your agents run in claude-code or codex-cli on this computer. Until you choose one, a practice agent with fixed price rules plays for you.' },
  'main.approval': { title: 'Approvals have their own window', text: 'Paying, saving your PayPal keys and signing rules happen only in the approval window. It locks after 15 quiet minutes.' },
  'tumbler.what': { title: 'Your mini window', text: 'It stays small at the edge of your screen while The Table is closed. Your agents keep working.' },
  'tumbler.needs': { title: 'It shows what needs you', text: 'A gold ring means something needs you. Each step here opens where it happens.' },
  'tumbler.engine': { title: 'Agent app: in The Table', text: 'You choose claude-code or codex-cli in The Table. This step opens it for you.' },
  'tumbler.waiting': { title: 'If you do nothing', text: 'Waiting never sends your money. When a deadline passes, nothing is sent and any hold is released.' },
  'approval.only': { title: 'Money decisions happen here', text: 'This is the only window that can approve a payment, save your PayPal keys or sign rules.' },
  'approval.steps': { title: 'The same steps as The Table', text: 'The steps for this window are one click here. The others say where they happen.' },
  'approval.engine': { title: 'Agent app: in The Table', text: 'You choose claude-code or codex-cli in The Table. This window shows which one your agents use.' },
  'approval.config': { title: 'Your wallet setup', text: 'Unlock, your PayPal keys, market prices and the agent app are kept here. Nothing on this page pays anyone.' },
};
/** The tour's own buttons and labels. */
export const TOUR = { take: 'Take the tour', takeTitle: 'A short walk through this window. It never clicks, signs or pays.', skip: 'Skip tour', next: 'Next', back: 'Back', finish: 'Finish', label: 'Tour' } as const;
/** "2 of 5" under a stop. */
export const tourCount = (n: number, total: number): string => `${n} of ${total}`;

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

// ---- agent instructions (role playbooks) ---------------------------------------------------------

/** The instructions an agent app starts from, named by the job they describe. */
export const PLAYBOOK_NAME: Record<Playbook, string> = {
  buyer_haggler: 'Bargaining to buy',
  seller_counter: 'Answering buyers’ offers',
  shopper: 'Proposing a purchase',
  shop_assistant: 'Answering questions about your records',
};
export const INSTRUCTIONS = 'Agent instructions';
/** The sheet's title and its one lead line. */
export const INSTRUCTIONS_TITLE = 'What your agent app is told';
export const INSTRUCTIONS_LEAD = 'Your agent app starts from these instructions, word for word. They cannot widen your rules: your wallet checks every step against what you signed, and nothing the other side writes ever reaches the agent.';
/** A practice-agent run reads no written instructions: it follows fixed price rules. */
export const INSTRUCTIONS_NONE = 'None: fixed price rules inside your range';

// ---- what you were shown before a deadline (the attention ladder's record) ----------------------

/** The strip's name on a deal that ended at its deadline. */
export const SHOWN_TITLE = 'What you were shown';
/** Why the one reminder before a deadline did not appear, after "not notified: ". */
export const NOT_NOTIFIED_BECAUSE: Record<NotifySuppression, string> = {
  do_not_disturb: 'Do Not Disturb was on',
  notifications_off: 'notifications were off',
  system_quiet: 'your computer was in a quiet mode',
  not_shown: 'the notification couldn’t be shown',
};
/** A card left alone that never reached the screen before its deadline. */
export const NEVER_SHOWN = 'not shown to you before the deadline';

/** A buyer haggle or shop order is RECEIPTED only on the seller's signed receipt (ledger accept_seller_receipt, evidence seller_attested); PayPal has not confirmed it until RECONCILED. */
export const sellerSaysOnly = (d: { state: DealState; side?: Side; kind?: DealKind }): boolean =>
  d.state === 'RECEIPTED' && d.side === 'buyer' && (d.kind === undefined || d.kind === 'haggle' || d.kind === 'shop_order');

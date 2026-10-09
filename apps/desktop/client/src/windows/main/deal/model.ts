// Pure logic for the deal detail (Mirror): the state strip per kind, the clause readings, the
// envelope -> clause links, the evidence labels and the decision line. No React, no IPC;
// everything here is unit-tested in model.test.ts.
//
// Honesty rule: Rust's per-clause gate verdicts are not projected to the Main window. A clause
// "reading" below is arithmetic on the signed mandate and the signed terms (both real reads), or
// "unknown" when the contract does not carry the fact. The only verdict taken from Rust is the
// clause an AttentionItem names ("asks you").
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Clause } from '@bindings/Clause';
import type { Deal } from '@bindings/Deal';
import type { DealState } from '@bindings/DealState';
import type { Money } from '@bindings/Money';
import type { ReceiptEvidence } from '@bindings/ReceiptEvidence';
import type { Reconciliation } from '@bindings/Reconciliation';
import type { Role } from '@bindings/Role';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import type { TranscriptType } from '@bindings/TranscriptType';
import { formatMinor, formatMoney } from '../../../lib/format';
import { houseWords, MILESTONES, SELLER_SAYS_PAID, sellerSaysOnly, milestoneOf, RULE_NAME, ruleNameOf, type Milestone } from '../../../lib/words';
import { canWithdraw, clauseText, dealTotal, decidedBy, isTerminal, pathFor, stateLabel } from '../logic';

// ---- the state strip ---------------------------------------------------------------------------

export type StepTone = 'live' | 'need' | 'held' | 'ok' | 'bad' | 'off';
export type MirrorStep = { key: string; label: string; status: 'done' | 'cur' | 'todo'; tone: StepTone | null };
export type MirrorStrip = { steps: MirrorStep[]; term: { label: string; tone: 'bad' | 'off' } | null; tone: StepTone };

const SETTLED: ReadonlySet<DealState> = new Set(['CAPTURED', 'RECEIPTED', 'RECONCILED']);
const OFF: ReadonlySet<DealState> = new Set(['WITHDRAWN', 'EXPIRED', 'VOIDED', 'AUTO_VOIDED', 'REFUNDED']);
/** Last happy-path step a terminal state is known to have reached (mirrors logic.ts). */
const BRANCH_AFTER: Partial<Record<DealState, DealState>> = { VOIDED: 'AUTHORIZED', AUTO_VOIDED: 'AUTHORIZED', REFUNDED: 'CAPTURED', DISPUTED: 'CAPTURED', MISMATCH: 'SETTLING' };

type StripDeal = Pick<Deal, 'kind' | 'side' | 'state' | 'shield'> & { decided_by?: Deal['decided_by'] };

/** The step label in this deal's words. A buyer haggle never sees the capture itself: the seller's
 *  wallet captures, so its CAPTURED step is the seller's attestation until a receipt arrives. */
export function stepLabel(d: Pick<Deal, 'kind' | 'side'>, s: DealState): string {
  if (s === 'CAPTURED' && d.kind === 'haggle' && d.side === 'buyer') return 'Seller says paid';
  // The strip step is the receipt; the state chip (stateWord) carries "Seller says paid".
  if (sellerSaysOnly({ state: s, ...d })) return 'Receipt saved';
  return stateLabel(s, d);
}

/**
 * Mirror's strip: only the steps this kind (and side) has, done ✓ / current filled / the rest dim.
 * A terminal state marks the known-reached prefix and is appended as its own chip. A statement
 * match moves a captured deal onto RECONCILED (the statement is the evidence for that step).
 */
export function mirrorStrip(d: StripDeal, opts: { needsYou?: boolean; reconciliation?: Reconciliation | null } = {}): MirrorStrip {
  const path = pathFor(d.kind, d.side);
  let state: DealState = d.state;
  if (opts.reconciliation === 'matched' && (state === 'CAPTURED' || state === 'RECEIPTED') && path.includes('RECONCILED')) state = 'RECONCILED';
  const at = path.indexOf(state);
  if (at >= 0) {
    const tone: StepTone = SETTLED.has(state) && !sellerSaysOnly({ state, side: d.side, kind: d.kind }) ? 'ok'
      : opts.needsYou ? 'need'
        : state === 'AUTHORIZED' || d.shield === 'HOLD' ? 'held'
          : d.shield === 'BLOCK' ? 'bad' : 'live';
    return {
      steps: path.map((s, i) => ({ key: s, label: stepLabel(d, s), status: i < at ? 'done' : i === at ? 'cur' : 'todo', tone: i === at ? tone : null })),
      term: null,
      tone,
    };
  }
  const after = BRANCH_AFTER[d.state];
  let reached = after ? path.indexOf(after) : -1;
  if (d.state === 'MISMATCH' && reached < 0) reached = path.indexOf('AGREED');
  const tone: 'bad' | 'off' = OFF.has(d.state) ? 'off' : 'bad';
  // Nobody walked away from a deal the deadline withdrew: it lapsed (the banner says the same).
  const lapsed = d.state === 'WITHDRAWN' && d.decided_by?.type === 'safe_default';
  const label = d.state === 'REFUSED' && d.shield === 'BLOCK' ? 'Blocked by a scam check' : lapsed ? 'Lapsed' : stateLabel(d.state, d);
  return {
    steps: path.map((s, i) => ({ key: s, label: stepLabel(d, s), status: i <= reached ? 'done' : 'todo', tone: null })),
    term: { label, tone },
    tone,
  };
}

/** State chip tone for the summary (text + colour, never colour alone). */
export function stateTone(strip: MirrorStrip): 'teal' | 'gold' | 'ok' | 'red' | 'line' {
  switch (strip.tone) {
    case 'live': return 'teal';
    case 'need': case 'held': return 'gold';
    case 'ok': return 'ok';
    case 'bad': return 'red';
    case 'off': return 'line';
  }
}

// ---- the five milestones (Talk · Agree · Approve · Pay · Proof) ---------------------------------

export type MilestoneStatus = 'done' | 'cur' | 'todo';
export type MilestoneItem = { key: Milestone; text: string; status: MilestoneStatus; tone: StepTone | null; /** The exact steps inside, for the tooltip. */ detail: string };
export type Milestones = { items: MilestoneItem[]; end: { label: string; tone: 'bad' | 'off'; after: Milestone | null } | null };

/**
 * The strip folded into the milestones this kind has. A step without a milestone of its own (a
 * rescue's failed renewal) joins the next one. A deal that ended early keeps the milestones it
 * reached and gets an ending marker after the last one, instead of a red word at the end.
 */
export function milestones(strip: MirrorStrip): Milestones {
  const groups = new Map<Milestone, MirrorStep[]>();
  let carry: MirrorStep[] = [];
  for (const st of strip.steps) {
    const m = milestoneOf(st.key as DealState);
    if (!m) { carry.push(st); continue; }
    groups.set(m, [...(groups.get(m) ?? []), ...carry, st]);
    carry = [];
  }
  if (carry.length) {
    const lastKey = [...groups.keys()].at(-1);
    if (lastKey) groups.set(lastKey, [...(groups.get(lastKey) ?? []), ...carry]);
  }
  const items: MilestoneItem[] = MILESTONES.filter((m) => groups.has(m.key)).map((m) => {
    const st = groups.get(m.key) ?? [];
    const cur = st.find((x) => x.status === 'cur');
    const status: MilestoneStatus = cur ? 'cur' : st.every((x) => x.status === 'done') ? 'done' : 'todo';
    const detail = st.map((x) => `${x.label}${x.status === 'done' ? ' ✓' : x.status === 'cur' ? ' (now)' : ''}`).join(' · ');
    return { key: m.key, text: m.text, status, tone: cur ? cur.tone : null, detail };
  });
  if (!strip.term) return { items, end: null };
  const reached = items.filter((i) => i.status === 'done');
  return { items, end: { label: strip.term.label, tone: strip.term.tone, after: reached.at(-1)?.key ?? null } };
}

// ---- mandate clauses -------------------------------------------------------------------------

/** The report's clause numbering (§8): ClauseRef.number uses it (clause 6 = human present). */
export const CLAUSE_NUMBER: Record<Clause['type'], number> = {
  roles: 1, counterparties: 2, per_deal: 3, band: 4, velocity: 5, human_present_over: 6, payees: 7, lever: 8,
  market_watch: 9,
};
/** A rule's plain name (lib/words.ts RULE_NAME); the number stays for Details only. */
export const CLAUSE_TITLE: Record<Clause['type'], string> = RULE_NAME;

export type Reading = 'asks' | 'within' | 'outside' | 'na' | 'unknown';
export type ClauseReading = { key: string; n: number; title: string; rule: string; reading: Reading; fact: string };

/** The mandate role a deal of this kind and side needs. */
export function roleFor(d: Pick<Deal, 'kind' | 'side'>): Role {
  switch (d.kind) {
    case 'haggle': case 'purchase': return d.side === 'buyer' ? 'buy' : 'sell';
    case 'shop_order': return 'shop';
    case 'rescue': case 'invoice': return 'rescue';
  }
}

const cmp = (a: Money, b: Money): -1 | 0 | 1 | null => (a.currency !== b.currency ? null : a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0);
const fm = (m: Money) => formatMinor(m.minor, m.currency);

type ReadCtx = {
  /** Clause number an open AttentionItem names (Rust's own "this clause decides"). */
  asks?: number | null;
  /** counterparty_list says this key is the HOUSE seller. */
  house?: boolean;
  /** Rounds from deal_display's band, when present. */
  rounds?: { used: number; max: number } | null;
};

/** One reading per clause of the governing mandate, in clause order. */
export function readClauses(clauses: readonly Clause[], d: Pick<Deal, 'kind' | 'side' | 'state' | 'shield' | 'terms' | 'counterparty'>, ctx: ReadCtx = {}): ClauseReading[] {
  const total = dealTotal(d);
  const unit = d.terms.unit_price;
  const live = !isTerminal(d);
  return clauses.map((c, i) => {
    const n = CLAUSE_NUMBER[c.type];
    const base = { key: `${c.type}-${i}`, n, title: CLAUSE_TITLE[c.type], rule: clauseText(c) };
    const r = read(c);
    const asks = ctx.asks === n && r.reading !== 'na';
    return { ...base, ...r, reading: asks ? 'asks' : r.reading, fact: asks ? `${r.fact} · this rule hands the decision to you` : r.fact };
  }).sort((a, b) => a.n - b.n);

  function read(c: Clause): { reading: Reading; fact: string } {
    switch (c.type) {
      case 'roles': {
        const role = roleFor(d);
        return c.roles.includes(role) ? { reading: 'within', fact: `you allowed agents to ${role}` } : { reading: 'outside', fact: `you did not allow agents to ${role}` };
      }
      case 'counterparties': {
        if (c.rule.type === 'pinned') return c.rule.keys.includes(d.counterparty) ? { reading: 'within', fact: 'this wallet is on your list' } : { reading: 'outside', fact: 'this wallet is not on your list' };
        if (c.rule.type === 'house') return ctx.house ? { reading: 'within', fact: 'the house seller' } : { reading: 'outside', fact: 'not the house seller' };
        return ctx.house ? { reading: 'within', fact: 'the house seller, built into the app' } : { reading: 'unknown', fact: 'can’t be checked on this screen; your wallet checks it before any payment' };
      }
      case 'per_deal': {
        if (c.kind !== d.kind) return { reading: 'na', fact: `only for ${c.kind.replace('_', ' ')}s` };
        const o = cmp(total, c.max_amount);
        const cat = c.categories.length ? ' · the item’s category isn’t known here' : '';
        if (o === null) return { reading: 'unknown', fact: `${fm(total)} is in another currency than the ${fm(c.max_amount)} limit` };
        return o <= 0 ? { reading: 'within', fact: `${fm(total)} is within the ${fm(c.max_amount)} limit${cat}` } : { reading: 'outside', fact: `${fm(total)} is over the ${fm(c.max_amount)} limit${cat}` };
      }
      case 'band': {
        if (d.kind !== 'haggle') return { reading: 'na', fact: 'only for haggling' };
        if (c.item_refs.length && !c.item_refs.includes(d.terms.item_ref)) return { reading: 'na', fact: `for ${c.item_refs.join(', ')}` };
        const rounds = ctx.rounds ? ` · round ${ctx.rounds.used} of ${ctx.rounds.max}` : '';
        const what = d.side === 'buyer' ? 'most you’ll pay' : 'least you’ll accept';
        const limit = d.side === 'buyer' ? c.ceiling : c.floor;
        if (!limit) return { reading: 'unknown', fact: `no ${what} signed${rounds}` };
        const o = cmp(unit, limit);
        if (o === null) return { reading: 'unknown', fact: 'the price and your range are in different currencies' };
        const ok = d.side === 'buyer' ? o <= 0 : o >= 0;
        const sign = d.side === 'buyer' ? (ok ? '≤' : '>') : (ok ? '≥' : '<');
        return { reading: ok ? 'within' : 'outside', fact: `${fm(unit)} ${sign} ${what} ${fm(limit)}${rounds}` };
      }
      case 'velocity':
        return { reading: 'unknown', fact: 'counted across the whole day, so it can’t be shown per deal' };
      case 'human_present_over': {
        const o = cmp(total, c.amount);
        if (o === null) return { reading: 'unknown', fact: 'the threshold is in another currency' };
        if (o <= 0) return { reading: 'within', fact: `${fm(total)} ≤ ${fm(c.amount)} · your rules may approve it` };
        return { reading: live ? 'asks' : 'na', fact: `${fm(total)} > ${fm(c.amount)} · your approval${live ? ' is needed' : ' was needed'}` };
      }
      case 'payees':
        return { reading: 'unknown', fact: 'the payee is checked by your wallet before any payment, not on this screen' };
      case 'lever':
        if (d.kind !== 'rescue') return { reading: 'na', fact: 'only for failed renewals' };
        return { reading: 'unknown', fact: 'your wallet checks the fix against this before any invoice is made' };
      // It only keeps a typical price fresh: it never allows, asks or refuses anything.
      case 'market_watch':
        return c.items.some((i) => i.item_ref === d.terms.item_ref)
          ? { reading: 'na', fact: 'keeps this item’s typical price fresh · it never approves anything' }
          : { reading: 'na', fact: 'not for this item' };
    }
  }
}

// ---- envelope links (hover lights the clause that bounded it, or the side that sent it) --------

export type EnvelopeLink = { clauses: number[]; them: boolean; paypal: boolean };

/**
 * Which clause bounded a signed envelope, derived only from the design's rules: your priced offers
 * on a haggle are bounded by the band (clause 4), and your ACCEPT over the human-present threshold
 * needs clause 6. Their envelopes light their column; SETTLE and RECEIPT carry PayPal ids.
 */
export function envelopeLink(s: Pick<TranscriptStep, 'by' | 'typ' | 'price'>, d: Pick<Deal, 'kind' | 'terms'>, clauses: readonly Clause[]): EnvelopeLink {
  const out: EnvelopeLink = { clauses: [], them: s.by === 'them', paypal: s.typ === 'SETTLE' || s.typ === 'RECEIPT' };
  if (s.by !== 'you' || d.kind !== 'haggle' || !s.price) return out;
  if (s.typ === 'OFFER' || s.typ === 'COUNTER' || s.typ === 'ACCEPT' || s.typ === 'LISTING') {
    if (clauses.some((c) => c.type === 'band')) out.clauses.push(4);
    if (s.typ === 'ACCEPT') {
      const total = s.price.minor * d.terms.qty;
      if (clauses.some((c) => c.type === 'human_present_over' && c.amount.currency === s.price?.currency && total > c.amount.minor)) out.clauses.push(6);
    }
  }
  return out;
}

// ---- the timeline -----------------------------------------------------------------------------

export type TimelineRow =
  | { kind: 'env'; key: string; at: number; step: TranscriptStep }
  | { kind: 'ledger'; key: string; at: number; text: string };

/** Signed envelopes plus the two stored ledger timestamps (created, last update), newest first. */
export function timelineRows(steps: readonly TranscriptStep[], d: Pick<Deal, 'created_at' | 'updated_at' | 'state'> & Partial<Pick<Deal, 'kind' | 'side'>>): TimelineRow[] {
  const rows: TimelineRow[] = steps.map((s) => ({ kind: 'env', key: `e${s.seq}`, at: s.at, step: s }));
  if (d.created_at !== undefined) rows.push({ kind: 'ledger', key: 'created', at: d.created_at, text: 'deal created' });
  if (d.updated_at !== undefined && d.updated_at !== d.created_at) rows.push({ kind: 'ledger', key: 'updated', at: d.updated_at, text: `now: ${stateLabel(d.state, { kind: d.kind, side: d.side }).toLowerCase()}` });
  const rank = (r: TimelineRow) => (r.kind === 'env' ? r.step.seq : r.key === 'updated' ? 1e9 : -1);
  return rows.sort((a, b) => b.at - a.at || rank(b) - rank(a));
}

/** One signed message as a plain sentence: "Dan offered", "You accepted". The price goes beside it. */
const VERB: Record<TranscriptType, string> = {
  LISTING: 'listed it', OFFER: 'offered', COUNTER: 'offered', ACCEPT: 'accepted', WITHDRAW: 'walked away',
  SETTLE: 'sent the payment request', RECEIPT: 'confirmed the payment',
};
export function stepWords(s: Pick<TranscriptStep, 'by' | 'typ'>, theirName: string): { who: string; verb: string } {
  return { who: s.by === 'you' ? 'You' : theirName, verb: VERB[s.typ] };
}

// ---- evidence ---------------------------------------------------------------------------------

export type Tone = 'teal' | 'coral' | 'gold' | 'ok' | 'red' | 'line' | 'dashed' | undefined;
export type Label = { tone: Tone; text: string; why: string };

/** Has money moved, and who says so. Seller-attested is never shown as receipted. */
export function evidenceLabel(d: Pick<Deal, 'state' | 'kind' | 'side'>, receipt: ReceiptEvidence): Label {
  if (receipt === 'PAYPAL_VERIFIED') return { tone: 'ok', text: 'PayPal receipt', why: 'Your wallet checked the payment with PayPal itself.' };
  if (receipt === 'SELLER_ATTESTED') return { tone: 'coral', text: 'Seller says paid', why: SELLER_SAYS_PAID };
  if (d.state === 'AUTHORIZED') return { tone: 'gold', text: 'On hold', why: 'PayPal is holding the money. A hold has no receipt until it is paid.' };
  if (SETTLED.has(d.state)) return { tone: 'dashed', text: 'No receipt yet', why: 'The deal says paid, but no receipt is stored with it yet.' };
  return { tone: 'line', text: 'Nothing paid yet', why: 'No money has moved.' };
}

export function reconciliationLabel(r: Reconciliation): Label {
  switch (r) {
    case 'matched': return { tone: 'ok', text: 'On statement', why: 'Your own PayPal statement shows the same payment.' };
    case 'pending_reporting': return { tone: 'gold', text: 'Not on statement yet', why: 'PayPal’s statement can lag a few hours behind a payment. That is a delay, not a doubt.' };
    case 'mismatch': return { tone: 'red', text: 'Statement differs', why: 'Your PayPal statement does not match this deal. Look at the PayPal records.' };
    case 'not_applicable': return { tone: 'line', text: 'Not needed', why: 'Nothing was paid, so nothing should appear on the statement.' };
  }
}

export type PaypalRefKey = 'order' | 'authorization' | 'capture' | 'subscription';

/** Who stands behind a PayPal id, from the side that makes the call (report §6-7). */
export function attestOf(d: Pick<Deal, 'kind' | 'side'>, key: PaypalRefKey, receipt: ReceiptEvidence): string {
  const sellerCalls = d.kind === 'haggle' && d.side === 'buyer';
  if (!sellerCalls) return key === 'order' ? 'your wallet created it' : key === 'subscription' ? 'your wallet' : 'your wallet asked PayPal';
  if (key === 'order') return 'from the seller’s signed payment request';
  if (receipt === 'PAYPAL_VERIFIED') return 'checked with PayPal';
  return 'the seller says so';
}

// ---- the decision row ---------------------------------------------------------------------------

export type DecisionLine = { tone: 'need' | 'may' | 'calm'; chip: { tone: Tone; text: string }; t1: string; t2: string | null };

export function decisionLine(d: Pick<Deal, 'state' | 'kind' | 'shield'> & Partial<Pick<Deal, 'decided_by'>>, need: Pick<AttentionItem, 'headline' | 'clause' | 'counterparty'> | undefined, mayWithdraw: boolean): DecisionLine {
  if (need) {
    const t2 = [need.clause ? ruleNameOf(need.clause.number) : null, need.counterparty ? houseWords(need.counterparty) : null].filter(Boolean).join(' · ');
    return { tone: 'need', chip: { tone: 'gold', text: 'Needs you' }, t1: need.headline, t2: t2 || null };
  }
  if (mayWithdraw) return { tone: 'may', chip: { tone: 'line', text: 'You may withdraw' }, t1: 'Nothing waits for you', t2: 'withdrawing is free · it cannot move money' };
  // Who decided, as Rust recorded it with the decision (Deal.decided_by); nothing when none did.
  const who = decidedBy(d);
  const decided = who.who === 'none' ? null : `decided by ${who.text}`;
  if (isTerminal(d)) return { tone: 'calm', chip: { tone: undefined, text: 'Closed' }, t1: 'This deal is closed. Nothing here can move money.', t2: decided };
  if (d.state === 'APPROVED' || d.state === 'SETTLING') return { tone: 'calm', chip: { tone: 'line', text: 'Waiting' }, t1: 'Nothing for you to decide: the other side acts next.', t2: decided };
  return { tone: 'calm', chip: { tone: 'line', text: 'All good' }, t1: 'Nothing for you to decide right now.', t2: decided };
}

/** Withdraw is offered where Rust accepts it; with an open item only when the item offers it
 *  (a haggle may always be withdrawn while it is still a table). Rust re-checks. */
export function mayWithdraw(d: Pick<Deal, 'state' | 'kind' | 'shield'>, need: (Pick<AttentionItem, 'actions'> & Partial<Pick<AttentionItem, 'money_check'>>) | undefined): boolean {
  // A payment step being checked with PayPal keeps the deal reserved: Rust refuses a withdraw.
  if (need?.money_check) return false;
  return canWithdraw(d) && (!need || need.actions.includes('withdraw') || d.kind === 'haggle');
}

/** The exact words of the withdraw sheet. Withdrawing never moves money. */
export function withdrawWhat(d: Pick<Deal, 'state' | 'side' | 'shield' | 'paypal'>, cp: string): string {
  if (d.shield === 'HOLD') return `${cp}’s request is declined. Nothing was ever sent to PayPal.`;
  switch (d.state) {
    case 'PAIRING': return 'Closes the table before it opens. No money moves.';
    case 'SETTLING': return `You leave the deal with ${cp}. The PayPal order being made is never approved and expires. No money moves.`;
    case 'AWAITING_APPROVAL':
      return d.side === 'seller'
        ? `You leave the deal with ${cp}: your wallet will not collect the payment even if the buyer approves, and the order expires. No money moves.`
        : `You leave the deal with ${cp}. The PayPal order is never approved and expires. No money moves.`;
    default: return `You leave the deal and ${cp} is told. No money moves, and nothing is sent to PayPal.`;
  }
}

/** "Dan offered $329.00" for the summary's Latest figure. */
export function latestText(steps: readonly TranscriptStep[], theirName: string): string | null {
  const last = steps.reduce<TranscriptStep | null>((a, s) => (!a || s.seq > a.seq ? s : a), null);
  if (!last) return null;
  const w = stepWords(last, theirName);
  return `${w.who} ${w.verb}${last.price ? ` ${formatMoney(last.price)}` : ''}`;
}

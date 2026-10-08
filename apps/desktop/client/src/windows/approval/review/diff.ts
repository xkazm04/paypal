// The Diff (prototype/pages/approval/variant-3): "is this exactly what I signed?" as two columns,
// your side and the side being asked, with a gutter naming the relation per row.
//
// Pure functions over wallet-owned data only. A relation is drawn ONLY where the contract supplies
// both sides (or Rust itself verified the equality, e.g. can_open_paypal ⇒ the SETTLE matched the
// signed amount, invoice id and approve-link host). Anything the window cannot see is '?'
// (unknown, drawn dashed), never a pass. This module decides what to SAY; gating.ts decides what
// is allowed from Rust's flags and the wallet's own checklist (ApprovalSummary.checks), never
// from these rows.
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import type { Clause } from '@bindings/Clause';
import type { Deal } from '@bindings/Deal';
import type { DealState } from '@bindings/DealState';
import type { DisplayBand } from '@bindings/DisplayBand';
import type { MandatePayload } from '@bindings/MandatePayload';
import type { Money } from '@bindings/Money';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import { formatMoney } from '../../../lib/format';
import { percentWords, shieldReleased, shieldRuleWord, shieldWord } from '../../../lib/words';
import { isTerminal, ownsPaypalResource } from '../gating';
import { dealTotal } from '../model';

// ---------------------------------------------------------------------------------------------
// relations

/** The relation between the two sides. Drawn as a ✓ / ✕ / ! / ? mark plus a plain word (rowWord),
 *  never as the math symbol itself; the symbol stays the data model the tests pin. */
export type Rel = '=' | '≤' | '≥' | '<' | '>' | '≠' | '!' | '∉' | '?' | '✓' | '…';
export type RowTone = 'ok' | 'bad' | 'info' | 'hold' | 'wait';

export const REL_WORD: Record<Rel, string> = {
  '=': 'matches', '≤': 'within', '≥': 'covers', '<': 'under', '>': 'over', '≠': 'differs',
  '!': 'paused', '∉': 'not listed', '?': 'not checked', '✓': 'confirmed', '…': 'waiting',
};

export type Mark = '✓' | '✕' | '!' | '?' | '…' | 'i';
/** The mark drawn for a row: by its reading, not its relation symbol. */
export function relMark(rel: Rel, tone: RowTone): Mark {
  if (rel === '?') return '?';
  switch (tone) {
    case 'ok': return '✓';
    case 'bad': return '✕';
    case 'hold': return '!';
    case 'wait': return '…';
    case 'info': return 'i';
  }
}

/** The word next to the mark: the row's own word when it has one, else the relation's. */
export const rowWord = (r: Pick<DiffRow, 'rel' | 'word'>): string => r.word ?? REL_WORD[r.rel];

/** Two amounts: = when exactly equal (minor units and currency), ≠ when both known and not, ? otherwise. */
export function relSame(a: Money | null | undefined, b: Money | null | undefined): Rel {
  if (!a || !b) return '?';
  return a.currency === b.currency && a.minor === b.minor ? '=' : '≠';
}

/** A value against a limit: ≤ within, > over, ? when either is missing or the currencies differ. */
export function relWithin(value: Money | null | undefined, limit: Money | null | undefined): Rel {
  if (!value || !limit || value.currency !== limit.currency) return '?';
  return value.minor <= limit.minor ? '≤' : '>';
}

/** The default reading of a relation. Rows override it where '>' is a fact, not a failure. */
export function toneOf(rel: Rel): RowTone {
  switch (rel) {
    case '=': case '≤': case '≥': case '✓': return 'ok';
    case '≠': case '>': case '<': return 'bad';
    case '!': return 'hold';
    case '…': return 'wait';
    case '?': case '∉': return 'info';
  }
}

// ---------------------------------------------------------------------------------------------
// rows

export type DiffRow = {
  id: string;
  /** Short row name in the first column ("Amount", "Price range", …). */
  name: string;
  /** Your side: what you signed / what your mandate says. */
  left: string;
  /** The asked side: what PayPal / the counterparty / the wallet reports. null = not visible here. */
  right: string | null;
  rel: Rel;
  tone: RowTone;
  /** Provenance: where both values came from (layer 2). */
  src: string;
  note?: string;
  /** A plainer word for this row's relation than REL_WORD ("asks you", "verified"). */
  word?: string;
};

export type TwinSide = { k: string; v: string | null };
export type Twin = { left: TwinSide; op: Rel; right: TwinSide; tone: RowTone };
export type DiffKind = 'accept' | 'approve' | 'mismatch' | 'capture' | 'hold' | 'lever' | 'review';
export type Diff = { kind: DiffKind; heads: [string, string]; twin: Twin; rows: DiffRow[] };

type MandateLike = { payload: MandatePayload };

export type DiffInput = {
  summary: ApprovalSummary;
  /** undefined = mandate_list not loaded; null = loaded, this version not active. */
  mandate: MandateLike | null | undefined;
  clauseNumber: number | null;
  counterparty: { name: string; known: boolean; house?: boolean; firstSeen?: number | null };
  band: DisplayBand | null;
  /** deal_transcript, when the shell answers it. Only SETTLE / RECEIPT amounts are read. */
  transcript: readonly TranscriptStep[] | undefined;
  /** gates.ownerAccept.visible: the buyer is asked to accept the latest counter. */
  ownerAccept: boolean;
  /** The owner pressed "Open PayPal in your browser" in this window. */
  handedOff?: boolean;
  now: number;
};

const POST_APPROVAL: ReadonlySet<DealState> = new Set<DealState>(['APPROVED', 'AUTHORIZED', 'CAPTURED', 'RECEIPTED', 'RECONCILED']);

/** Which comparison this window draws for the deal. */
export function diffKind(summary: ApprovalSummary, ownerAccept: boolean): DiffKind {
  const d = summary.deal;
  if (d.state === 'MISMATCH') return 'mismatch';
  if (d.shield === 'HOLD' && !isTerminal(d.state)) return 'hold';
  // A reported inbound counter on a buyer haggle is still the comparison while locked (Rust
  // answers can_owner_accept=false then); the button itself stays with gating.
  if (ownerAccept || (d.side === 'buyer' && d.kind === 'haggle' && d.state === 'NEGOTIATING' && !!summary.counter_hash)) return 'accept';
  if (d.kind === 'rescue') return 'lever';
  if (d.state === 'AUTHORIZED' && ownsPaypalResource(d)) return 'capture';
  if (d.side === 'buyer' && (d.state === 'AWAITING_APPROVAL' || POST_APPROVAL.has(d.state))) return 'approve';
  return 'review';
}

/** The newest amount the counterparty signed into a SETTLE / RECEIPT (both carry the total). */
export function lastAmount(transcript: readonly TranscriptStep[] | undefined, typ: 'SETTLE' | 'RECEIPT'): Money | null {
  if (!transcript) return null;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const s = transcript[i]!;
    if (s.typ === typ && s.price) return s.price;
  }
  return null;
}

/** Clause n of a mandate, 1-based as the mandate editor numbers them. */
function clauseOf<T extends Clause['type']>(m: MandateLike | null | undefined, type: T, pick?: (c: Extract<Clause, { type: T }>) => boolean): { n: number; c: Extract<Clause, { type: T }> } | null {
  if (!m) return null;
  const cs = m.payload.clauses;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!;
    if (c.type === type && (!pick || pick(c as Extract<Clause, { type: T }>))) return { n: i + 1, c: c as Extract<Clause, { type: T }> };
  }
  return null;
}

const KIND_WORD: Record<Deal['kind'], string> = { purchase: 'purchase', haggle: 'deal', shop_order: 'order', rescue: 'rescue', invoice: 'invoice' };

/** The scam-check row: "Looks safe" or "Check with you" is what a payment may go ahead under. */
function shieldRow(d: Deal): DiffRow {
  const v = d.shield;
  const rel: Rel = v === 'CLEAR' || v === 'ASK' ? '=' : v === 'HOLD' ? '!' : v === 'BLOCK' ? '≠' : '?';
  // Which check decided it comes from the wallet core (Deal.shield_rule), never from this window.
  const rule = d.shield_rule ? shieldRuleWord(d.shield_rule) : null;
  const released = shieldReleased(d);
  return {
    id: 'shield', name: 'Scam check', left: 'must look safe, or ask you',
    right: v === null ? 'not run yet' : released ? 'You let it go on after a pause' : v === 'ASK' ? 'Check with you · this review is the check' : v === 'HOLD' ? 'Paused for you' : shieldWord(v).text,
    rel, tone: v === 'BLOCK' ? 'bad' : toneOf(rel), word: v === 'CLEAR' ? 'safe' : v === 'ASK' ? 'asks you' : v === 'BLOCK' ? 'blocked' : undefined,
    src: v === null ? 'The scam check has not looked at this deal yet.'
      : rule ? `${rule.means} Checks can only add caution, never remove it.` : 'The scam check’s verdict on this deal. Checks can only add caution, never remove it.',
  };
}

/** The rules row: active, unexpired, and the total inside the per-purchase limit. */
function mandateRow(i: DiffInput): DiffRow {
  const d = i.summary.deal;
  const total = dealTotal(d);
  const name = 'Your rules';
  const left = 'the rules this deal was made under';
  if (i.mandate === undefined) return { id: 'mandate', name, left, right: null, rel: '?', tone: 'info', src: 'Your rules can’t be read in this window. The wallet checks them again before any PayPal call.' };
  if (i.mandate === null) return { id: 'mandate', name, left, right: 'no longer in force', rel: '≠', tone: 'bad', word: 'ended', src: 'These rules have been replaced or withdrawn.' };
  if (i.mandate.payload.expires <= i.now) return { id: 'mandate', name, left, right: 'expired', rel: '≠', tone: 'bad', word: 'expired', src: `These rules expired on ${new Date(i.mandate.payload.expires * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.` };
  const per = clauseOf(i.mandate, 'per_deal', (c) => c.kind === d.kind);
  if (per) {
    const rel = relWithin(total, per.c.max_amount);
    return { id: 'mandate', name: 'Limit per deal', left: `up to ${formatMoney(per.c.max_amount)} per ${KIND_WORD[d.kind]}`, right: formatMoney(total), rel, tone: toneOf(rel), src: `Your signed rules, rule ${per.n}${per.c.categories.length ? ` · ${per.c.categories.join(', ')}` : ''}.` };
  }
  return { id: 'mandate', name, left, right: 'in force', rel: '✓', tone: 'ok', word: 'in force', src: 'Your signed rules, the version this deal was made under.' };
}

function counterpartyRow(i: DiffInput): DiffRow {
  const rule = clauseOf(i.mandate, 'counterparties');
  const left = rule ? (rule.c.rule.type === 'paired' ? 'only wallets you connected' : rule.c.rule.type === 'house' ? 'only the house seller' : 'only wallets you verified') : 'a wallet you connected';
  const cp = i.counterparty;
  const seen = cp.firstSeen ? ` · since ${new Date(cp.firstSeen * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : '';
  return cp.known
    ? { id: 'cp', name: 'Who', left, right: `${cp.name}${seen}`, rel: '=', tone: 'ok', word: 'verified', src: 'You matched pairing words with this wallet.' }
    : { id: 'cp', name: 'Who', left, right: null, rel: '?', tone: 'info', src: 'This wallet is not among the ones you connected, so who it is can’t be shown.' };
}

function payeesRow(i: DiffInput): DiffRow | null {
  const p = clauseOf(i.mandate, 'payees');
  if (!p) return null;
  const cp = i.counterparty;
  const label = cp.house ? 'HOUSE' : cp.name.split(' · ').at(-1) ?? cp.name;
  const listed = cp.known && p.c.payees.includes(label);
  const shown = cp.house ? 'the house seller' : label;
  return {
    id: 'payees', name: 'Approved payees', left: p.c.payees.length ? p.c.payees.join(', ') : 'none yet',
    right: cp.known ? (listed ? `${shown} is on it` : `${shown} isn’t on it`) : null,
    rel: !cp.known ? '?' : listed ? '=' : '∉', tone: !cp.known ? 'info' : listed ? 'ok' : 'info', word: !cp.known ? undefined : listed ? 'listed' : 'so you’re asked',
    src: listed ? 'Your signed rules, approved payees.' : 'Payees not on your list always come to you to decide.',
  };
}

function marketRow(d: Deal): DiffRow | null {
  if (d.market) return null;
  return { id: 'market', name: 'Market price', left: 'a reference price', right: 'none for this item', rel: '?', tone: 'info', src: 'No market reference for this item, so the price check was skipped, not passed.' };
}

// ---------------------------------------------------------------------------------------------
// the comparison before the decision

export function buildDiff(i: DiffInput): Diff {
  const s = i.summary;
  const d = s.deal;
  const total = dealTotal(d);
  const T = formatMoney(total);
  const kind = diffKind(s, i.ownerAccept);
  const settle = lastAmount(i.transcript, 'SETTLE');
  const cp = i.counterparty.name;
  const who = cp.split(' · ')[0] || cp;

  switch (kind) {
    case 'accept': {
      const bandClause = clauseOf(i.mandate, 'band', (c) => !c.item_refs.length || c.item_refs.includes(d.terms.item_ref));
      const ceiling = i.band?.ceiling ?? bandClause?.c.ceiling ?? null;
      const bandRel = relWithin(d.terms.unit_price, ceiling);
      const present = clauseOf(i.mandate, 'human_present_over');
      const presentRel = present ? relWithin(total, present.c.amount) : '?';
      const rows: DiffRow[] = [
        s.counter_hash
          ? { id: 'offer', name: 'Their offer', left: 'what you’re asked to accept', right: `${T} · their latest`, rel: '✓', tone: 'ok', word: 'signed', src: `${who}’s latest offer, signed by their wallet. Approving binds exactly this offer.` }
          : { id: 'offer', name: 'Their offer', left: 'what you’re asked to accept', right: null, rel: '?', tone: 'info', src: 'Their latest offer has not reached this window yet.' },
        { id: 'band', name: 'Price range', left: ceiling ? `most you’ll pay ${formatMoney(ceiling)}` : 'the most you’ll pay', right: ceiling ? formatMoney(d.terms.unit_price) : null, rel: bandRel, tone: toneOf(bandRel), src: i.band ? 'The price range on this deal, against their price per item.' : bandClause ? `Your signed rules, rule ${bandClause.n} (price range).` : 'No price range is visible to this window.' },
        i.band
          ? { id: 'rounds', name: 'Offers', left: `${i.band.max_rounds} offers allowed`, right: `offer ${i.band.rounds_used} of ${i.band.max_rounds}`, rel: i.band.rounds_used <= i.band.max_rounds ? '≤' : '>', tone: i.band.rounds_used <= i.band.max_rounds ? 'ok' : 'bad', src: 'The price range on this deal: how many offers each side may make.' }
          : { id: 'rounds', name: 'Offers', left: 'the offer limit', right: null, rel: '?', tone: 'info', src: 'This deal shows no price range, so the offer limit can’t be checked here.' },
        present
          ? { id: 'present', name: 'Who decides', left: `you, above ${formatMoney(present.c.amount)}`, right: `${T} is ${presentRel === '>' ? 'above' : 'below'} that`, rel: presentRel, tone: 'info', word: presentRel === '>' ? 'asks you' : 'your call', src: presentRel === '>' ? 'Above your ask-me limit, so the agent stopped and asked you.' : 'Under your ask-me limit. You are still offered the decision.' }
          : { id: 'present', name: 'Who decides', left: 'your rules', right: 'you, in this window', rel: '?', tone: 'info', src: 'No ask-me limit is visible to this window.' },
        counterpartyRow(i),
        shieldRow(d),
      ];
      const op: Rel = ceiling ? (bandRel === '≤' ? '≥' : '<') : '?';
      return {
        kind, heads: ['Your rules say', `${who} offers`], rows,
        twin: { left: { k: 'Most you’ll pay', v: ceiling ? formatMoney(ceiling) : null }, op, right: { k: `${who} asks`, v: T }, tone: op === '≥' ? 'ok' : op === '<' ? 'bad' : 'info' },
      };
    }

    case 'mismatch':
    case 'approve': {
      const bad = kind === 'mismatch';
      // can_open_paypal ⇒ the core's settle check passed: the request's amount = terms, order
      // number = this attempt's, intent AUTHORIZE, approve link on PayPal's own host.
      const verified = s.can_open_paypal && d.state === 'AWAITING_APPROVAL';
      const after = POST_APPROVAL.has(d.state);
      const asked = after || (!!i.handedOff && d.state === 'AWAITING_APPROVAL') ? 'PayPal was asked' : 'PayPal will be asked';
      const amountRel: Rel = settle ? relSame(total, settle) : bad ? '≠' : verified || after ? '=' : '?';
      const right = settle ? formatMoney(settle) : bad ? null : verified || after ? T : null;
      const unknownWhy = s.locked ? 'Locked. Checked again after you unlock.' : 'Not compared yet.';
      const rows: DiffRow[] = [
        {
          id: 'amount', name: 'Amount', left: `you agreed ${T}`,
          right: settle ? `asked ${formatMoney(settle)}` : bad ? 'their request disagrees' : verified || after ? `order for ${T}` : null,
          rel: amountRel, tone: amountRel === '?' ? 'info' : toneOf(amountRel),
          src: settle ? 'Your agreed deal against the seller’s signed payment request.' : bad ? 'The wallet stopped the deal: the payment request does not match what you agreed.' : verified || after ? 'The wallet checked the payment request against what you agreed.' : unknownWhy,
          ...(bad && !settle ? { note: 'the amount they asked for isn’t shown in this window' } : {}),
        },
        { id: 'invoice', name: 'Order number', left: `new for this try (${s.attempt} of 3)`, right: verified || after ? 'checked, not reused' : null, rel: verified || after ? '=' : '?', tone: verified || after ? 'ok' : 'info', word: verified || after ? 'checked' : undefined, src: verified || after ? 'The wallet checked the order number is new for this try, so an old order can’t be replayed.' : unknownWhy },
        { id: 'host', name: 'PayPal link', left: d.mode === 'sandbox' ? 'PayPal’s own sandbox site' : 'PayPal’s own site', right: verified || after ? 'goes to PayPal' : null, rel: verified || after ? '=' : '?', tone: verified || after ? 'ok' : 'info', word: verified || after ? 'checked' : undefined, src: verified ? 'The wallet read the link itself (never an agent) and checked it goes to PayPal.' : unknownWhy },
        { id: 'payee', name: 'Paid to', left: i.counterparty.known ? cp : 'an unverified wallet', right: null, rel: '?', tone: 'info', src: 'PayPal shows who gets paid on its own page. Check it there before you approve.' },
        shieldRow(d),
        mandateRow(i),
      ];
      const op: Rel = bad ? '≠' : amountRel;
      return {
        kind, heads: ['You agreed', bad ? `${who} asks` : asked], rows,
        twin: { left: { k: 'You agreed', v: T }, op, right: { k: bad ? `${who} asks` : asked, v: right }, tone: op === '≠' ? 'bad' : toneOf(op) },
      };
    }

    case 'hold': {
      const per = clauseOf(i.mandate, 'per_deal', (c) => c.kind === d.kind);
      const perRel = per ? relWithin(total, per.c.max_amount) : '?';
      const rows: DiffRow[] = [
        d.shield_rule
          ? { id: 'rule', name: 'Scam check', left: 'a safety rule paused it', right: shieldRuleWord(d.shield_rule).text, rel: '!', tone: 'hold', src: `${shieldRuleWord(d.shield_rule).means} Paused before any PayPal call.` }
          : { id: 'rule', name: 'Scam check', left: 'a safety rule paused it', right: 'Paused before any PayPal call', rel: '!', tone: 'hold', src: 'The scam check’s verdict on this deal.', note: 'which rule paused it isn’t recorded for this deal' },
        counterpartyRow(i),
        per
          ? { id: 'perdeal', name: 'Limit per deal', left: `up to ${formatMoney(per.c.max_amount)} per ${KIND_WORD[d.kind]}`, right: T, rel: perRel, tone: toneOf(perRel), src: `Your signed rules, rule ${per.n}.` }
          : mandateRow(i),
        ...[payeesRow(i), marketRow(d)].filter((r): r is DiffRow => r !== null),
      ];
      return {
        kind, heads: ['Your rules say', 'This request'], rows,
        twin: { left: { k: 'Your limit per deal', v: per ? formatMoney(per.c.max_amount) : null }, op: per ? (perRel === '≤' ? '≥' : '<') : '?', right: { k: 'This request', v: T }, tone: 'hold' },
      };
    }

    case 'capture': {
      const auth = d.paypal.authorization;
      const rows: DiffRow[] = [
        { id: 'amount', name: 'Amount', left: `you agreed ${T}`, right: `paying takes ${T}`, rel: '=', tone: 'ok', src: 'The wallet made the order from what you agreed. Paying takes the whole hold.' },
        auth
          ? { id: 'auth', name: 'Hold', left: 'on hold at PayPal', right: 'inside its 3-day window', rel: '=', tone: 'ok', word: 'held', src: 'PayPal keeps a hold for 3 days. After that it releases by itself.' }
          : { id: 'auth', name: 'Hold', left: 'on hold at PayPal', right: null, rel: '?', tone: 'info', src: 'No PayPal hold is recorded on this deal.' },
        { id: 'payee', name: 'Paid to', left: i.counterparty.known ? cp : 'an unverified wallet', right: null, rel: '?', tone: 'info', src: 'Who the order pays isn’t shown in this window.' },
        shieldRow(d),
        mandateRow(i),
        ...[payeesRow(i)].filter((r): r is DiffRow => r !== null),
      ];
      return { kind, heads: ['On hold at PayPal', 'Paying takes'], rows, twin: { left: { k: 'On hold at PayPal', v: T }, op: '=', right: { k: 'Paying takes', v: T }, tone: 'ok' } };
    }

    case 'lever': {
      // The one fix the wallet worked out (summary.rescue) against the signed fixes rule. Rust's
      // checklist is the authority; these rows only lay the same facts side by side.
      const v = i.summary.rescue ?? null;
      const o = v?.offer ?? null;
      const lc = i.mandate?.payload.clauses.find((c): c is Extract<Clause, { type: 'lever' }> => c.type === 'lever');
      const inside = o && lc ? o.discount_bp <= lc.max_discount_bp && o.discount.currency === lc.max_discount.currency && o.discount.minor <= lc.max_discount.minor : null;
      const amountRel = o ? relSame(o.invoice, total) : '?';
      const replay = d.mode === 'replay' || v?.source === 'replay';
      const rows: DiffRow[] = [
        { id: 'lever', name: 'Fix', left: lc ? `at most ${percentWords(lc.max_discount_bp)} or ${formatMoney(lc.max_discount)} off` : 'a fix your rescue rules allow',
          right: o ? `${percentWords(o.discount_bp)} off: ${formatMoney(o.discount)} less` : null, rel: inside === null ? '?' : inside ? '≥' : '<', tone: inside === null ? 'info' : inside ? 'ok' : 'bad',
          src: o ? 'Your wallet worked out this one discount inside your rules for fixing failed renewals. The plan price stays the same for everyone.' : 'The fix isn’t shown in this window yet.' },
        { id: 'invoice', name: 'Invoice', left: o ? `this cycle, ${formatMoney(o.cycle)} before the discount` : 'one PayPal invoice', right: o ? `asks ${formatMoney(o.invoice)}` : T, rel: amountRel, tone: amountRel === '?' ? 'info' : toneOf(amountRel),
          src: 'One PayPal invoice for this cycle only. Its amount is the signed amount of this rescue; nothing is charged until the subscriber pays it.' },
        { id: 'to', name: 'Sent to', left: 'the subscriber whose renewal failed', right: v ? v.recipient : null, rel: v ? '✓' : '?', tone: v ? 'ok' : 'info', word: v ? 'by PayPal' : undefined,
          src: 'PayPal emails the invoice to the address on the failed renewal (shown masked). No PayPal link opens here.' },
        mandateRow(i),
        { id: 'source', name: 'Source', left: 'a failed renewal', right: replay ? 'replayed by you · never counted' : 'reported by PayPal', rel: replay ? '!' : '✓', tone: replay ? 'hold' : 'ok',
          src: replay ? 'PayPal can’t make a test renewal fail, so this one was replayed. Its invoice is real, and what it brings in is never counted as recovered.' : 'PayPal reported this renewal failed. Paid and receipted, it counts as recovered.' },
      ];
      return { kind, heads: ['Your rescue rules allow', 'This fix'], rows, twin: { left: { k: 'Renewal that failed', v: o ? formatMoney(o.cycle) : null }, op: o ? '>' : '?', right: { k: 'This fix invoices', v: T }, tone: o ? 'ok' : 'info' } };
    }

    case 'review': {
      const amountRel: Rel = settle ? relSame(total, settle) : '?';
      const rows: DiffRow[] = [
        { id: 'amount', name: 'Amount', left: `you agreed ${T}`, right: settle ? `asked ${formatMoney(settle)}` : null, rel: amountRel, tone: amountRel === '?' ? 'info' : toneOf(amountRel), src: settle ? 'Your agreed deal against the seller’s signed payment request.' : 'No payment request yet for this deal.' },
        mandateRow(i),
        counterpartyRow(i),
        shieldRow(d),
      ];
      return { kind, heads: ['You agreed', 'The wallet holds'], rows, twin: { left: { k: 'You agreed', v: T }, op: amountRel, right: { k: settle ? 'They ask' : 'Nothing asked yet', v: settle ? formatMoney(settle) : null }, tone: amountRel === '?' ? 'info' : toneOf(amountRel) } };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// after the hand-off: what you approved vs what PayPal and the seller report

/** The evidence table exists once the owner handed off to the browser, or the order moved on. */
export function evidenceVisible(summary: ApprovalSummary, inBrowser: boolean): boolean {
  const d = summary.deal;
  if (d.side !== 'buyer' || d.state === 'MISMATCH') return false;
  // A held authorization of your own is still a decision (capture or void), not evidence yet.
  if (d.state === 'AUTHORIZED' && ownsPaypalResource(d)) return false;
  return (inBrowser && d.state === 'AWAITING_APPROVAL') || POST_APPROVAL.has(d.state);
}

export function buildEvidence(i: { summary: ApprovalSummary; inBrowser: boolean; counterparty: string; transcript: readonly TranscriptStep[] | undefined }): { heads: [string, string]; rows: DiffRow[] } | null {
  const s = i.summary;
  const d = s.deal;
  if (!evidenceVisible(s, i.inBrowser)) return null;
  const T = formatMoney(dealTotal(d));
  const who = i.counterparty.split(' · ')[0] || i.counterparty;
  const approved = POST_APPROVAL.has(d.state);
  const rows: DiffRow[] = [
    approved
      ? { id: 'e-order', name: 'Your approval', left: 'you approve on PayPal’s page', right: 'Approved · checked with PayPal', rel: '=', tone: 'ok', word: 'done', src: 'The wallet asked PayPal itself; it never trusts the page you are sent back to.' }
      : { id: 'e-order', name: 'Your approval', left: 'you approve on PayPal’s page', right: 'not yet · watching', rel: '…', tone: 'wait', src: 'The wallet keeps asking PayPal about the order; it never trusts the page you are sent back to.' },
  ];
  const ev = s.evidence;
  const receipt = lastAmount(i.transcript, 'RECEIPT');
  if (d.kind === 'purchase') {
    const auth = d.paypal.authorization;
    rows.push(auth
      ? { id: 'e-auth', name: 'Hold', left: 'held, not paid yet', right: 'On hold at PayPal', rel: '=', tone: 'ok', word: 'held', src: 'Your wallet put the money on hold after PayPal reported your approval.' }
      : { id: 'e-auth', name: 'Hold', left: 'held, not paid yet', right: 'not yet', rel: '…', tone: 'wait', src: 'Your wallet puts the money on hold once PayPal reports your approval.' });
  } else {
    const attested = ev.receipt === 'SELLER_ATTESTED' || ev.receipt === 'PAYPAL_VERIFIED';
    const rel: Rel = receipt ? relSame(dealTotal(d), receipt) : attested ? '=' : '…';
    rows.push({
      id: 'e-receipt', name: 'Seller’s receipt', left: `a signed receipt for ${T}`,
      right: receipt ? `receipt for ${formatMoney(receipt)}` : attested ? 'signed receipt received' : 'not yet',
      rel, tone: toneOf(rel), src: receipt ? `${who}’s signed receipt.` : `${who}’s wallet signs a receipt after it collects the payment.`,
    });
  }
  const cap = d.paypal.capture;
  const capRel: Rel = ev.receipt === 'PAYPAL_VERIFIED' && cap ? '=' : ev.receipt === 'SELLER_ATTESTED' ? '?' : '…';
  rows.push({
    id: 'e-capture', name: 'Payment', left: `your own proof of ${T}`,
    right: capRel === '=' ? 'Paid · confirmed by PayPal' : capRel === '?' ? 'seller says paid · proof coming' : 'not yet',
    rel: capRel, tone: toneOf(capRel), word: capRel === '?' ? 'their word' : undefined, src: capRel === '=' ? 'Your wallet confirmed the payment with PayPal itself.' : `Your wallet checks with PayPal itself, not ${who}’s word.`,
  });
  const rc = ev.reconciliation;
  const rcRel: Rel = rc === 'matched' ? '=' : rc === 'mismatch' ? '≠' : '…';
  rows.push({
    id: 'e-report', name: 'PayPal statement', left: 'shows the same payment',
    right: rc === 'matched' ? 'on the statement' : rc === 'mismatch' ? 'the statement differs' : rc === 'pending_reporting' ? 'not yet · can take up to 3 h' : 'not yet',
    rel: rcRel, tone: toneOf(rcRel), src: 'PayPal’s statement is checked later. It never holds up the receipt.',
  });
  return { heads: ['You approved', `PayPal and ${who} report`], rows };
}

/** The folded one-liner: "6/6 same or within · 1 differs". */
export function tally(rows: readonly DiffRow[]): { ok: number; total: number; bad: number; unknown: number } {
  return {
    ok: rows.filter((r) => r.tone === 'ok').length,
    total: rows.length,
    bad: rows.filter((r) => r.tone === 'bad').length,
    unknown: rows.filter((r) => r.rel === '?').length,
  };
}

/** A red row narrows gating (no PayPal button); unknown rows never do (the wallet decides). */
export function anyRowFailed(rows: readonly DiffRow[]): boolean {
  return rows.some((r) => r.tone === 'bad');
}

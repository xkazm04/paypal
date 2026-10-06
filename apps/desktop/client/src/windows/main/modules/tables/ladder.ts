// Pure logic for the Tables page (Price Ladder, prototype/pages/tables/variant-3): the ladder's
// price scale and geometry, the band draft (floor / ceiling, the only fields band_set takes) and
// the consequences of moving it. No React, no IPC; unit-tested in ladder.test.ts.
// Money stays in integer minor units; formatting is passed in.
import type { Currency } from '@bindings/Currency';
import type { DisplayBand } from '@bindings/DisplayBand';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import { exponent, formatMinor } from '../../../../lib/format';
import { niceTicks } from '../../logic';

/** A band as band_set takes it: floor and ceiling in minor units (null = none). */
export type BandDraft = { floor: number | null; ceiling: number | null };

export type MarketMinor = { p25: number; median: number; p75: number };

/** One whole currency unit in minor units (the fence moves in whole units: $1, ¥1). */
export const unitOf = (c: Currency): number => 10 ** exponent(c);

/** "$340" when whole, "$340.50" otherwise (ladder labels and chips). */
export function short(minor: number, c: Currency): string {
  const s = formatMinor(minor, c);
  const exp = exponent(c);
  return exp && minor % 10 ** exp === 0 ? s.replace(/[.,]0+(?=\D*$)/, '') : s;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export type Scale = { lo: number; hi: number; ticks: number[] };

/**
 * The ladder's price axis from what is signed and known: transcript prices, the signed band and
 * the market p25-p75. The draft is left out on purpose, so the axis does not move under a drag.
 * Returns null when there is nothing to scale against.
 */
export function ladderScale(values: ReadonlyArray<number | null | undefined>): Scale | null {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0);
  if (!v.length) return null;
  const min = Math.min(...v);
  const max = Math.max(...v);
  const pad = Math.max((max - min) * 0.08, max * 0.02);
  const t = niceTicks(Math.max(0, min - pad), max + pad);
  return { lo: t.lo, hi: t.hi, ticks: t.ticks };
}

/** Distance from the top of the ladder, in percent (higher price = nearer the top). */
export function topPct(v: number, s: Pick<Scale, 'lo' | 'hi'>): number {
  if (s.hi <= s.lo) return 50;
  return clamp(((s.hi - v) / (s.hi - s.lo)) * 100, 0, 100);
}

/** Price at a vertical fraction of the ladder (0 = top), snapped to whole units. */
export function priceAt(f: number, s: Pick<Scale, 'lo' | 'hi'>, unit: number): number {
  const raw = s.hi - clamp(f, 0, 1) * (s.hi - s.lo);
  return Math.round(raw / unit) * unit;
}

/** Keep a dragged or typed ceiling on the ladder, a whole unit, and never below the floor. */
export function clampCeiling(v: number, s: Pick<Scale, 'lo' | 'hi'> | null, unit: number, floor: number | null): number {
  let x = Math.round(v / unit) * unit;
  if (s) x = clamp(x, Math.ceil(s.lo / unit) * unit + unit, Math.floor(s.hi / unit) * unit);
  if (floor !== null && x < floor) x = floor;
  return Math.max(unit, x);
}

/** The seller's fence: a floor on the ladder, a whole unit, and never above the ceiling. */
export function clampFloor(v: number, s: Pick<Scale, 'lo' | 'hi'> | null, unit: number, ceiling: number | null): number {
  let x = Math.round(v / unit) * unit;
  if (s) x = clamp(x, Math.ceil(s.lo / unit) * unit, Math.floor(s.hi / unit) * unit - unit);
  if (ceiling !== null && x > ceiling) x = ceiling;
  return Math.max(unit, x);
}

/** Which bound is the fence: a buyer guards a ceiling, a seller a floor. */
export const fenceKey = (side: 'buyer' | 'seller'): keyof BandDraft => (side === 'buyer' ? 'ceiling' : 'floor');

/** Move the fence bound of a draft to `v`, clamped; the other bound is kept. */
export function moveFence(d: BandDraft, side: 'buyer' | 'seller', v: number, s: Pick<Scale, 'lo' | 'hi'> | null, unit: number): BandDraft {
  return side === 'buyer' ? { ...d, ceiling: clampCeiling(v, s, unit, d.floor) } : { ...d, floor: clampFloor(v, s, unit, d.ceiling) };
}

export const bandOf =(b: DisplayBand | null | undefined): BandDraft | null =>
  b ? { floor: b.floor?.minor ?? null, ceiling: b.ceiling?.minor ?? null } : null;

export const sameBand = (a: BandDraft | null, b: BandDraft | null): boolean =>
  !!a && !!b && a.floor === b.floor && a.ceiling === b.ceiling;

/** A draft band_set would accept as a shape: at least one bound, floor not above ceiling. */
export function draftValid(d: BandDraft): boolean {
  if (d.floor === null && d.ceiling === null) return false;
  if (d.floor !== null && d.floor <= 0) return false;
  if (d.ceiling !== null && d.ceiling <= 0) return false;
  return d.floor === null || d.ceiling === null || d.floor <= d.ceiling;
}

/** Whether a price may be signed inside a band (Rust re-checks clause 4; this only draws it). */
export const fits = (price: number, b: BandDraft | null): boolean =>
  !b || ((b.ceiling === null || price <= b.ceiling) && (b.floor === null || price >= b.floor));

export type Priced = { seq: number; price: number; typ: TranscriptStep['typ'] };

/** The latest priced envelope one side signed (LISTING / OFFER / COUNTER / ACCEPT). */
export function lastPriced(steps: readonly TranscriptStep[], by: TranscriptStep['by'], currency: Currency): Priced | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s && s.by === by && s.price && s.price.currency === currency) return { seq: s.seq, price: s.price.minor, typ: s.typ };
  }
  return null;
}

/** Parse a typed amount exactly into minor units ("340", "$340.50"); null when it is not one. */
export function parseAmount(text: string, currency: Currency): number | null {
  const t = text.trim().replace(/[,\s]/g, '').replace(/^[$€£]/, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const exp = exponent(currency);
  const [whole = '0', frac = ''] = t.split('.');
  if (frac.length > exp) return null;
  const minor = Number(whole + frac.padEnd(exp, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Minor units as the editable text: "340" when whole, "340.50" otherwise. */
export function toInput(minor: number, currency: Currency): string {
  const exp = exponent(currency);
  if (!exp) return String(minor);
  const whole = Math.trunc(minor / 10 ** exp);
  const frac = minor % 10 ** exp;
  return frac ? `${whole}.${String(frac).padStart(exp, '0')}` : String(whole);
}

/** The price-range edits of a move, as the "what changes" sheet lists them (item named in its title). */
export const LIMIT_WORD: Record<keyof BandDraft, string> = { ceiling: 'Most you’ll pay', floor: 'Least you’ll accept' };
export function diffLines(_item: string, signed: BandDraft | null, draft: BandDraft, currency: Currency): string[] {
  const f = (m: number | null) => (m === null ? 'none' : short(m, currency));
  if (!signed) {
    return (['ceiling', 'floor'] as const).filter((k) => draft[k] !== null).map((k) => `${LIMIT_WORD[k]}: ${f(draft[k])} (new)`);
  }
  const out: string[] = [];
  if (signed.ceiling !== draft.ceiling) out.push(`${LIMIT_WORD.ceiling}: ${f(signed.ceiling)} → ${f(draft.ceiling)}`);
  if (signed.floor !== draft.floor) out.push(`${LIMIT_WORD.floor}: ${f(signed.floor)} → ${f(draft.floor)}`);
  return out;
}

export type Consequence = { tone: 'ok' | 'x' | 'i'; text: string };

export type ConsequenceInput = {
  item: string;
  /** Short counterparty name ("Dan"). */
  them: string;
  side: 'buyer' | 'seller';
  signed: BandDraft | null;
  draft: BandDraft;
  /** Their latest priced envelope and yours. */
  theirs: Priced | null;
  yours: Priced | null;
  roundsUsed: number | null;
  maxRounds: number | null;
  /** An open countersign / accept request on this table. */
  pending: boolean;
  currency: Currency;
};

/** Everything a band move does, before it leaves for the approval window. ✗ lines are conflicts. */
export function consequences(i: ConsequenceInput): Consequence[] {
  const f = (m: number) => short(m, i.currency);
  const L: Consequence[] = [];
  const bound = i.side === 'buyer' ? i.draft.ceiling : i.draft.floor;
  if (!i.signed) L.push({ tone: 'i', text: `Sets a price range for ${i.item}: your agent may start ${i.side === 'buyer' ? 'offering up to' : 'asking from'}${bound !== null ? ` ${f(bound)}` : ' any price'}.` });
  if (i.theirs) {
    const p = f(i.theirs.price);
    const before = !!i.signed && fits(i.theirs.price, i.signed);
    const after = fits(i.theirs.price, i.draft);
    if (!i.signed) L.push(after ? { tone: 'ok', text: `${i.them}'s ${p} fits your range.` } : { tone: 'x', text: `${i.them}'s ${p} is outside your range, so your agent can't accept it.` });
    else if (before && !after) L.push({ tone: 'x', text: `${i.them}'s ${p} could be accepted before; after this change it can't.` });
    else if (!before && after) L.push({ tone: 'ok', text: `${i.them}'s ${p} can now be accepted.` });
    else if (after) {
      const room = i.side === 'buyer' && i.draft.ceiling !== null ? ` · ${f(i.draft.ceiling - i.theirs.price)} of room` : i.side === 'seller' && i.draft.floor !== null ? ` · ${f(i.theirs.price - i.draft.floor)} of room` : '';
      L.push({ tone: 'ok', text: `${i.them}'s ${p} still fits${room}.` });
    } else L.push({ tone: 'x', text: `${i.them}'s ${p} stays outside your range, so it can't be accepted.` });
    if (i.pending && !after) L.push({ tone: 'x', text: 'The request waiting for you lapses: your agent must offer inside the new range or walk away.' });
  }
  if (i.yours && !fits(i.yours.price, i.draft)) {
    L.push({ tone: 'x', text: `Your earlier offer of ${f(i.yours.price)} stays on record (signed offers are never changed); the next one must be inside the new range.` });
  }
  if (i.roundsUsed !== null && i.maxRounds !== null) {
    const left = i.maxRounds - i.roundsUsed;
    L.push(left > 0 ? { tone: 'i', text: `Offers left are unchanged: ${left} of ${i.maxRounds}.` } : { tone: 'x', text: `No offers left (all ${i.maxRounds} used): your agent may only accept inside the range, or walk away.` });
  }
  L.push({ tone: 'i', text: `Your agent uses the new range from its next move. ${i.them} never sees your ${i.side === 'buyer' ? 'maximum' : 'minimum'}.` });
  L.push({ tone: 'i', text: 'Signing new limits makes no PayPal call. It never pays.' });
  return L;
}

/** The second line of a table tab: where the latest price sits against the band. */
export function tabLine(o: { band: BandDraft | null; theirs: Priced | null; side: 'buyer' | 'seller'; roundsLeft: number | null; state: string; currency: Currency }): string {
  const f = (m: number) => short(m, o.currency);
  if (o.state === 'PAIRING') return o.band ? 'connecting · price range set' : 'connecting · no price range yet';
  if (!o.band || (o.band.ceiling === null && o.band.floor === null)) return `${o.theirs ? `${o.theirs.typ === 'LISTING' ? 'listed at' : 'asking'} ${f(o.theirs.price)} · ` : ''}no price range yet`;
  const bound = o.side === 'buyer' ? o.band.ceiling : o.band.floor;
  if (!o.theirs) return bound !== null ? `${o.side === 'buyer' ? 'up to' : 'from'} ${f(bound)} · no offer yet` : 'no offer yet';
  const parts = [`${o.side === 'buyer' ? 'asking' : 'offering'} ${f(o.theirs.price)}`];
  if (bound !== null) {
    const r = o.side === 'buyer' ? bound - o.theirs.price : o.theirs.price - bound;
    parts.push(o.side === 'buyer' ? (r >= 0 ? `${f(r)} under your max` : `${f(-r)} over your max`) : (r >= 0 ? `${f(r)} over your min` : `${f(-r)} under your min`));
  }
  if (o.roundsLeft !== null) parts.push(`${o.roundsLeft} ${o.roundsLeft === 1 ? 'offer' : 'offers'} left`);
  return parts.join(' · ');
}

/** Distance from the left of a horizontal "where it stands" bar, in percent (higher price = nearer the right). */
export const posPct = (v: number, s: Pick<Scale, 'lo' | 'hi'>): number => 100 - topPct(v, s);

export type Standing = { kind: 'inside' | 'over' | 'no-limit' | 'no-offer'; /** Distance to the limit, always positive, in minor units. */ gap: number | null };

/** Where their latest price sits against your limit: inside it, over it, or there is nothing to compare. */
export function standing(o: { band: BandDraft | null; theirs: Priced | null; side: 'buyer' | 'seller' }): Standing {
  const bound = o.band ? o.band[fenceKey(o.side)] : null;
  if (bound === null) return { kind: 'no-limit', gap: null };
  if (!o.theirs) return { kind: 'no-offer', gap: null };
  const r = o.side === 'buyer' ? bound - o.theirs.price : o.theirs.price - bound;
  return r >= 0 ? { kind: 'inside', gap: r } : { kind: 'over', gap: -r };
}

/** One plain sentence for the card's "where it stands" bar: their latest price against your limit. */
export function standLine(o: { band: BandDraft | null; theirs: Priced | null; side: 'buyer' | 'seller'; who: string; currency: Currency }): string {
  const f = (m: number) => short(m, o.currency);
  const s = standing(o);
  const verb = o.theirs ? (o.theirs.typ === 'LISTING' ? 'lists it at' : o.side === 'buyer' ? 'asks' : 'offers') : '';
  switch (s.kind) {
    case 'no-limit': return `${o.theirs ? `${o.who} ${verb} ${f(o.theirs.price)}. ` : ''}You haven’t set a limit yet, so your agent can’t make offers.`;
    case 'no-offer': return `No offer from ${o.who} yet.`;
    case 'inside': return `${o.who} ${verb} ${f(o.theirs?.price ?? 0)}: ${s.gap ? `${f(s.gap ?? 0)} inside your limit` : 'right at your limit'}.`;
    case 'over': return `${o.who} ${verb} ${f(o.theirs?.price ?? 0)}: ${f(s.gap ?? 0)} past your limit, so your agent can’t accept it.`;
  }
}

/** The three steps' states: draft → what changes → sign in the approval window. */
export type StepState = 'on' | 'done' | 'off';
export function stepStates(o: { drafting: boolean; read: boolean; handedOff: boolean }): [StepState, StepState, StepState] {
  const s1: StepState = o.drafting || o.handedOff ? 'done' : 'on';
  const s2: StepState = !o.drafting && !o.handedOff ? 'off' : o.read || o.handedOff ? 'done' : 'on';
  const s3: StepState = o.handedOff ? 'done' : o.drafting && o.read ? 'on' : 'off';
  return [s1, s2, s3];
}

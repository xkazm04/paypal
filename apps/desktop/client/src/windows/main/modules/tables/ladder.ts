// Pure logic for the Tables page (Price Ladder, prototype/pages/tables/variant-3): the ladder's
// price scale and geometry, the band draft (floor / ceiling, the only fields band_set takes) and
// the consequences of moving it. No React, no IPC; unit-tested in ladder.test.ts.
// Money stays in integer minor units; formatting is passed in.
import type { Currency } from '@bindings/Currency';
import type { DisplayBand } from '@bindings/DisplayBand';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import { exponent, minorToText, parseMoneyText, shortMoney } from '../../../../lib/format';
import { TABLES } from '../../../../lib/words';
import { niceTicks } from '../../logic';

/** A band as band_set takes it: floor and ceiling in minor units (null = none). */
export type BandDraft = { floor: number | null; ceiling: number | null };

export type MarketMinor = { p25: number; median: number; p75: number };

/** One whole currency unit in minor units (the fence moves in whole units: $1, ¥1). */
export const unitOf = (c: Currency): number => 10 ** exponent(c);

/** "$340" when whole, "$340.50" otherwise (ladder labels and chips): lib/format's one short formatter. */
export const short = shortMoney;

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

/** Parse a typed amount exactly into minor units ("340", "$340.50"); null when it is not one: lib/format's one parser. */
export const parseAmount = parseMoneyText;

/** Minor units as the editable text: "340" when whole, "340.50" otherwise: lib/format's one renderer. */
export const toInput = minorToText;

/** The price-range edits of a move, as the "what changes" sheet lists them (item named in its title). */
export const LIMIT_WORD: Record<keyof BandDraft, string> = TABLES.model.limit;
export function diffLines(_item: string, signed: BandDraft | null, draft: BandDraft, currency: Currency): string[] {
  const W = TABLES.model;
  const f = (m: number | null) => (m === null ? W.none : short(m, currency));
  if (!signed) {
    return (['ceiling', 'floor'] as const).filter((k) => draft[k] !== null).map((k) => W.limitNew(LIMIT_WORD[k], f(draft[k])));
  }
  const out: string[] = [];
  if (signed.ceiling !== draft.ceiling) out.push(W.limitChange(LIMIT_WORD.ceiling, f(signed.ceiling), f(draft.ceiling)));
  if (signed.floor !== draft.floor) out.push(W.limitChange(LIMIT_WORD.floor, f(signed.floor), f(draft.floor)));
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
  const W = TABLES.model;
  const f = (m: number) => short(m, i.currency);
  const L: Consequence[] = [];
  const bound = i.side === 'buyer' ? i.draft.ceiling : i.draft.floor;
  if (!i.signed) L.push({ tone: 'i', text: W.setsRange(i.item, W.rangeStart[i.side], bound !== null ? ` ${f(bound)}` : W.anyPrice) });
  if (i.theirs) {
    const p = f(i.theirs.price);
    const before = !!i.signed && fits(i.theirs.price, i.signed);
    const after = fits(i.theirs.price, i.draft);
    if (!i.signed) L.push(after ? { tone: 'ok', text: W.fits(i.them, p) } : { tone: 'x', text: W.outside(i.them, p) });
    else if (before && !after) L.push({ tone: 'x', text: W.couldBefore(i.them, p) });
    else if (!before && after) L.push({ tone: 'ok', text: W.canNow(i.them, p) });
    else if (after) {
      const room = i.side === 'buyer' && i.draft.ceiling !== null ? W.room(f(i.draft.ceiling - i.theirs.price)) : i.side === 'seller' && i.draft.floor !== null ? W.room(f(i.theirs.price - i.draft.floor)) : '';
      L.push({ tone: 'ok', text: W.stillFits(i.them, p, room) });
    } else L.push({ tone: 'x', text: W.staysOutside(i.them, p) });
    if (i.pending && !after) L.push({ tone: 'x', text: W.lapses });
  }
  if (i.yours && !fits(i.yours.price, i.draft)) {
    L.push({ tone: 'x', text: W.earlierOffer(f(i.yours.price)) });
  }
  if (i.roundsUsed !== null && i.maxRounds !== null) {
    const left = i.maxRounds - i.roundsUsed;
    L.push(left > 0 ? { tone: 'i', text: W.offersLeft(left, i.maxRounds) } : { tone: 'x', text: W.noOffersLeft(i.maxRounds) });
  }
  L.push({ tone: 'i', text: W.newRange(i.them, W.hidden[i.side]) });
  L.push({ tone: 'i', text: W.noPaypal });
  return L;
}

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
  const W = TABLES.model.stand;
  const f = (m: number) => short(m, o.currency);
  const s = standing(o);
  const verb = o.theirs ? (o.theirs.typ === 'LISTING' ? W.verb.listing : W.verb[o.side]) : '';
  switch (s.kind) {
    case 'no-limit': return W.noLimit(o.theirs ? W.theirPrice(o.who, verb, f(o.theirs.price)) : '');
    case 'no-offer': return W.noOffer(o.who);
    case 'inside': return W.inside(o.who, verb, f(o.theirs?.price ?? 0), s.gap ? W.insideBy(f(s.gap ?? 0)) : W.atLimit);
    case 'over': return W.past(o.who, verb, f(o.theirs?.price ?? 0), f(s.gap ?? 0));
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

// Pure logic for "Watch the haggle": a table's signed transcript and its Rewind steps become the
// beats the corridor plays, the clock that paces them, and the frame at any moment (so a seek, a
// pause and reduced motion all draw the same picture). No React, no IPC; unit-tested in
// corridor.test.ts. Money stays in integer minor units; every price is one a transcript step
// carries, so the corridor can only draw what was signed.
import type { Currency } from '@bindings/Currency';
import type { HistoryStep } from '@bindings/HistoryStep';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import { TABLES_WATCH as W } from '../../../../lib/words';
import { ladderScale, short } from './ladder';

export type Who = 'you' | 'them';

export type Beat =
  /** A signed price: their listing or counter, our agent's offer. */
  | { kind: 'price'; by: Who; price: number; first: boolean }
  /** The wallet refused our agent's step. `price` is the yes it tried (clause 6), null at a wall. */
  | { kind: 'refused'; price: number | null; clause: number | null }
  /** The owner said yes in the approval window. */
  | { kind: 'owner'; price: number }
  /** An accept by our agent (inside the rules) or by them. */
  | { kind: 'accept'; by: Who; price: number }
  /** Both sides accepted the same price. */
  | { kind: 'agreed'; price: number; byOwner: boolean }
  | { kind: 'withdrawn'; by: Who };

/** What the corridor plays: our side, the signed walls, the market lane and the beats. */
export type Haggle = {
  currency: Currency;
  /** Our side of the table: a buyer's agent climbs, a seller's comes down. */
  side: 'buyer' | 'seller';
  /** The signed band: the most a buyer pays, the least a seller takes (minor units). */
  ceiling: number | null;
  floor: number | null;
  /** "Ask me above": the owner's own line for saying yes. */
  askAbove: number | null;
  maxOffers: number | null;
  market: { p25: number; median: number; p75: number } | null;
  beats: Beat[];
};

type Inputs = {
  currency: Currency;
  side: 'buyer' | 'seller';
  transcript: readonly TranscriptStep[];
  /** This deal's Rewind steps (deal_history); refusals and the owner's yes come from here. */
  history?: readonly HistoryStep[] | null;
  ceiling?: number | null;
  floor?: number | null;
  askAbove?: number | null;
  maxOffers?: number | null;
  market?: { p25: number; median: number; p75: number } | null;
  /** A live table the wallet stopped for the owner (its attention gate): the rule and the price the
   *  agent tried. Drawn as the refusal it stands for when the history has not recorded one yet. */
  gate?: { clause: number | null; price: number } | null;
};

/** The beats of a table| null;
};

/** The beats of a table, in the order they happened. Transcript prices and the history's typed
 *  steps share the wallet's clock; at the same second a signed message comes before a refusal. */
export function haggleOf(i: Inputs): Haggle {
  const steps = [...i.transcript].sort((a, b) => a.at - b.at || a.seq - b.seq);
  const history = [...(i.history ?? [])].sort((a, b) => a.at - b.at || a.seq - b.seq);
  const ownerSaidYes = history.some((h) => h.kind === 'owner_accepted');
  type Timed = { at: number; order: number; beat: Beat | null; step?: TranscriptStep };
  const timed: Timed[] = [];
  let sawOurs = false;
  for (const s of steps) {
    const price = s.price?.minor ?? null;
    if ((s.typ === 'LISTING' || s.typ === 'OFFER' || s.typ === 'COUNTER') && price !== null) {
      const first = s.by === 'you' && !sawOurs;
      if (s.by === 'you') sawOurs = true;
      timed.push({ at: s.at, order: 0, beat: { kind: 'price', by: s.by, price, first } });
    } else if (s.typ === 'ACCEPT' && price !== null) {
      timed.push({ at: s.at, order: 0, beat: s.by === 'you' && ownerSaidYes ? { kind: 'owner', price } : { kind: 'accept', by: s.by, price } });
    } else if (s.typ === 'WITHDRAW') {
      timed.push({ at: s.at, order: 0, beat: { kind: 'withdrawn', by: s.by } });
    }
  }
  for (const h of history) {
    if (h.kind !== 'intent_refused') continue;
    const clause = h.authority.type === 'signed_rule' ? h.authority.clause : null;
    timed.push({ at: h.at, order: 1, beat: { kind: 'refused', price: null, clause } });
  }
  timed.sort((a, b) => a.at - b.at || a.order - b.order);
  const beats: Beat[] = [];
  let theirs: number | null = null;
  let accepts = { you: null as number | null, them: null as number | null };
  for (const t of timed) {
    const b = t.beat;
    if (!b) continue;
    if (b.kind === 'price' && b.by === 'them') theirs = b.price;
    if (b.kind === 'refused') {
      // An ask-me refusal stops our agent's yes to their latest price; a band refusal is at the wall.
      beats.push(b.clause === 6 && theirs !== null ? { ...b, price: theirs } : b);
      continue;
    }
    if (b.kind === 'owner') accepts = { ...accepts, you: b.price };
    if (b.kind === 'accept') accepts = { ...accepts, [b.by]: b.price };
    const agreed = accepts.you !== null && accepts.you === accepts.them;
    // Their accept that closes the deal is the snap itself; the owner's yes keeps its own beat.
    if (!(agreed && b.kind === 'accept' && b.by === 'them')) beats.push(b);
    if (agreed && accepts.you !== null) {
      beats.push({ kind: 'agreed', price: accepts.you, byOwner: ownerSaidYes });
      accepts = { you: null, them: null };
    }
  }
  const last = beats[beats.length - 1];
  if (i.gate && last?.kind !== 'refused' && !beats.some((b) => b.kind === 'agreed' || b.kind === 'withdrawn')) {
    beats.push({ kind: 'refused', price: i.gate.clause === 6 ? i.gate.price : null, clause: i.gate.clause });
  }
  return {
    currency: i.currency, side: i.side,
    ceiling: i.ceiling ?? null, floor: i.floor ?? null, askAbove: i.askAbove ?? null, maxOffers: i.maxOffers ?? null,
    market: i.market ?? null, beats,
  };
}

/** A haggle is worth watching once both sides have named a price. */
export const watchable = (h: Haggle): boolean =>
  h.beats.some((b) => b.kind === 'price' && b.by === 'you') && h.beats.some((b) => b.kind === 'price' && b.by === 'them');

/** The first price and the price it ended at (agreed, else the latest), for the card. */
export function haggleSpan(h: Haggle): { from: number; to: number } | null {
  const prices = h.beats.filter((b): b is Extract<Beat, { kind: 'price' }> => b.kind === 'price');
  const first = prices[0];
  if (!first) return null;
  const agreed = h.beats.find((b): b is Extract<Beat, { kind: 'agreed' }> => b.kind === 'agreed');
  return { from: first.price, to: agreed?.price ?? prices[prices.length - 1]?.price ?? first.price };
}

// ---- the clock: when each beat lands (ms), and how long the corridor holds it

/** The first beat lands after the walls have drawn. */
export const LEAD_MS = 600;
const HOLD: Record<Beat['kind'], number> = { price: 820, refused: 2600, owner: 1500, accept: 950, agreed: 2400, withdrawn: 1600 };
/** A price slides into place over this long; a refusal lunges and bounces within its hold. */
export const SLIDE_MS = 560;

export type Cue = { at: number; hold: number; beat: Beat; i: number };
export type Playbook = { cues: Cue[]; total: number };

export function playbook(h: Haggle): Playbook {
  let t = LEAD_MS;
  const cues = h.beats.map((beat, i) => {
    const c = { at: t, hold: HOLD[beat.kind], beat, i };
    t += c.hold;
    return c;
  });
  return { cues, total: t };
}

// ---- the frame at time t

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** Ease in and out (the hero film's curve, close enough for a slide). */
export const ease = (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

export type Frame = {
  /** Where each puck is drawn now (minor units), or null before its first price. */
  you: number | null;
  them: number | null;
  /** Every price each side has landed so far, oldest first (the trail). */
  trail: { you: number[]; them: number[] };
  /** The cue that last landed (its caption is read out), or -1 before the first. */
  current: number;
  /** 0..1 through a refusal: the lunge, the wall's flash and the bounce. */
  refusal: { price: number | null; clause: number | null; p: number } | null;
  /** 0..1 as the deal snaps shut at `price`. */
  snap: { price: number; p: number; byOwner: boolean } | null;
  /** The owner's yes: 0..1 while the hold ring fills. */
  owner: number;
  /** Prices apart, as drawn (null until both sides have one). */
  gap: number | null;
  /** Our signed offers so far. */
  offers: number;
  done: boolean;
};

export function frameAt(pb: Playbook, t: number): Frame {
  const trail = { you: [] as number[], them: [] as number[] };
  const from = { you: null as number | null, them: null as number | null };
  const to = { you: null as number | null, them: null as number | null };
  const landed = { you: -Infinity, them: -Infinity };
  let current = -1;
  let refusal: Frame['refusal'] = null;
  let snap: Frame['snap'] = null;
  let owner = 0;
  let offers = 0;
  for (const c of pb.cues) {
    if (t < c.at) break;
    current = c.i;
    const b = c.beat;
    const local = t - c.at;
    if (b.kind === 'price') {
      from[b.by] = to[b.by];
      to[b.by] = b.price;
      landed[b.by] = c.at;
      trail[b.by].push(b.price);
      if (b.by === 'you') offers += 1;
    }
    refusal = b.kind === 'refused' ? { price: b.price, clause: b.clause, p: clamp01(local / c.hold) } : null;
    if (b.kind === 'owner') owner = clamp01(local / (c.hold * 0.8));
    if (b.kind === 'agreed') snap = { price: b.price, p: clamp01(local / 520), byOwner: b.byOwner };
  }
  const at = (w: Who): number | null => {
    const a = from[w];
    const b = to[w];
    if (b === null) return null;
    if (a === null) return b;
    return a + (b - a) * ease(clamp01((t - landed[w]) / SLIDE_MS));
  };
  let you = at('you');
  let them = at('them');
  if (snap && you !== null && them !== null) {
    const p = ease(snap.p);
    you += (snap.price - you) * p;
    them += (snap.price - them) * p;
  }
  return {
    you, them, trail, current, refusal, snap, owner, offers,
    gap: you !== null && them !== null ? Math.abs(them - you) : null,
    done: t >= pb.total,
  };
}

/** How far a refused yes lunges toward the price it tried, then bounces back (0 = at rest, 1 = at the gate). */
export function lunge(p: number): number {
  if (p <= 0 || p >= 0.5) return 0;
  if (p < 0.16) return ease(p / 0.16);
  // a damped bounce off the gate
  const q = (p - 0.16) / 0.34;
  return Math.max(0, (1 - q) * Math.cos(q * Math.PI * 1.5));
}

// ---- the track

export type Track = { lo: number; hi: number; ticks: number[] };

/** The price axis: every signed price, the walls and the market lane. The ask-me line is left out
 *  when it sits far below the haggle, so it cannot squeeze the track; it is drawn at the edge then. */
export function trackOf(h: Haggle): Track | null {
  const prices = h.beats.flatMap((b) => ('price' in b && b.price !== null ? [b.price] : []));
  const s = ladderScale([...prices, h.ceiling, h.floor, h.market?.p25, h.market?.p75]);
  return s ? { lo: s.lo, hi: s.hi, ticks: s.ticks } : null;
}

/** Fraction across the track (0 = left, lowest price). */
export const xOf = (v: number, t: Pick<Track, 'lo' | 'hi'>): number => (t.hi <= t.lo ? 0.5 : clamp01((v - t.lo) / (t.hi - t.lo)));

// ---- words

/** The line read out when a beat lands. */
export function captionOf(b: Beat, h: Haggle, who: string): string {
  const m = (v: number) => short(v, h.currency);
  switch (b.kind) {
    case 'price': {
      if (b.by === 'you') return b.first ? W.opens(m(b.price)) : h.side === 'buyer' ? W.ourUp(m(b.price)) : W.ourDown(m(b.price));
      const firstTheirs = h.beats.find((x) => x.kind === 'price' && x.by === 'them') === b;
      if (firstTheirs) return h.side === 'buyer' ? W.lists(who, m(b.price)) : W.theirOffer(who, m(b.price));
      return h.side === 'buyer' ? W.theirDown(who, m(b.price)) : W.theirUp(who, m(b.price));
    }
    case 'refused':
      if (b.clause === 6 && b.price !== null) return h.askAbove !== null ? W.refusedYes(m(b.price), m(h.askAbove)) : W.refusedYesNoLine(m(b.price));
      if (b.clause === 4) {
        const wall = h.side === 'buyer' ? h.ceiling : h.floor;
        return wall !== null ? W.refusedWall(m(wall)) : W.refusedOther;
      }
      return W.refusedOther;
    case 'owner':
      return W.ownerYes(m(b.price));
    case 'accept':
      return b.by === 'them' ? W.theyAccept(who, m(b.price)) : W.agentAccepts(m(b.price));
    case 'agreed':
      return `${W.agreed(m(b.price))} ${b.byOwner ? W.agreedByYou : W.agreedByRule}`;
    case 'withdrawn':
      return b.by === 'you' ? W.withdrawnYou : W.withdrawnThem(who);
  }
}

import { describe, expect, it } from 'vitest';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import {
  clampCeiling, clampFloor, consequences, fenceKey, moveFence, diffLines, draftValid, fits, ladderScale, lastPriced, parseAmount, priceAt,
  posPct, sameBand, short, standLine, standing, stepStates, tabLine, toInput, topPct, unitOf, type ConsequenceInput,
} from './ladder';

const usd = (d: number) => d * 100;
const step = (seq: number, by: 'you' | 'them', typ: TranscriptStep['typ'], dollars: number | null): TranscriptStep =>
  ({ seq, by, typ, price: dollars === null ? null : { minor: usd(dollars), currency: 'USD' }, at: 1000 + seq, verified: true });

describe('ladder geometry', () => {
  it('scales over every signed value with a little room, on round ticks', () => {
    const s = ladderScale([usd(290), usd(389), usd(340), usd(301), usd(336)]);
    expect(s).not.toBeNull();
    expect(s!.lo).toBeLessThanOrEqual(usd(290));
    expect(s!.hi).toBeGreaterThanOrEqual(usd(389));
    expect(s!.ticks.length).toBeGreaterThanOrEqual(3);
    expect(s!.ticks[0]).toBe(s!.lo);
  });
  it('has no scale when nothing is priced', () => {
    expect(ladderScale([null, undefined])).toBeNull();
    expect(ladderScale([])).toBeNull();
  });
  it('maps price to distance from the top and back', () => {
    const s = { lo: usd(280), hi: usd(400) };
    expect(topPct(usd(400), s)).toBe(0);
    expect(topPct(usd(280), s)).toBe(100);
    expect(topPct(usd(340), s)).toBe(50);
    expect(topPct(usd(999), s)).toBe(0);
    expect(priceAt(0.5, s, unitOf('USD'))).toBe(usd(340));
    expect(priceAt(0, s, 100)).toBe(usd(400));
    expect(priceAt(2, s, 100)).toBe(usd(280));
    expect(priceAt(0.501, s, 100)).toBe(usd(340)); // snaps to whole dollars
  });
  it('keeps a dragged ceiling on the ladder, whole, and never under the floor', () => {
    const s = { lo: usd(280), hi: usd(400) };
    expect(clampCeiling(usd(500), s, 100, null)).toBe(usd(400));
    expect(clampCeiling(usd(100), s, 100, null)).toBe(usd(281));
    expect(clampCeiling(usd(300) + 49, s, 100, null)).toBe(usd(300));
    expect(clampCeiling(usd(300), s, 100, usd(320))).toBe(usd(320));
    expect(clampCeiling(usd(300), null, 100, null)).toBe(usd(300));
  });
  it('moves the buyer ceiling or the seller floor, keeping the other bound', () => {
    const s = { lo: usd(280), hi: usd(400) };
    expect(moveFence({ floor: null, ceiling: usd(340) }, 'buyer', usd(325), s, 100)).toEqual({ floor: null, ceiling: usd(325) });
    expect(moveFence({ floor: usd(300), ceiling: usd(350) }, 'seller', usd(360), s, 100)).toEqual({ floor: usd(350), ceiling: usd(350) });
    expect(clampFloor(usd(999), s, 100, null)).toBe(usd(399));
    expect(fenceKey('seller')).toBe('floor');
  });
});

describe('money text', () => {
  it('drops .00 on whole amounts only', () => {
    expect(short(usd(340), 'USD')).toBe('$340');
    expect(short(34050, 'USD')).toBe('$340.50');
    expect(short(usd(1340), 'USD')).toBe('$1,340');
    expect(short(500, 'JPY')).toBe('500 JPY');
  });
  it('parses typed amounts exactly and refuses anything else', () => {
    expect(parseAmount('340', 'USD')).toBe(34000);
    expect(parseAmount(' $1,340.5 ', 'USD')).toBe(134050);
    expect(parseAmount('340.555', 'USD')).toBeNull();
    expect(parseAmount('abc', 'USD')).toBeNull();
    expect(parseAmount('-3', 'USD')).toBeNull();
    expect(toInput(34000, 'USD')).toBe('340');
    expect(toInput(34005, 'USD')).toBe('340.05');
  });
});

describe('band draft', () => {
  it('compares, validates and fits', () => {
    expect(sameBand({ floor: null, ceiling: 1 }, { floor: null, ceiling: 1 })).toBe(true);
    expect(sameBand(null, { floor: null, ceiling: 1 })).toBe(false);
    expect(draftValid({ floor: null, ceiling: null })).toBe(false);
    expect(draftValid({ floor: 500, ceiling: 400 })).toBe(false);
    expect(draftValid({ floor: null, ceiling: 400 })).toBe(true);
    expect(fits(usd(329), { floor: null, ceiling: usd(340) })).toBe(true);
    expect(fits(usd(329), { floor: null, ceiling: usd(325) })).toBe(false);
    expect(fits(usd(329), { floor: usd(330), ceiling: null })).toBe(false);
    expect(fits(usd(329), null)).toBe(true);
  });
  it('finds the latest priced envelope per side', () => {
    const t = [step(1, 'them', 'LISTING', 389), step(2, 'you', 'OFFER', 290), step(3, 'them', 'COUNTER', 372), step(4, 'them', 'WITHDRAW', null)];
    expect(lastPriced(t, 'them', 'USD')).toEqual({ seq: 3, price: usd(372), typ: 'COUNTER' });
    expect(lastPriced(t, 'you', 'USD')).toEqual({ seq: 2, price: usd(290), typ: 'OFFER' });
    expect(lastPriced([], 'you', 'USD')).toBeNull();
  });
  it('lists the price-range edits', () => {
    expect(diffLines('monitor-27-4k', { floor: null, ceiling: usd(340) }, { floor: null, ceiling: usd(325) }, 'USD')).toEqual(['Most you’ll pay: $340 → $325']);
    expect(diffLines('m', null, { floor: null, ceiling: usd(200) }, 'USD')).toEqual(['Most you’ll pay: $200 (new)']);
    expect(diffLines('m', { floor: null, ceiling: usd(1) }, { floor: usd(1), ceiling: usd(1) }, 'USD')).toEqual(['Least you’ll accept: none → $1']);
  });
});

describe('consequences of a band move', () => {
  const base: ConsequenceInput = {
    item: 'monitor-27-4k', them: 'Dan', side: 'buyer', signed: { floor: null, ceiling: usd(340) }, draft: { floor: null, ceiling: usd(325) },
    theirs: { seq: 11, price: usd(329), typ: 'COUNTER' }, yours: { seq: 10, price: usd(327), typ: 'COUNTER' },
    roundsUsed: 5, maxRounds: 6, pending: true, currency: 'USD',
  };
  it('flags a signable ask that becomes unsignable, the lapsing request and your own bid above the fence', () => {
    const c = consequences(base);
    const x = c.filter((l) => l.tone === 'x').map((l) => l.text);
    expect(x).toHaveLength(3);
    expect(x[0]).toContain('could be accepted before; after this change it can\'t');
    expect(x[1]).toContain('waiting for you lapses');
    expect(x[2]).toContain('earlier offer of $327');
    expect(c.at(-1)?.text).toContain('never pays');
  });
  it('says how much room is left when the ask still fits', () => {
    const c = consequences({ ...base, draft: { floor: null, ceiling: usd(345) } });
    expect(c.filter((l) => l.tone === 'x')).toHaveLength(0);
    expect(c.find((l) => l.tone === 'ok')?.text).toBe("Dan's $329 still fits · $16 of room.");
  });
  it('reads a first band and a seller floor', () => {
    const first = consequences({ ...base, signed: null, draft: { floor: null, ceiling: usd(330) }, pending: false });
    expect(first[0]).toEqual({ tone: 'i', text: 'Sets a price range for monitor-27-4k: your agent may start offering up to $330.' });
    const seller = consequences({ ...base, side: 'seller', signed: { floor: usd(300), ceiling: null }, draft: { floor: usd(330), ceiling: null }, yours: null, pending: false });
    expect(seller.some((l) => l.tone === 'x' && l.text.includes('after this change it can\'t'))).toBe(true);
  });
  it('says when no counters are left', () => {
    const c = consequences({ ...base, roundsUsed: 6, draft: { floor: null, ceiling: usd(345) } });
    expect(c.some((l) => l.tone === 'x' && l.text.includes('No offers left'))).toBe(true);
  });
});

describe('table tab line and steps', () => {
  it('reads the gap between the latest price and the fence', () => {
    expect(tabLine({ band: { floor: null, ceiling: usd(340) }, theirs: { seq: 11, price: usd(329), typ: 'COUNTER' }, side: 'buyer', roundsLeft: 1, state: 'NEGOTIATING', currency: 'USD' }))
      .toBe('asking $329 · $11 under your max · 1 offer left');
    expect(tabLine({ band: { floor: null, ceiling: usd(320) }, theirs: { seq: 11, price: usd(329), typ: 'COUNTER' }, side: 'buyer', roundsLeft: null, state: 'NEGOTIATING', currency: 'USD' }))
      .toBe('asking $329 · $9 over your max');
    expect(tabLine({ band: null, theirs: null, side: 'buyer', roundsLeft: null, state: 'PAIRING', currency: 'USD' })).toBe('connecting · no price range yet');
    expect(tabLine({ band: null, theirs: { seq: 1, price: usd(236), typ: 'LISTING' }, side: 'buyer', roundsLeft: null, state: 'LISTED', currency: 'USD' })).toBe('listed at $236 · no price range yet');
  });
  it('places a price on the horizontal where-it-stands bar', () => {
    const s = { lo: usd(280), hi: usd(400) };
    expect(posPct(usd(280), s)).toBe(0);
    expect(posPct(usd(400), s)).toBe(100);
    expect(posPct(usd(340), s)).toBe(50);
  });
  it('says where their latest price stands against your limit', () => {
    const theirs = { seq: 11, price: usd(329), typ: 'COUNTER' } as const;
    const buyer = { floor: null, ceiling: usd(340) };
    expect(standing({ band: buyer, theirs, side: 'buyer' })).toEqual({ kind: 'inside', gap: usd(11) });
    expect(standing({ band: { floor: null, ceiling: usd(320) }, theirs, side: 'buyer' })).toEqual({ kind: 'over', gap: usd(9) });
    expect(standing({ band: { floor: usd(300), ceiling: null }, theirs, side: 'seller' })).toEqual({ kind: 'inside', gap: usd(29) });
    expect(standing({ band: { floor: usd(330), ceiling: null }, theirs, side: 'seller' })).toEqual({ kind: 'over', gap: usd(1) });
    expect(standing({ band: buyer, theirs: null, side: 'buyer' }).kind).toBe('no-offer');
    expect(standing({ band: null, theirs, side: 'buyer' }).kind).toBe('no-limit');
    expect(standing({ band: { floor: usd(300), ceiling: null }, theirs, side: 'buyer' }).kind).toBe('no-limit');
  });
  it('writes the where-it-stands sentence in plain words', () => {
    const theirs = { seq: 11, price: usd(329), typ: 'COUNTER' } as const;
    const o = { band: { floor: null, ceiling: usd(340) }, theirs, side: 'buyer', who: 'Dan', currency: 'USD' } as const;
    expect(standLine(o)).toBe('Dan asks $329: $11 inside your limit.');
    expect(standLine({ ...o, band: { floor: null, ceiling: usd(320) } })).toBe('Dan asks $329: $9 past your limit, so your agent can’t accept it.');
    expect(standLine({ ...o, band: { floor: null, ceiling: usd(329) } })).toBe('Dan asks $329: right at your limit.');
    expect(standLine({ ...o, theirs: null })).toBe('No offer from Dan yet.');
    expect(standLine({ ...o, band: null })).toContain('You haven’t set a limit yet');
    expect(standLine({ ...o, side: 'seller', band: { floor: usd(300), ceiling: null } })).toBe('Dan offers $329: $29 inside your limit.');
  });
  it('walks draft → what changes → sign', () => {
    expect(stepStates({ drafting: false, read: false, handedOff: false })).toEqual(['on', 'off', 'off']);
    expect(stepStates({ drafting: true, read: false, handedOff: false })).toEqual(['done', 'on', 'off']);
    expect(stepStates({ drafting: true, read: true, handedOff: false })).toEqual(['done', 'done', 'on']);
    expect(stepStates({ drafting: true, read: true, handedOff: true })).toEqual(['done', 'done', 'done']);
  });
});

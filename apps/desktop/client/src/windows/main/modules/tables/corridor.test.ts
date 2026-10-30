import { describe, expect, it } from 'vitest';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import type { HistoryStep } from '@bindings/HistoryStep';
import { mockBackend } from '../../../../mock/backend';
import { fakeUlid } from '../../../../mock/fixtures';
import { RECORDED_HAGGLE, RECORDED_LABEL } from '../../../../mock/haggle';
import { captionOf, frameAt, haggleOf, haggleSpan, LEAD_MS, lunge, playbook, SLIDE_MS, trackOf, watchable, xOf, type Beat, type Haggle } from './corridor';

const usd = (minor: number) => ({ minor, currency: 'USD' as const });
const step = (seq: number, by: 'you' | 'them', typ: TranscriptStep['typ'], price: number | null, at: number): TranscriptStep => ({ seq, by, typ, price: price === null ? null : usd(price), at, verified: true });
const hist = (at: number, kind: HistoryStep['kind'], authority: HistoryStep['authority'] = { type: 'none' }): HistoryStep => ({ at, deal_id: 'D', seq: at, kind, state_after: null, authority, paypal: { type: 'none' } });

/** The recording, read the way the corridor reads it: what each line of haggle.json should become. */
function expectedBeats(): Beat[] {
  const out: Beat[] = [];
  let theirs: number | null = null;
  let seenOurs = false;
  for (const s of RECORDED_HAGGLE.steps) {
    if (s.act === 'listing' || s.act === 'counter') { theirs = s.price; out.push({ kind: 'price', by: 'them', price: s.price, first: false }); }
    else if (s.act === 'offer') { out.push({ kind: 'price', by: 'you', price: s.price, first: !seenOurs }); seenOurs = true; }
    else if (s.act === 'refused') out.push({ kind: 'refused', price: theirs, clause: s.clause ?? null });
    else if (s.act === 'accept' && s.by === 'owner') out.push({ kind: 'owner', price: s.price });
    else if (s.act === 'accept') out.push({ kind: 'agreed', price: s.price, byOwner: true });
  }
  return out;
}

describe('watch the haggle: the recorded house table', () => {
  it('replays exactly what the engine signed: the mock D-0205 read back through the wallet’s own queries equals haggle.json', async () => {
    const main = mockBackend('main');
    const id = fakeUlid(RECORDED_LABEL);
    const [deal, transcript, history, display] = await Promise.all([
      main.invoke('get_deal', { deal_id: id }),
      main.invoke('deal_transcript', { deal_id: id }),
      main.invoke('deal_history', { deal_id: id }),
      main.invoke('deal_display', { deal_id: id }),
    ]);
    const h = haggleOf({
      currency: deal.terms.currency, side: deal.side, transcript, history: history.steps,
      ceiling: display.band?.ceiling?.minor ?? null, floor: display.band?.floor?.minor ?? null, maxOffers: display.band?.max_rounds ?? null,
      askAbove: RECORDED_HAGGLE.rules.ask_above,
      market: deal.market ? { p25: deal.market.p25.minor, median: deal.market.median.minor, p75: deal.market.p75.minor } : null,
    });
    expect(h.beats).toEqual(expectedBeats());
    expect(h.ceiling).toBe(RECORDED_HAGGLE.rules.ceiling);
    expect(h.market).toEqual({ p25: RECORDED_HAGGLE.market.p25, median: RECORDED_HAGGLE.market.median, p75: RECORDED_HAGGLE.market.p75 });
    expect(deal.terms.unit_price.minor).toBe(RECORDED_HAGGLE.outcome.price);
    expect(watchable(h)).toBe(true);
    expect(haggleSpan(h)).toEqual({ from: RECORDED_HAGGLE.steps[0]!.price, to: RECORDED_HAGGLE.outcome.price });
    // The one refusal is the wallet's, on the agent's yes over the ask-me line; every offer stays under the ceiling.
    const refused = h.beats.filter((b) => b.kind === 'refused');
    expect(refused).toEqual([{ kind: 'refused', price: RECORDED_HAGGLE.outcome.price, clause: 6 }]);
    for (const b of h.beats) if (b.kind === 'price') expect(b.price).toBeLessThanOrEqual(RECORDED_HAGGLE.rules.ceiling);
  });
});

describe('haggleOf', () => {
  it('orders signed prices and refusals on one clock, an ask-me refusal carrying the price the agent tried', () => {
    const h = haggleOf({
      currency: 'USD', side: 'buyer',
      transcript: [step(1, 'them', 'LISTING', 34000, 10), step(1, 'you', 'OFFER', 30000, 20), step(2, 'them', 'COUNTER', 32900, 30)],
      history: [hist(30, 'intent_refused', { type: 'signed_rule', clause: 6 }), hist(15, 'intent_refused', { type: 'signed_rule', clause: 4 })],
    });
    expect(h.beats).toEqual([
      { kind: 'price', by: 'them', price: 34000, first: false },
      { kind: 'refused', price: null, clause: 4 },
      { kind: 'price', by: 'you', price: 30000, first: true },
      { kind: 'price', by: 'them', price: 32900, first: false },
      { kind: 'refused', price: 32900, clause: 6 },
    ]);
    expect(watchable(h)).toBe(true);
  });
  it('an agent accept inside the rules agrees on its own; a lone listing is not worth watching', () => {
    const h = haggleOf({
      currency: 'USD', side: 'buyer',
      transcript: [step(1, 'them', 'LISTING', 21500, 1), step(1, 'you', 'OFFER', 20000, 2), step(2, 'them', 'COUNTER', 21200, 3), step(2, 'you', 'ACCEPT', 21200, 4), step(3, 'them', 'ACCEPT', 21200, 5)],
    });
    expect(h.beats.slice(-2)).toEqual([{ kind: 'accept', by: 'you', price: 21200 }, { kind: 'agreed', price: 21200, byOwner: false }]);
    expect(watchable(haggleOf({ currency: 'USD', side: 'buyer', transcript: [step(1, 'them', 'LISTING', 100, 1)] }))).toBe(false);
  });
});

describe('the clock and the frame', () => {
  const h: Haggle = {
    currency: 'USD', side: 'buyer', ceiling: 34000, floor: null, askAbove: 25000, maxOffers: 6, market: { p25: 30000, median: 33000, p75: 36000 },
    beats: [
      { kind: 'price', by: 'them', price: 34000, first: false },
      { kind: 'price', by: 'you', price: 30000, first: true },
      { kind: 'price', by: 'them', price: 33600, first: false },
      { kind: 'refused', price: 33600, clause: 6 },
      { kind: 'owner', price: 33600 },
      { kind: 'agreed', price: 33600, byOwner: true },
    ],
  };
  const pb = playbook(h);
  it('lands each beat in order and holds the refusal longest', () => {
    expect(pb.cues.map((c) => c.at)).toEqual([...pb.cues.map((c) => c.at)].sort((a, b) => a - b));
    expect(pb.cues[0]!.at).toBe(LEAD_MS);
    const refusal = pb.cues.find((c) => c.beat.kind === 'refused')!;
    expect(Math.max(...pb.cues.map((c) => c.hold))).toBe(refusal.hold);
    expect(pb.total).toBe(pb.cues[pb.cues.length - 1]!.at + pb.cues[pb.cues.length - 1]!.hold);
  });
  it('draws nothing before the first beat, slides between prices and snaps both pucks to the agreed price', () => {
    expect(frameAt(pb, 0)).toMatchObject({ you: null, them: null, current: -1, gap: null, done: false });
    const c2 = pb.cues[2]!;
    const mid = frameAt(pb, c2.at + SLIDE_MS / 2);
    expect(mid.them).toBeGreaterThan(33600);
    expect(mid.them).toBeLessThan(34000);
    expect(frameAt(pb, c2.at + SLIDE_MS).them).toBe(33600);
    const end = frameAt(pb, pb.total);
    expect(end).toMatchObject({ you: 33600, them: 33600, gap: 0, done: true, offers: 1 });
    expect(end.snap).toMatchObject({ price: 33600, p: 1, byOwner: true });
    expect(end.trail).toEqual({ you: [30000], them: [34000, 33600] });
    const refusal = pb.cues[3]!;
    expect(frameAt(pb, refusal.at + 10).refusal).toMatchObject({ price: 33600, clause: 6 });
    expect(frameAt(pb, pb.cues[4]!.at + 1).refusal).toBeNull();
  });
  it('a refused yes lunges to the gate and comes back to rest', () => {
    expect(lunge(0)).toBe(0);
    expect(lunge(0.16)).toBeCloseTo(1, 5);
    expect(lunge(0.5)).toBe(0);
    expect(lunge(0.9)).toBe(0);
    for (let p = 0; p <= 1; p += 0.01) expect(lunge(p)).toBeGreaterThanOrEqual(0);
  });
  it('the track holds every price and the walls; the market’s top end and an ask-me line far below stay off it', () => {
    const t = trackOf(h)!;
    expect(t.lo).toBeLessThanOrEqual(30000);
    expect(t.hi).toBeGreaterThanOrEqual(34000);
    expect(t.hi).toBeLessThan(36000);
    expect(t.lo).toBeGreaterThan(25000);
    expect(xOf(t.lo, t)).toBe(0);
    expect(xOf(t.hi, t)).toBe(1);
  });
  it('says each beat in Maya’s words: the refusal is the wallet’s, never the agent’s', () => {
    const lines = h.beats.map((b) => captionOf(b, h, 'House seller'));
    expect(lines[0]).toBe('House seller lists it at $340.');
    expect(lines[1]).toBe('Your agent opens at $300.');
    expect(lines[2]).toBe('House seller comes down to $336.');
    expect(lines[3]).toContain('the wallet refuses: not the agent');
    expect(lines[3]).toContain('$250');
    expect(lines[4]).toBe('You say yes to $336, in the approval window.');
    expect(lines[5]).toContain('Agreed at $336.');
  });
});

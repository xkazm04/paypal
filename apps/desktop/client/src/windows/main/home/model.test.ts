import { describe, expect, it } from 'vitest';
import { buildMockState } from '../../../mock/fixtures';
import { summarize, weekBounds } from '../logic';
import { chipTone, heldAtPayPal, heldLine, moneyList, shortTitle, silenceParts, timeLeft, weekLabel } from './model';

const NOW = 1_800_000_000;

describe('home model', () => {
  it('splits the default on silence at the first separator', () => {
    expect(silenceParts('the offer lapses at 18:00 · no money moves')).toEqual({ head: 'the offer lapses at 18:00', rest: 'no money moves' });
    expect(silenceParts('a · b · c')).toEqual({ head: 'a', rest: 'b · c' });
    expect(silenceParts('nothing is sent')).toEqual({ head: 'nothing is sent', rest: null });
  });

  it('maps every state class to a chip tone', () => {
    expect(chipTone('live')).toBe('teal');
    expect(chipTone('held')).toBe('gold');
    expect(chipTone('done')).toBe('ok');
    expect(chipTone('bad')).toBe('red');
    expect(chipTone('off')).toBe('line');
  });

  it('labels a Monday-Sunday week by its first and last day', () => {
    const { start, end } = weekBounds(NOW);
    const label = weekLabel(start, end);
    expect(label).toMatch(/^\d{1,2} \w{3,4} – \d{1,2} \w{3,4}$/);
    expect(new Date(start * 1000).getDay()).toBe(1);
    expect(new Date((end - 1) * 1000).getDay()).toBe(0);
  });

  it('never sums across currencies', () => {
    expect(moneyList([])).toBe(moneyList([{ minor: 0, currency: 'USD' }]));
    expect(moneyList([{ minor: 100, currency: 'USD' }, { minor: 200, currency: 'EUR' }])).toContain(' + ');
  });

  it('says a time left in plain words', () => {
    expect(timeLeft(null, NOW)).toBeNull();
    expect(timeLeft(NOW + 2 * 3600 + 14 * 60, NOW)).toEqual({ text: '2 h 14 min left', urgent: false });
    expect(timeLeft(NOW + 9 * 60, NOW)).toEqual({ text: '9 min left', urgent: true });
    expect(timeLeft(NOW - 5, NOW)).toEqual({ text: 'time is up', urgent: true });
  });

  it('drops the noise a one-line row cannot afford', () => {
    expect(shortTitle('Refurbished 27-inch monitor (grade A)')).toBe('27-inch monitor');
  });

  it('does not count a payment being checked with PayPal as on hold', () => {
    const state = buildMockState(NOW);
    const checking = new Set(state.deals.filter((d) => d.attention?.money_check).map((d) => d.deal.id));
    expect(checking.size).toBe(1); // D-0194: AUTHORIZED, seller, $118.00, capture parked
    const s = summarize(state.deals.map((d) => d.deal), new Set(state.deals.filter((d) => d.attention).map((d) => d.deal.id)));
    const h = heldAtPayPal(s.held, checking);
    expect(h.inn).toEqual([]);
    expect(h.out).toEqual(heldAtPayPal(s.held).out);
    expect(h.deals.some((d) => checking.has(d.id))).toBe(false);
    expect(heldLine(h)).toBe('$64.00 out');
  });
});

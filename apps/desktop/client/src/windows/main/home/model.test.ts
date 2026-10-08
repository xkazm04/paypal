import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import { buildMockState } from '../../../mock/fixtures';
import { weekBounds } from '../logic';
import { chipTone, dealCount, dialValueText, ledgerLine, moneyList, shortTitle, silenceParts, timeLeft, weekLabel } from './model';

const NOW = 1_800_000_000;
const deals = buildMockState(NOW).deals.map((d) => d.deal);
const any = deals[0] as Deal;

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

  it('says a count and a time left in plain words', () => {
    expect(dealCount(0)).toBe('none');
    expect(dealCount(1)).toBe('1 deal');
    expect(dealCount(3)).toBe('3 deals');
    expect(timeLeft(null, NOW)).toBeNull();
    expect(timeLeft(NOW + 2 * 3600 + 14 * 60, NOW)).toEqual({ text: '2 h 14 min left', urgent: false });
    expect(timeLeft(NOW + 9 * 60, NOW)).toEqual({ text: '9 min left', urgent: true });
    expect(timeLeft(NOW - 5, NOW)).toEqual({ text: 'time is up', urgent: true });
  });

  it('writes one line per ledger deal', () => {
    expect(shortTitle('Refurbished 27-inch monitor (grade A)')).toBe('27-inch monitor');
    expect(ledgerLine('held', { ...any, state: 'AUTHORIZED', shield: null }, 'x')).toContain('on hold at PayPal');
    expect(ledgerLine('held', { ...any, state: 'NEGOTIATING', shield: 'HOLD' }, 'x')).toContain('paused by a scam check');
    expect(ledgerLine('stopped', { ...any, state: 'REFUSED', shield: 'BLOCK' }, 'Refurbished GPU')).toBe('blocked · GPU');
    expect(ledgerLine('moving', { ...any, state: 'AWAITING_APPROVAL', shield: null }, 'Dock')).toBe('waiting for approval · Dock');
  });

  it('reads the dial for a screen reader: the part under the index, then the decision it points at', () => {
    const spend = { name: 'Spend', long: 'Agent purchases' };
    expect(dialValueText({ firstRun: false, mode: 'module', module: spend, needsHere: 0, need: null })).toBe('Spend, agent purchases');
    expect(dialValueText({ firstRun: false, mode: 'module', module: spend, needsHere: 2, need: null })).toBe('Spend, agent purchases: 2 need you');
    expect(dialValueText({ firstRun: false, mode: 'needs', module: spend, needsHere: 1, need: { headline: 'Pay partsco $64.00', index: 0, count: 6 } }))
      .toBe('Spend, agent purchases: Pay partsco $64.00 · 1 of 6 need you');
    expect(dialValueText({ firstRun: true, mode: 'needs', module: spend, needsHere: 0, need: null })).toBe('Spend, agent purchases. Opens once setup is done');
  });
});

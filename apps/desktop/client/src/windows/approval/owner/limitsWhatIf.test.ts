// The wallet-limits what-if, worded: Rust's envelope_simulate answers each purchase of the week for
// the limits in force ("before") and the draft ("after"); the sheet says how many the draft stops
// and names the limit that stops each one.
import { describe, expect, it } from 'vitest';
import type { SimulatedLine } from '@bindings/SimulatedLine';
import type { SimulatedVerdict } from '@bindings/SimulatedVerdict';
import { limitsWhatIfWords, stoppedBy } from './WalletLimits';

const allow: SimulatedVerdict = { type: 'allow' };
const refuse = (reason: string): SimulatedVerdict => ({ type: 'refuse', clause: 0, reason });
const line = (n: number, before: SimulatedVerdict, after: SimulatedVerdict): SimulatedLine => ({
  deal_id: `D${n}`, label: `D-000${n}`, title: 'monitor', item_ref: 'monitor', kind: 'purchase', side: 'buyer', at: 100 + n,
  amount: { minor: 1000, currency: 'USD' }, unit_price: { minor: 1000, currency: 'USD' }, before, after,
});

describe('wallet-limits what-if words', () => {
  it('counts what the draft would have stopped this week, and what it lets through', () => {
    expect(limitsWhatIfWords([])).toBe('No purchases this week to try these limits on.');
    expect(limitsWhatIfWords([line(1, allow, allow)])).toBe('These limits would have stopped none of the 1 purchase this week.');
    const week = [line(1, allow, allow), line(2, allow, allow), line(3, allow, refuse('max_deals_day: 2 deals agreed today of 2 allowed'))];
    expect(limitsWhatIfWords(week)).toBe('These limits would have stopped 1 of 3 purchases this week.');
    expect(limitsWhatIfWords([line(1, refuse('max_held: held 0.00 + waiting 0.00 + 10.00 above 5.00 USD'), allow), ...week]))
      .toBe('These limits would have stopped 1 of 4 purchases this week. 1 purchase your limits now stop would go through.');
  });

  it('names the limit that stops a purchase in words, never the field name', () => {
    expect(stoppedBy(allow)).toBeNull();
    expect(stoppedBy(refuse('max_out_day: paid out today 10.00 + 12.00 above 20.00 USD'))).toBe('Most your agents can pay out in a day');
    expect(stoppedBy(refuse('max_deals_day: 1 deals agreed today of 1 allowed'))).toBe('Most deals a day');
    expect(stoppedBy(refuse('max_held: held …'))).toBe('Most on hold at once');
    expect(stoppedBy(refuse('expires: the wallet limits expired; sign new ones'))).toBe('Limits ran out');
    expect(stoppedBy(refuse('something new'))).toBe('Your wallet limits');
  });
});

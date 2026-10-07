import { describe, expect, it } from 'vitest';
import type { ForecastLine } from '@bindings/ForecastLine';
import { clockLabel } from '../../lib/format';
import { WALK_AWAY_HOURS, walkAway } from './logic';

const NOW = 1_800_000_000;
const H = 3600;

function line(o: Partial<ForecastLine> & Pick<ForecastLine, 'action'>): ForecastLine {
  return {
    deal_id: '01JD00000000000000000000A1', label: 'D-0189', trigger: 'deadline', at: NOW + 5 * H, authority: 'safe_default',
    direction: 'none', amount_minor: 9000, currency: 'USD', end_state: 'EXPIRED', before: null,
    ...o,
  };
}
const capture = (o: Partial<ForecastLine> = {}) => line({ action: 'capture', authority: 'seller_mandate', direction: 'in', trigger: 'next_tick', at: null, end_state: 'RECEIPTED', ...o });
const authorize = (o: Partial<ForecastLine> = {}) => line({ action: 'authorize', authority: 'seller_mandate', direction: 'none', trigger: 'next_tick', at: null, end_state: 'AUTHORIZED', ...o });
const walk = (forecast: ForecastLine[] | null | undefined, currency: ForecastLine['currency'] | null = 'USD') =>
  walkAway({ forecast, wallet_spend_today_currency: currency });

describe('if you walk away', () => {
  it('looks 72 hours ahead, like the Rust forecast', () => {
    expect(WALK_AWAY_HOURS).toBe(72);
  });

  it('promises nothing when the forecast is absent (older shell or a failed read)', () => {
    for (const r of [walk(undefined), walk(null), walkAway(undefined)]) {
      expect(r).toEqual({ known: false, summary: 'Can’t forecast right now' });
      expect(r.summary).not.toMatch(/nothing moves|no money/);
    }
  });

  it('shows $0.00 out even with nothing scheduled, in the wallet currency', () => {
    const r = walk([]);
    expect(r.known && r.out).toBe('$0.00');
    expect(r.summary).toBe('$0.00 out · nothing scheduled');
    // No currency known anywhere: it still says nothing goes out, without inventing one.
    expect(walk([], null).summary).toBe('nothing goes out · nothing scheduled');
  });

  it('keeps money out at zero and totals money in per currency', () => {
    const r = walk([
      capture(),
      capture({ deal_id: '01JD00000000000000000000A2', label: 'D-0190', amount_minor: 2500 }),
      capture({ deal_id: '01JD00000000000000000000A3', label: 'D-0191', amount_minor: 1000, currency: 'EUR' }),
      line({ action: 'lapse', currency: 'GBP', deal_id: '01JD00000000000000000000A4', label: 'D-0192', end_state: 'WITHDRAWN' }),
    ], null);
    if (!r.known) throw new Error('known');
    expect(r.out).toBe('$0.00 + €0.00 + £0.00');
    expect(r.inSure).toBe('$115.00 + €10.00');
    expect(r.inUpTo).toBeNull();
    expect(r.summary).toBe('$0.00 + €0.00 + £0.00 out · $115.00 + €10.00 in');
  });

  it('words a step that needs the buyer as conditional and only promises "up to"', () => {
    const r = walk([
      authorize({ trigger: 'buyer_approves', before: NOW + 5 * H }),
      capture({ trigger: 'buyer_approves', before: NOW + 5 * H }),
      line({ action: 'expire', at: NOW + 5 * H }),
    ]);
    if (!r.known) throw new Error('known');
    expect(r.inSure).toBeNull();
    expect(r.inUpTo).toBe('$90.00');
    expect(r.summary).toBe('$0.00 out · up to $90.00 in');
    // the capture stands for the authorize before it
    expect(r.lines.map((l) => [l.when, l.what, l.who, l.conditional])).toEqual([
      ['If the buyer approves', 'D-0189 $90.00 collected', 'your rule', true],
      [clockLabel(NOW + 5 * H), 'D-0189 payment request expires, nothing is paid', 'safe default', false],
    ]);
  });

  it('adds sure money to the conditional total', () => {
    const r = walk([capture({ amount_minor: 2500 }), capture({ deal_id: '01JD00000000000000000000A2', trigger: 'buyer_approves' })]);
    if (!r.known) throw new Error('known');
    expect(r.inSure).toBe('$25.00');
    expect(r.inUpTo).toBe('$115.00');
  });

  it('names whose authority each line acts on, in plain words', () => {
    const r = walk([
      line({ action: 'create_order', trigger: 'next_tick', at: null, authority: 'mandate_rule', end_state: 'AWAITING_APPROVAL' }),
      capture({ deal_id: '01JD00000000000000000000A2', label: 'D-0190' }),
      line({ action: 'auto_void', deal_id: '01JD00000000000000000000A3', label: 'D-0191', amount_minor: 6400, at: NOW + 50 * H, end_state: 'AUTO_VOIDED' }),
    ]);
    if (!r.known) throw new Error('known');
    expect(r.lines.map((l) => `${l.when} · ${l.what} · ${l.who}`)).toEqual([
      'Now · D-0189 payment request sent to the buyer · your rule',
      'Now · D-0190 $90.00 collected · the buyer already approved',
      `${clockLabel(NOW + 50 * H)} · D-0191 hold of $64.00 released · safe default`,
    ]);
    expect(r.releases).toBe(1);
    expect(r.summary).toBe('$0.00 out · $90.00 in · 1 hold released');
  });

  it('shows at most three lines and counts the rest; a hold that starts only on approval is no line', () => {
    const r = walk([
      line({ action: 'auto_void', trigger: 'buyer_approves', at: NOW + 72 * H, end_state: 'AUTO_VOIDED' }),
      ...[1, 2, 3, 4].map((n) => line({ action: 'lapse', deal_id: `01JD00000000000000000000B${n}`, label: `D-020${n}`, at: NOW + n * H, end_state: 'WITHDRAWN' })),
    ]);
    if (!r.known) throw new Error('known');
    expect(r.releases).toBe(0);
    expect(r.lines.map((l) => l.what)).toEqual(['D-0201 lapses, nothing is paid', 'D-0202 lapses, nothing is paid', 'D-0203 lapses, nothing is paid']);
    expect(r.more).toBe(1);
  });

  it('never reads counterparty text: every line is built from the label and amount', () => {
    const r = walk([capture({ label: 'D-0189' })]);
    if (!r.known) throw new Error('known');
    expect(Object.keys(r.lines[0] ?? {}).sort()).toEqual(['conditional', 'key', 'what', 'when', 'who']);
  });
});

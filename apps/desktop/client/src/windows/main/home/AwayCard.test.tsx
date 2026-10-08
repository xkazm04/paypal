// The away card and hub: lines say what happened with the amount in bold, one click opens the deal
// (one deal) or the Rewind at that moment (several), nothing on them is gold, and dismiss works.
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Deal } from '@bindings/Deal';
import type { HistoryStep } from '@bindings/HistoryStep';
import { buildMockState } from '../../../mock/fixtures';
import { awaySummary } from './away';
import { AwayCard, AwayHub } from './AwayCard';

const NOW = Math.floor(new Date(2026, 9, 8, 8, 30).getTime() / 1000);
const SEEN = Math.floor(new Date(2026, 9, 7, 18, 40).getTime() / 1000);
const t = buildMockState(NOW).deals[0]?.deal as Deal;
const deal = (id: string, minor: number, side: Deal['side'] = 'buyer'): Deal => ({ ...t, id, side, terms: { ...t.terms, qty: 1, unit_price: { minor, currency: 'USD' } } });
const DEALS = [deal('A', 5000), deal('B', 3300), deal('S', 9000, 'seller')];
const cap = (deal_id: string, at: number, authority: HistoryStep['authority'], seq: number): HistoryStep =>
  ({ at, deal_id, seq, kind: 'captured', state_after: 'CAPTURED', authority, paypal: { type: 'call', method: 'capture', outcome: 'ok' } });
const STEPS = [cap('A', SEEN + 100, { type: 'signed_rule', clause: 6 }, 1), cap('B', SEEN + 200, { type: 'signed_rule', clause: 6 }, 2), cap('S', SEEN + 300, { type: 'seller_mandate' }, 3)];
const S = awaySummary(STEPS, DEALS, SEEN, NOW, { needs: 2 });
const noop = () => {};

describe('away card', () => {
  afterEach(cleanup);

  it('tells each line with its amount in bold, since when, and the things that need Maya', () => {
    const r = render(<AwayCard s={S} onDismiss={noop} onDeal={noop} onRewind={noop} />);
    const lines = [...r.container.querySelectorAll('.aw-line')];
    expect(lines.map((l) => l.textContent?.replace(/ /g, ' '))).toEqual([
      'Your agents paid $83.00 under your rules (2 purchases)',
      'Your shop collected $90.00 after the buyer approved',
    ]);
    expect(lines[0]?.querySelector('b')?.textContent).toBe('$83.00');
    expect(r.container.querySelector('.aw-since')?.textContent).toBe('Since yesterday 18:40');
    expect(r.getByText('2 things need you')).toBeTruthy();
  });

  it('opens the deal for one deal, the Rewind at the first step for several, the Rewind at last seen from the link', () => {
    const onDeal = vi.fn();
    const onRewind = vi.fn();
    const r = render(<AwayCard s={S} onDismiss={noop} onDeal={onDeal} onRewind={onRewind} />);
    const lines = r.container.querySelectorAll('.aw-line');
    fireEvent.click(lines[0] as Element);
    expect(onRewind).toHaveBeenLastCalledWith(SEEN + 100);
    fireEvent.click(lines[1] as Element);
    expect(onDeal).toHaveBeenCalledWith('S');
    fireEvent.click(r.getByText('See it on the Rewind ›'));
    expect(onRewind).toHaveBeenLastCalledWith(SEEN);
  });

  it('never carries a gold control and can be dismissed', () => {
    const onDismiss = vi.fn();
    const r = render(<AwayCard s={S} onDismiss={onDismiss} onDeal={noop} onRewind={noop} />);
    expect(r.container.querySelector('.gbtn, .gold')).toBeNull();
    fireEvent.click(r.getByLabelText('Dismiss the summary'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('says no money moved in the hub when nothing did', () => {
    const quiet = awaySummary([], DEALS, SEEN, NOW);
    const r = render(<AwayHub s={quiet} onDismiss={noop} onDeal={noop} onRewind={noop} />);
    expect(r.getByText('Nothing happened. No money moved.')).toBeTruthy();
    expect(r.getByText('Nothing needs you')).toBeTruthy();
    expect(r.container.querySelector('.gbtn, .gold')).toBeNull();
  });

  it('shows at most four lines and sends the rest to the Rewind', () => {
    const many: HistoryStep[] = [
      ...STEPS,
      { at: SEEN + 400, deal_id: 'A', seq: 4, kind: 'refused', state_after: 'REFUSED', authority: { type: 'signed_rule', clause: 3 }, paypal: { type: 'none' } },
      { at: SEEN + 500, deal_id: 'B', seq: 5, kind: 'expired', state_after: 'EXPIRED', authority: { type: 'safe_default' }, paypal: { type: 'none' } },
      { at: SEEN + 600, deal_id: 'S', seq: 6, kind: 'shield_held', state_after: null, authority: { type: 'none' }, paypal: { type: 'none' } },
    ];
    const onRewind = vi.fn();
    const r = render(<AwayCard s={awaySummary(many, DEALS, SEEN, NOW)} onDismiss={noop} onDeal={noop} onRewind={onRewind} />);
    expect(r.container.querySelectorAll('.aw-line')).toHaveLength(4);
    fireEvent.click(r.getByText('and 1 more on the Rewind'));
    expect(onRewind).toHaveBeenCalledWith(SEEN);
  });
});

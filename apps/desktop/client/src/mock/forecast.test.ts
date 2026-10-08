import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import { mockForecast, mockQuitLines, quitPending, type ForecastDeal } from './forecast';

const NOW = 1_800_000_000;
const H = 3600;
const ctx = { now: NOW, paused: false, executorConfigured: true };

function fd(o: Partial<Deal> & Pick<Deal, 'state' | 'side'>, deadline: number | null = NOW + 5 * H, digital = true): ForecastDeal {
  const deal = {
    id: `01JD0000000000000000000${o.state.length.toString().padStart(3, '0')}`, mode: 'sandbox', shield: null, kind: 'shop_order',
    terms: { item_ref: 'x', qty: 1, unit_price: { minor: 9000, currency: 'USD' }, currency: 'USD', delivery: digital ? { type: 'digital_now' } : { type: 'ship_then_capture', days: 3 } },
    ...o,
  } as unknown as Deal;
  return { deal, label: 'D-0189', deadline };
}

describe('mock walk-away forecast mirrors the Rust rules', () => {
  it('a seller order awaiting the buyer: collected only if the buyer approves, else it expires', () => {
    const f = mockForecast([fd({ state: 'AWAITING_APPROVAL', side: 'seller' })], ctx);
    expect(f.map((l) => [l.action, l.trigger])).toEqual([['authorize', 'buyer_approves'], ['capture', 'buyer_approves'], ['expire', 'deadline']]);
    expect(f.every((l) => l.direction !== 'out')).toBe(true);
    const q = mockQuitLines([fd({ state: 'AWAITING_APPROVAL', side: 'seller' })], f);
    expect(q.while_off.map((l) => l.effect)).toEqual(['not_collected_if_approved']);
    expect(q.at_paypal.map((l) => l.effect)).toEqual(['request_runs_out']);
  });

  it('a buyer hold releases by the safe default and PayPal still ends it on its own', () => {
    const d = fd({ state: 'AUTHORIZED', side: 'buyer' }, NOW + 50 * H, false);
    const f = mockForecast([d], ctx);
    expect(f.map((l) => [l.action, l.authority])).toEqual([['auto_void', 'safe_default']]);
    expect(mockQuitLines([d], f).at_paypal.map((l) => l.effect)).toEqual(['seller_may_collect', 'hold_runs_out']);
  });

  it('a refused deal is never pending, whatever its verdict; a mismatch is', () => {
    expect(quitPending(fd({ state: 'REFUSED', side: 'buyer', shield: 'BLOCK' }).deal)).toBe(false);
    expect(quitPending(fd({ state: 'MISMATCH', side: 'buyer', shield: 'HOLD' }).deal)).toBe(true);
    expect(quitPending(fd({ state: 'AGREED', side: 'buyer', shield: 'HOLD' }).deal)).toBe(true);
  });
});

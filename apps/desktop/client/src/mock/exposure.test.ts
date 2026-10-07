// T14 mock parity: the exposure fold and wallet limits as Rust computes them, and the gates
// envelope_sign (approval, token, unlocked) and envelope_get (every window) keep.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deal } from '@bindings/Deal';
import type { DealState } from '@bindings/DealState';
import { mockBackend, resetMockState } from './backend';
import { mockEnvelopeRefusal, mockExposureView, mockFold, type MockEnvelope } from './exposure';
import { fakeUlid } from './fixtures';

const NOW = 1_800_000_000;
const deal = (n: number, state: DealState, minor: number, over: Partial<Deal> = {}): Deal => ({
  id: fakeUlid(`X-${n}`), created_at: NOW - 60, updated_at: NOW - 30, kind: 'purchase', side: 'buyer', counterparty: 'peer',
  terms: { item_ref: 'dock', qty: 1, unit_price: { minor, currency: 'USD' }, currency: 'USD', delivery: { type: 'digital_now' } },
  state, mandate_id: fakeUlid('M'), mandate_version: 1, transcript_head: fakeUlid('H') as never, paypal: { order: null, authorization: null, capture: null, subscription: null },
  mode: 'sandbox', market: null, shield: null, ...over,
});
const env = (out: number, held: number, deals: number, over: Partial<MockEnvelope> = {}): MockEnvelope => ({
  payload: { version: 1, currency: 'USD', max_out_day: { minor: out, currency: 'USD' }, max_held: { minor: held, currency: 'USD' }, max_deals_day: deals, expires: NOW + 86400 },
  signedAt: NOW - 100,
  ...over,
});

describe('wallet limits (browser mock)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW * 1000);
    localStorage.clear(); sessionStorage.clear(); resetMockState();
    history.replaceState(null, '', '/index.html');
  });
  afterEach(() => { vi.useRealTimers(); });

  it('folds money out only: held, committed and today, per currency; released and seller deals never count', () => {
    const rows = mockFold([
      deal(1, 'AUTHORIZED', 6400), deal(2, 'AGREED', 3000), deal(3, 'CAPTURED', 1000),
      deal(4, 'VOIDED', 9999), deal(5, 'NEGOTIATING', 9999), deal(6, 'AUTHORIZED', 500, { side: 'seller' }),
      deal(7, 'AGREED', 2000, { terms: { item_ref: 'x', qty: 1, unit_price: { minor: 2000, currency: 'EUR' }, currency: 'EUR', delivery: { type: 'digital_now' } } }),
      deal(8, 'CAPTURED', 700, { updated_at: NOW - 2 * 86400 }),
    ], NOW);
    expect(rows.map((r) => r.currency)).toEqual(['EUR', 'USD']);
    expect(rows[1]).toMatchObject({ held: { minor: 6400 }, committed: { minor: 3000 }, out_today: { minor: 10400 }, paid_today: { minor: 1000 }, deals_today: 3 });
  });

  it('refuses money out over a limit with the limit named, never money in, and fails closed', () => {
    const deals = [deal(1, 'AGREED', 1200), deal(2, 'AGREED', 1200)];
    const third = deal(3, 'PAIRING', 1200);
    expect(mockEnvelopeRefusal(deals, third, env(3000, 100_000, 10), NOW)).toMatch(/^max_out_day/);
    expect(mockEnvelopeRefusal(deals, third, env(10_000, 3000, 10), NOW)).toMatch(/^max_held/);
    expect(mockEnvelopeRefusal(deals, third, env(10_000, 10_000, 2), NOW)).toMatch(/^max_deals_day/);
    expect(mockEnvelopeRefusal(deals, third, env(10_000, 10_000, 10), NOW)).toBeNull();
    expect(mockEnvelopeRefusal(deals, third, null, NOW)).toBeNull();
    expect(mockEnvelopeRefusal(deals, { ...third, side: 'seller' }, env(1, 1, 1), NOW)).toBeNull();
    expect(mockEnvelopeRefusal(deals, third, env(10_000, 10_000, 10), NOW + 86400)).toMatch(/^expires/);
    expect(mockEnvelopeRefusal(deals, third, env(10_000, 10_000, 10, { forged: true }), NOW)).toMatch(/^signature/);
    expect(mockExposureView(deals, env(1, 1, 1, { forged: true }), NOW)).toMatchObject({ status: 'unverified', limits: null });
    expect(mockExposureView(deals, null, NOW).status).toBe('none');
  });

  it('envelope_get answers every window; envelope_sign needs the approval window, its token and unlock', async () => {
    const main = mockBackend('main');
    const tumbler = mockBackend('tumbler');
    for (const b of [main, tumbler]) {
      const v = await b.invoke('envelope_get', null);
      expect(v.status).toBe('active');
      expect(v.limits?.max_deals_day).toBe(6);
      expect(v).not.toHaveProperty('owner_sig');
    }
    const args = { currency: 'USD' as const, max_out_day: { minor: 50000, currency: 'USD' as const }, max_held: { minor: 30000, currency: 'USD' as const }, max_deals_day: 4, expires: NOW + 7 * 86400 };
    await expect(main.invoke('envelope_sign', args)).rejects.toMatchObject({ code: 'PERMISSION' });
    history.replaceState(null, '', '/approval.html?locked=1');
    const idle = mockBackend('approval');
    const idleToken = await idle.invoke('approval_token', null);
    await expect(idle.invoke('envelope_sign', args, { token: idleToken })).rejects.toMatchObject({ code: 'LOCKED' });
    history.replaceState(null, '', '/approval.html');
    const approval = mockBackend('approval');
    await expect(approval.invoke('envelope_sign', args)).rejects.toMatchObject({ code: 'PERMISSION' });
    const token = await approval.invoke('approval_token', null);
    await expect(approval.invoke('envelope_sign', { ...args, max_deals_day: 0 }, { token })).rejects.toMatchObject({ code: 'REFUSED' });
    const signed = await approval.invoke('envelope_sign', args, { token });
    expect(signed.payload.version).toBe(2);
    const v = await approval.invoke('envelope_get', null);
    expect(v.limits?.max_out_day.minor).toBe(50000);
    // The meters in the attention snapshot read the same fold.
    const att = await tumbler.invoke('attention_list', null);
    expect(att.exposure?.currencies[0]?.out_today.minor).toBe(att.wallet_spend_today_minor);
    expect(att.wallet_spend_today_currency).toBe('USD');
  });

  it('?limits=none previews a wallet with no limits signed', async () => {
    history.replaceState(null, '', '/tumbler.html?limits=none');
    const v = await mockBackend('tumbler').invoke('envelope_get', null);
    expect(v).toMatchObject({ status: 'none', limits: null });
  });
});

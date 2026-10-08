// market-data-2 mock parity: every sample market record keeps re-checkable comparables (numbers
// and product ids, no text), each deal's evidence carries its fair price as Rust's does, and an
// owner's price refresh names only the product the deal's rules bind to its item.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rechecks } from '../lib/fairPrice';
import { mockBackend, resetMockState } from './backend';
import { buildMockState, fakeUlid } from './fixtures';

const NOW = 1_800_000_000;

describe('mock fair-price certificate (parity with the wallet)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW * 1000);
    vi.stubGlobal('BroadcastChannel', undefined);
    localStorage.clear(); sessionStorage.clear(); resetMockState();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('every sample market record re-checks and keeps only numbers and well-formed ids', () => {
    const state = buildMockState(NOW);
    const priced = state.deals.filter((d) => d.deal.market);
    expect(priced.length).toBeGreaterThan(5);
    for (const { deal } of priced) {
      const c = deal.market!.certificate;
      if (!c) continue;
      expect(rechecks(deal.market!)).toBe(true);
      expect(c.comparables.length).toBeLessThanOrEqual(30);
      for (const x of c.comparables) {
        expect(Number.isInteger(x.minor) && x.minor > 0).toBe(true);
        expect(x.product_id ?? '').toMatch(/^[A-Za-z0-9_-]{0,128}$/);
      }
    }
    // One older record stays as it was stored: no comparables.
    expect(priced.some((d) => !d.deal.market!.certificate)).toBe(true);
  });

  it('the evidence carries the fair price: re-checked, committed once agreed, older records said so', async () => {
    const main = mockBackend('main');
    const open = await main.invoke('deal_evidence', { deal_id: fakeUlid('D-0193') });
    expect(open.fair_price).toMatchObject({ state: 'rechecked', committed: false, prices: 13 });
    expect(open.fair_price?.percentile).toBeGreaterThan(50);
    const agreed = await main.invoke('deal_evidence', { deal_id: fakeUlid('D-0189') });
    expect(agreed.fair_price).toMatchObject({ state: 'rechecked', committed: true });
    // The receipt Maya keeps: $212.00 among 13 market prices, worked out again.
    const receipt = await main.invoke('deal_evidence', { deal_id: fakeUlid('D-0187') });
    expect(receipt.fair_price).toMatchObject({ state: 'rechecked', committed: true, prices: 13 });
    const older = await main.invoke('deal_evidence', { deal_id: fakeUlid('D-0196') });
    expect(older.fair_price).toMatchObject({ state: 'not_recheckable', committed: false, percentile: null });
    const none = await main.invoke('deal_evidence', { deal_id: fakeUlid('D-0176') });
    expect(none.fair_price).toBeNull();
  });

  it('a refresh for a product not bound to the deal’s item is refused', async () => {
    history.replaceState(null, '', `/approval.html?deal=${fakeUlid('D-0193')}`);
    const a = mockBackend('approval');
    const token = await a.invoke('approval_token', null);
    const deal_id = fakeUlid('D-0193');
    await expect(a.invoke('market_refresh', { deal_id, product_id: 'some-other-product' }, { token })).rejects.toMatchObject({ code: 'INVALID' });
    const m = await a.invoke('market_refresh', { deal_id, product_id: 'lg-27uk850-w' }, { token });
    expect(m.certificate?.product_id).toBe('lg-27uk850-w');
  });
});

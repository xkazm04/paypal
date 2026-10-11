import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import type { H256 } from '@bindings/H256';
import { outcomeText } from './model';

const HASH = Array.from({ length: 32 }, (_, i) => i) as H256;
const deal = (p: Partial<Deal> = {}): Deal => ({
  id: '01JDTESTDEAL0000000000000Q', kind: 'haggle', side: 'buyer', counterparty: 'kp_test',
  terms: { item_ref: 'monitor', qty: 1, unit_price: { minor: 32900, currency: 'USD' }, currency: 'USD', delivery: { type: 'digital_now' } },
  state: 'CAPTURED', mandate_id: 'M1', mandate_version: 3, transcript_head: HASH,
  paypal: { order: 'O', authorization: 'A', capture: 'C', subscription: null }, mode: 'sandbox', market: null, shield: 'CLEAR', ...p,
});

describe('what the window says after a capture', () => {
  it('a buyer reads what was paid and to whom', () => {
    const t = outcomeText('deal_capture', deal({ kind: 'purchase', side: 'buyer' }), 'Dan');
    expect(t).toMatch(/^Paid $329.00 to Dan · /);
    expect(t).toContain('confirmed by PayPal');
    expect(t).not.toMatch(/collected/i);
  });
  it('a seller reads what was collected: the money arrived, it was not sent', () => {
    const t = outcomeText('deal_capture', deal({ side: 'seller' }), 'Dan');
    expect(t).toMatch(/^Collected $329.00 · /);
    expect(t).not.toMatch(/sent|Paid/);
    expect(t).toContain('paid to you');
    expect(t).toContain('confirmed by PayPal');
  });
  it('multiplies the quantity, and drops the PayPal suffix until PayPal answered', () => {
    const t = outcomeText('deal_capture', deal({ side: 'seller', terms: { ...deal().terms, qty: 2 }, paypal: { order: 'O', authorization: 'A', capture: null, subscription: null } }), 'Dan');
    expect(t).toMatch(/^Collected $658.00 · /);
    expect(t).not.toContain('confirmed by PayPal');
  });
});

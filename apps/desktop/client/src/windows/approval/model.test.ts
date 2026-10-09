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
  it('a buyer sent a payment', () => {
    const t = outcomeText('deal_capture', deal({ kind: 'purchase', side: 'buyer' }), 'Dan');
    expect(t).toMatch(/^Payment sent/);
  });
  it('a seller collected one: the money arrived, it was not sent', () => {
    const t = outcomeText('deal_capture', deal({ side: 'seller' }), 'Dan');
    expect(t).toMatch(/^Payment collected/);
    expect(t).not.toMatch(/sent/);
    expect(t).toContain('paid to you');
  });
});

import { describe, expect, it } from 'vitest';
import { SELLER_SAYS_PAID, sellerSaysOnly, stateWord } from './words';

describe('a buyer is told only what the wallet knows about a seller receipt', () => {
  it('a buyer RECEIPTED deal reads "Seller says paid" with a waiting tone and the one shared sentence', () => {
    for (const kind of ['haggle', 'shop_order'] as const) {
      const w = stateWord('RECEIPTED', { side: 'buyer', kind });
      expect(w.text).toBe('Seller says paid');
      expect(w.tone).toBe('gold');
      expect(w.means).toBe(SELLER_SAYS_PAID);
    }
  });
  it('a buyer RECONCILED deal is paid, on PayPal’s statement', () => {
    expect(stateWord('RECONCILED', { side: 'buyer', kind: 'haggle' }).text).toBe('Paid, on statement');
  });
  it('a seller RECEIPTED deal still reads paid to you', () => {
    expect(stateWord('RECEIPTED', { side: 'seller', kind: 'haggle' }).text).toBe('Paid to you, receipt saved');
  });
  it('only a buyer haggle or shop order depends on the seller’s receipt', () => {
    expect(sellerSaysOnly({ state: 'RECEIPTED', side: 'buyer', kind: 'purchase' })).toBe(false);
    expect(sellerSaysOnly({ state: 'RECONCILED', side: 'buyer', kind: 'haggle' })).toBe(false);
    expect(sellerSaysOnly({ state: 'RECEIPTED', side: 'seller', kind: 'haggle' })).toBe(false);
  });
});

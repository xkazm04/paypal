import { describe, expect, it } from 'vitest';
import { receiptRefusedSentence, SELLER_SAYS_PAID, sellerSaysOnly, silenceWords, stateWord, unconfirmedSentence } from './words';

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

describe('the amount-mismatch words hold whenever the mismatch is found', () => {
  it('claim neither a pay button nor that PayPal was never asked', () => {
    const w = stateWord('MISMATCH', { side: 'buyer', kind: 'haggle' });
    expect(w.means).toMatch(/will not be paid/);
    expect(w.means).not.toMatch(/pay button|never asked/);
  });
});

describe('a deal PayPal never confirmed is an end, never paid', () => {
  it('UNCONFIRMED reads "Not confirmed by PayPal", not in the ok tone, and says nothing moved here', () => {
    for (const side of ['buyer', 'seller', undefined] as const) {
      const w = stateWord('UNCONFIRMED', { side, kind: 'haggle' });
      expect(w.text).toBe('Not confirmed by PayPal');
      expect(w.tone).toBe('coral');
      expect(w.means).toBe('The seller said it was paid, but PayPal’s statement never showed the payment. This wallet moved nothing.');
    }
  });
  it('the history and Rust’s silence sentence say the same in plain words', () => {
    expect(unconfirmedSentence('the dock')).toBe('The seller said the dock was paid, but PayPal’s statement never showed it, so it ends here. Your wallet moved no money.');
    expect(receiptRefusedSentence('the dock')).toBe('The seller said the dock was paid before you opened the PayPal link, so your wallet did not accept it. No money moved.');
    expect(silenceWords("PayPal reporting never showed the seller's payment; this wallet moved no money")).toBe('PayPal’s statement never showed it · this wallet moved nothing');
    expect(silenceWords('Seller attested payment; PayPal reporting is pending')).toBe('the seller says paid · not on PayPal’s statement yet');
  });
});

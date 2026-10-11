import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import type { H256 } from '@bindings/H256';
import { CHECK_FAILED, REACHED_PAYPAL, SUMMARY_CHANGED } from '../../lib/words';
import { failureShown, OFFER_NOT_HERE, outcomeText, reachedPaypal, refusalText, unconfirmedHeading } from './model';

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
    expect(t).toMatch(/^Paid \$329\.00 to Dan · /);
    expect(t).toContain('confirmed by PayPal');
    expect(t).not.toMatch(/collected/i);
  });
  it('a seller reads what was collected: the money arrived, it was not sent', () => {
    const t = outcomeText('deal_capture', deal({ side: 'seller' }), 'Dan');
    expect(t).toMatch(/^Collected \$329\.00 · /);
    expect(t).not.toMatch(/sent|Paid/);
    expect(t).toContain('paid to you');
    expect(t).toContain('confirmed by PayPal');
  });
  it('multiplies the quantity, and drops the PayPal suffix until PayPal answered', () => {
    const t = outcomeText('deal_capture', deal({ side: 'seller', terms: { ...deal().terms, qty: 2 }, paypal: { order: 'O', authorization: 'A', capture: null, subscription: null } }), 'Dan');
    expect(t).toMatch(/^Collected \$658\.00 · /);
    expect(t).not.toContain('confirmed by PayPal');
  });
});

describe('what the window says when a decision is refused', () => {
  const codes = ['LOCKED', 'PERMISSION', 'REFUSED', 'INVALID', 'NOT_FOUND', 'UNAVAILABLE', 'LEDGER_TRUST', 'UNSUPPORTED'] as const;
  const raw: Array<[string, string, string]> = [
    ['LOCKED', 'LOCKED', 'Windows Hello'],
    ['PERMISSION', 'permission denied', 'isn’t allowed'],
    ['INVALID', 'Invalid or stale wallet command', 'out of date'],
    ['UNSUPPORTED', 'OS authentication is unsupported on this platform', 'isn’t set up'],
    ['UNAVAILABLE', 'ipc failure', 'couldn’t be reached'],
    ['NOT_FOUND', 'no such deal', 'can’t find this deal'],
    ['LEDGER_TRUST', 'chain broken at 4', 'safety check'],
    ['REFUSED', 'policy: exceeds cap', 'refused this'],
  ];
  for (const [code, message, word] of raw) {
    it(`${code}: plain words, nothing moved, never the raw text`, () => {
      const t = refusalText({ code, message });
      expect(t).toContain(word);
      expect(t).toContain('nothing was done');
      expect(t).not.toContain(message === 'LOCKED' ? 'LOCKED' : message);
    });
  }
  it('INVALID: the offer that has not arrived keeps its own sentence', () => {
    expect(refusalText({ code: 'INVALID', message: OFFER_NOT_HERE })).toBe('Their latest offer hasn’t arrived yet, so nothing was done.');
  });
  it('the wallet’s two plain refusals pass through unchanged', () => {
    expect(refusalText({ code: 'INVALID', message: SUMMARY_CHANGED })).toBe(SUMMARY_CHANGED);
    expect(refusalText({ code: 'INVALID', message: CHECK_FAILED })).toBe(CHECK_FAILED);
  });
  it('every error code has an answer that says nothing moved', () => {
    for (const code of codes) expect(refusalText({ code, message: 'x' })).toMatch(/nothing was done/);
  });
});

describe('what the window says when a step reached PayPal and is not confirmed', () => {
  const codes = ['LOCKED', 'PERMISSION', 'REFUSED', 'INVALID', 'NOT_FOUND', 'UNAVAILABLE', 'LEDGER_TRUST', 'UNSUPPORTED'] as const;
  it('passes the wallet’s sentence through under every code, and never says nothing was done or try again', () => {
    for (const code of codes) {
      const t = refusalText({ code, message: REACHED_PAYPAL });
      expect(t).toBe(REACHED_PAYPAL);
      expect(t).not.toMatch(/nothing was done|try again|not paid/i);
    }
  });
  it('is the same bytes as the wallet’s sentence (service.rs REACHED_PAYPAL)', () => {
    expect(REACHED_PAYPAL).toBe('That reached PayPal, so the wallet won’t send it again. The deal shows where it stands.');
  });
  it('recognises it only by its exact text', () => {
    expect(reachedPaypal({ message: REACHED_PAYPAL })).toBe(true);
    expect(reachedPaypal({ message: 'ipc failure' })).toBe(false);
  });
  it('heads each decision with a heading true for it, never “Not paid”', () => {
    const heads = [
      unconfirmedHeading('deal_capture', { side: 'buyer', state: 'AUTHORIZED' }),
      unconfirmedHeading('deal_capture', { side: 'seller', state: 'AUTHORIZED' }),
      unconfirmedHeading('deal_countersign', { side: 'seller', state: 'AGREED' }),
      unconfirmedHeading('deal_countersign', { side: 'seller', state: 'APPROVED' }),
      unconfirmedHeading('rescue_approve', { side: 'seller', state: 'SETTLING' }),
    ];
    expect(heads).toEqual([
      'Payment not confirmed yet',
      'Collection not confirmed yet',
      'Order not confirmed yet',
      'Hold not confirmed yet',
      'Sending the fix isn’t confirmed yet',
    ]);
    for (const h of heads) expect(h).not.toMatch(/Not paid|nothing was done/i);
  });
  it('the notice shows while the deal is where the decision started, and goes once it moved', () => {
    const lost = { error: { message: REACHED_PAYPAL }, from: 'AUTHORIZED' };
    expect(failureShown(lost, 'AUTHORIZED')).toBe(true);
    expect(failureShown(lost, 'CAPTURED')).toBe(false);
    expect(failureShown(lost, 'RECEIPTED')).toBe(false);
    expect(failureShown({ error: { message: REACHED_PAYPAL }, from: 'APPROVED' }, 'AUTHORIZED')).toBe(false);
  });
  it('any other failure keeps showing', () => {
    expect(failureShown({ error: { message: 'x' }, from: null }, 'CAPTURED')).toBe(true);
  });
});

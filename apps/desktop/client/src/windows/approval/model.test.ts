import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import type { H256 } from '@bindings/H256';
import { CHECK_FAILED, REACHED_PAYPAL, STEP_NOT_CONFIRMED, SUMMARY_CHANGED, VOID_REACHED_PAYPAL } from '../../lib/words';
import { failureShown, footerNoticeText, OFFER_NOT_HERE, outcomeText, reachedPaypal, refusalText, unconfirmedHeading, UNLOCK_HEADING } from './model';

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
      for (const sentence of [REACHED_PAYPAL, VOID_REACHED_PAYPAL, STEP_NOT_CONFIRMED]) {
        const t = refusalText({ code, message: sentence });
        expect(t).toBe(sentence);
        expect(t).not.toMatch(/nothing was done|try again|not paid|that reached paypal/i);
      }
    }
  });
  it('is the same bytes as the wallet’s sentence (service.rs REACHED_PAYPAL)', () => {
    expect(REACHED_PAYPAL).toBe('That may have reached PayPal. The wallet won’t send it again on its own. Where PayPal’s answer is unclear, the wallet asks PayPal what happened.');
    expect(VOID_REACHED_PAYPAL).toBe('The release may have reached PayPal, and its outcome isn’t known yet. The wallet asks PayPal what happened, and asks again at the deadline.');
    expect(STEP_NOT_CONFIRMED).toBe('An earlier PayPal step on this deal isn’t confirmed yet, so this one wasn’t sent. The wallet asks PayPal what happened first.');
    for (const sentence of [REACHED_PAYPAL, VOID_REACHED_PAYPAL]) expect(sentence).not.toMatch(/the deal shows/i);
  });
  it('the void sentence makes no claim that the release will not be sent again', () => {
    expect(VOID_REACHED_PAYPAL).not.toMatch(/won’t send/);
  });
  it('recognises it only by its exact text', () => {
    expect(reachedPaypal({ message: REACHED_PAYPAL })).toBe(true);
    expect(reachedPaypal({ message: VOID_REACHED_PAYPAL })).toBe(true);
    expect(reachedPaypal({ message: STEP_NOT_CONFIRMED })).toBe(true);
    expect(reachedPaypal({ message: 'ipc failure' })).toBe(false);
  });
  it('heads each decision with a heading true for it, never “Not paid”', () => {
    const heads = [
      unconfirmedHeading('deal_capture', { side: 'buyer', state: 'AUTHORIZED' }),
      unconfirmedHeading('deal_capture', { side: 'seller', state: 'AUTHORIZED' }),
      unconfirmedHeading('deal_countersign', { side: 'seller', state: 'AGREED' }),
      unconfirmedHeading('deal_countersign', { side: 'seller', state: 'APPROVED' }),
      unconfirmedHeading('rescue_approve', { side: 'seller', state: 'SETTLING' }),
      unconfirmedHeading('deal_void', { side: 'seller', state: 'AUTHORIZED' }),
    ];
    expect(heads).toEqual([
      'Payment not confirmed yet',
      'Collection not confirmed yet',
      'Order not confirmed yet',
      'Hold not confirmed yet',
      'Sending the fix isn’t confirmed yet',
      'Release not confirmed yet',
    ]);
    for (const h of heads) expect(h).not.toMatch(/Not paid|nothing was done/i);
  });
  it('the second answer on capture, countersign and void is headed for the open step, not “Not paid”', () => {
    const error = { code: 'UNAVAILABLE', message: STEP_NOT_CONFIRMED };
    for (const [cmd, deal] of [
      ['deal_capture', { side: 'seller', state: 'AUTHORIZED' }],
      ['deal_countersign', { side: 'seller', state: 'APPROVED' }],
      ['deal_void', { side: 'seller', state: 'AUTHORIZED' }],
    ] as const) {
      const heading = unconfirmedHeading(cmd, deal, error);
      expect(heading).toBe('Not sent: an earlier step isn’t confirmed yet');
      expect(heading).not.toMatch(/Not paid|Not approved|Hold not released|Release not confirmed/i);
      const text = refusalText(error);
      expect(text).toBe(STEP_NOT_CONFIRMED);
      expect(text).not.toMatch(/nothing was done|try again/i);
    }
  });
  it('the notice shows while the deal is where the decision started, and goes once it moved', () => {
    const lost = { error: { message: REACHED_PAYPAL }, from: 'AUTHORIZED' };
    expect(failureShown(lost, 'AUTHORIZED')).toBe(true);
    expect(failureShown(lost, 'CAPTURED')).toBe(false);
    expect(failureShown(lost, 'RECEIPTED')).toBe(false);
    expect(failureShown({ error: { message: REACHED_PAYPAL }, from: 'APPROVED' }, 'AUTHORIZED')).toBe(false);
  });
  it('a void’s notice shows while the deal is still held, and goes once it reads VOIDED', () => {
    const lost = { error: { message: VOID_REACHED_PAYPAL }, from: 'AUTHORIZED' };
    expect(failureShown(lost, 'AUTHORIZED')).toBe(true);
    expect(failureShown(lost, 'VOIDED')).toBe(false);
  });
  it('any other failure keeps showing', () => {
    expect(failureShown({ error: { message: 'x' }, from: null }, 'CAPTURED')).toBe(true);
  });
});

describe('the footer notices say plain words, never the wallet’s own text', () => {
  const codes = ['LOCKED', 'PERMISSION', 'REFUSED', 'INVALID', 'NOT_FOUND', 'UNAVAILABLE', 'LEDGER_TRUST', 'UNSUPPORTED'] as const;
  const raw = ['Wallet actor stopped', 'permission denied', 'Invalid or stale wallet command', 'the approval capability is not available in this window'];
  for (const kind of ['read', 'token', 'unlock', 'pairing'] as const) {
    it(`${kind}: no code’s notice contains the wallet’s message`, () => {
      for (const code of codes) {
        const t = footerNoticeText(kind, { code });
        expect(t.length).toBeGreaterThan(20);
        for (const m of raw) expect(t.toLowerCase()).not.toContain(m.toLowerCase());
        expect(t).not.toMatch(/[A-Z]+_[A-Z_]+/);
      }
    });
  }
  it('the unlock heading names no cause: nothing tells a cancel apart from a failed scan', () => {
    expect(UNLOCK_HEADING).toBe('Still locked');
    expect(UNLOCK_HEADING).not.toMatch(/cancel/i);
    for (const code of codes) expect(footerNoticeText('unlock', { code })).not.toMatch(/cancel/i);
  });
  it('the lock card, the pairing unlock notice and the pairing refusal never carry the wallet’s message or the word cancel', () => {
    const walletText = 'Windows Hello did not verify the owner';
    const heading = `Still locked`;
    for (const code of codes) {
      for (const t of [footerNoticeText('unlock', { code }), footerNoticeText('pairing', { code })]) {
        expect(t).not.toContain(walletText);
        expect(t).not.toMatch(/cancel|did not verify/i);
      }
    }
    expect(heading).toBe(UNLOCK_HEADING);
    expect(footerNoticeText('pairing', { code: 'INVALID' })).toMatch(/nothing is connected/i);
  });
  it('a token failure says money stays where it is', () => {
    for (const code of ['UNAVAILABLE', 'PERMISSION', 'INVALID']) expect(footerNoticeText('token', { code })).toContain('Money stays where it is');
  });
});

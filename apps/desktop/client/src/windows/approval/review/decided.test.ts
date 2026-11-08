// What the window says about a decision comes from the wallet's record only: the recorded row
// (decided), the open money step (money_check) and the deal's state, read again after a failure.
import { describe, expect, it } from 'vitest';
import type { ApprovalCheck } from '@bindings/ApprovalCheck';
import type { ApprovalDecided } from '@bindings/ApprovalDecided';
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import type { MoneyCheck } from '@bindings/MoneyCheck';
import { derivePhase } from '../model';
import { shownTime } from '../../main/deal/shown';
import { afterFailure, compareLines, moneyOpenText } from './decided';

const HASH = Array.from({ length: 32 }, (_, i) => i) as ApprovalSummary['terms_hash'];
const OTHER = Array.from({ length: 32 }, () => 9) as ApprovalSummary['terms_hash'];
const line = (id: ApprovalCheck['id'], status: ApprovalCheck['status'], text = `${id} line`): ApprovalCheck => ({ id, status, text, detail: `${id} detail` });
const row = (at: number, operation: ApprovalDecided['operation'] = 'create', hash = HASH): ApprovalDecided => ({ decision: 'deal_countersign', operation, at, checks_hash: hash, same_now: true, signed: true, checks: [] });
const summary = (o: { state?: ApprovalSummary['deal']['state']; decided?: ApprovalDecided | null; check?: MoneyCheck | null; handed?: boolean } = {}): ApprovalSummary => ({
  deal: {
    id: 'D1', kind: 'purchase', side: 'buyer', counterparty: 'kp', mandate_id: 'M', mandate_version: 1, transcript_head: HASH, mode: 'sandbox', market: null, shield: 'CLEAR',
    terms: { item_ref: 'dock', qty: 1, unit_price: { minor: 6400, currency: 'USD' }, currency: 'USD', delivery: { type: 'digital_now' } },
    state: o.state ?? 'AGREED', paypal: { order: null, authorization: null, capture: null, subscription: null },
  },
  evidence: { deal_id: 'D1', receipt: 'NONE', reconciliation: 'not_applicable', money_check: o.check ?? null },
  attempt: 1, terms_hash: HASH, locked: false, can_release: true, can_open_paypal: false, unavailable_reason: null, checks: [], checks_hash: HASH,
  handed_off: o.handed ?? false, decided: o.decided ?? null,
} as unknown as ApprovalSummary);
const open: MoneyCheck = { step: 'create', state: 'checking', since: 1000, next_check: null };

describe('after a failed decision, the record read again says what happened', () => {
  it('no newer row: the call’s own refusal stands (today’s “Nothing was done”)', () => {
    expect(afterFailure(summary(), summary())).toBeNull();
    expect(afterFailure(summary({ decided: row(900) }), summary({ decided: row(900) }))).toBeNull();
  });
  it('a newer row with a step opened since: sent to PayPal, being checked', () => {
    expect(afterFailure(summary(), summary({ decided: row(1000), check: open }))).toBe('checking');
    expect(afterFailure(summary({ decided: row(900) }), summary({ decided: row(1000, 'authorize'), check: open }))).toBe('checking');
  });
  it('a newer row, nothing open, the deal where it was: recorded, nothing sent', () => {
    expect(afterFailure(summary({ decided: row(900) }), summary({ decided: row(1000, 'capture') }))).toBe('recorded');
    // The same second, another checklist: still a new row.
    expect(afterFailure(summary({ decided: row(1000) }), summary({ decided: row(1000, 'create', OTHER) }))).toBe('recorded');
    // A step that was already open before the click is not this decision's.
    expect(afterFailure(summary({ decided: row(900), check: open }), summary({ decided: row(1000), check: open }))).toBe('recorded');
  });
  it('a newer row and the deal moved on: recorded, and the window’s read says the rest', () => {
    expect(afterFailure(summary(), summary({ decided: row(1000), state: 'AWAITING_APPROVAL' }))).toBe('moved');
  });
  it('a read that failed too leaves the outcome unconfirmed, never “nothing was done”', () => {
    expect(afterFailure(summary(), null)).toBe('unconfirmed');
  });
});

describe('the recorded lines against the list now', () => {
  it('marks each line by id: same, now passes, now fails, changed, or gone', () => {
    const then = [line('amount', 'pass'), line('host', 'wait'), line('payee', 'pass'), line('invoice', 'wait'), line('shield', 'pass')];
    const now = [line('amount', 'pass'), line('host', 'pass'), line('payee', 'fail'), line('invoice', 'wait', 'other words')];
    expect(compareLines(then, now)).toEqual({ amount: 'same', host: 'passes', payee: 'fails', invoice: 'changed', shield: 'gone' });
  });
});

describe('an open money step in one plain line', () => {
  it('says the step, when it went, and what happens next, from the record’s fields', () => {
    const now = 1_793_000_000;
    expect(moneyOpenText({ step: 'authorize', state: 'checking', since: now, next_check: now + 60 }, now))
      .toBe(`The hold went to PayPal at ${shownTime(now, now)}, and its answer is being checked (next check ${shownTime(now + 60, now)}). Nothing more is sent until the wallet knows.`);
    expect(moneyOpenText({ step: 'capture', state: 'parked', since: now, next_check: null }, now))
      .toBe(`The payment went to PayPal at ${shownTime(now, now)}, and its answer couldn’t be confirmed. Nothing more is sent; at the deadline the wallet asks PayPal what happened.`);
  });
});

describe('the hand-off survives a reopen', () => {
  it('the wallet’s hand-off flag alone puts the window in the browser phase while approval waits', () => {
    const o = { locked: false, inBrowser: false, revealed: true };
    expect(derivePhase(summary({ state: 'AWAITING_APPROVAL', handed: true }), o)).toBe('in_browser');
    expect(derivePhase(summary({ state: 'AWAITING_APPROVAL', handed: false }), o)).toBe('ready');
    expect(derivePhase(summary({ state: 'APPROVED', handed: true }), o)).toBe('ready');
  });
});

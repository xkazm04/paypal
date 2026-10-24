// The "Who decides" row at the accept states the ask-me rule the way the wallet applies it: it asks
// only when the total is strictly above the limit (table-core mandate.rs, rule 6). An offer equal to
// the limit is not above it, and a limit the window can't compare is never read as "below".
import { describe, expect, it } from 'vitest';
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import type { Clause } from '@bindings/Clause';
import type { Currency } from '@bindings/Currency';
import type { H256 } from '@bindings/H256';
import type { OpenMandate } from '@bindings/OpenMandate';
import { buildDiff } from './diff';

const HASH = Array.from({ length: 32 }, (_, i) => i) as H256;
const NOW = 1_800_000_000;
const money = (dollars: number, currency: Currency = 'USD') => ({ minor: dollars * 100, currency });

function present(price: number, askAbove: { minor: number; currency: Currency }) {
  const clauses: Clause[] = [{ type: 'human_present_over', amount: askAbove }];
  const summary = {
    deal: {
      id: '01JDTESTDEAL0000000000000Q', kind: 'haggle', side: 'buyer', counterparty: 'kp_dan',
      terms: { item_ref: 'monitor', qty: 1, unit_price: money(price), currency: 'USD', delivery: { type: 'digital_now' } },
      state: 'NEGOTIATING', mandate_id: 'M14', mandate_version: 3, transcript_head: HASH,
      paypal: { order: null, authorization: null, capture: null, subscription: null }, mode: 'sandbox', market: null, shield: 'CLEAR',
    },
    evidence: { deal_id: 'x', receipt: 'NONE', reconciliation: 'not_applicable' }, attempt: 1, terms_hash: HASH, counter_hash: HASH,
    can_owner_accept: true, locked: false, can_release: false, can_open_paypal: false, unavailable_reason: null, checks: [], checks_hash: HASH,
  } as ApprovalSummary;
  const mandate = { payload: { id: 'M14', version: 3, clauses, not_before: NOW - 86400, expires: NOW + 86400 } } as unknown as OpenMandate;
  const diff = buildDiff({ summary, mandate, clauseNumber: null, counterparty: { name: 'Dan', known: true }, band: null, transcript: undefined, ownerAccept: true, now: NOW });
  return diff.rows.find((r) => r.id === 'present')!;
}

describe('Who decides: the ask-me rule as the wallet applies it', () => {
  it('above the limit the agent stopped and asked you', () => {
    expect(present(329, money(250))).toMatchObject({ right: '$329.00 is above that', rel: '>', word: 'asks you' });
  });
  it('exactly at the limit is not above it, and is never called below it', () => {
    const r = present(250, money(250));
    expect(r).toMatchObject({ right: '$250.00 isn’t above that', rel: '≤', word: 'your call' });
    expect(r.src).toMatch(/^Not above your ask-me limit/);
  });
  it('under the limit reads below it', () => {
    expect(present(200, money(250))).toMatchObject({ right: '$200.00 is below that', rel: '≤' });
  });
  it('a limit it can’t compare is said to be uncompared, never below', () => {
    const r = present(200, money(250, 'EUR'));
    expect(r).toMatchObject({ right: 'can’t be compared here', rel: '?' });
    expect(r.word).toBeUndefined();
    expect(`${r.right} ${r.src}`).not.toMatch(/below|Under/);
  });
});

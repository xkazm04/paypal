// The accept decision sets each rule beside the number the wallet checks it against: the price
// range against the price per item (table-core mandate.rs: "Band refers to the signed unit price,
// per-deal/velocity to the full total"). With more than one item, the total is never shown inside
// or above a per-item limit.
import { describe, expect, it } from 'vitest';
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import type { Clause } from '@bindings/Clause';
import type { Deal } from '@bindings/Deal';
import type { H256 } from '@bindings/H256';
import type { OpenMandate } from '@bindings/OpenMandate';
import { buildDiff, type DiffInput } from './diff';
import { summarySentence } from './says';
import { formatMoney } from '../../../lib/format';
import { dealTotal } from '../model';

const HASH = Array.from({ length: 32 }, (_, i) => i) as H256;
const NOW = 1_800_000_000;
const usd = (dollars: number) => ({ minor: dollars * 100, currency: 'USD' as const });

function summary(qty: number, each: number): ApprovalSummary {
  const deal: Deal = {
    id: '01JDTESTDEAL0000000000000Q', kind: 'haggle', side: 'buyer', counterparty: 'kp_dan',
    terms: { item_ref: 'monitor', qty, unit_price: usd(each), currency: 'USD', delivery: { type: 'digital_now' } },
    state: 'NEGOTIATING', mandate_id: 'M14', mandate_version: 3, transcript_head: HASH,
    paypal: { order: null, authorization: null, capture: null, subscription: null }, mode: 'sandbox', market: null, shield: 'CLEAR',
  };
  return {
    deal, evidence: { deal_id: deal.id, receipt: 'NONE', reconciliation: 'not_applicable' }, attempt: 1, terms_hash: HASH, counter_hash: HASH,
    can_owner_accept: true, locked: false, can_release: false, can_open_paypal: false, unavailable_reason: null, checks: [], checks_hash: HASH,
  };
}

const CLAUSES: Clause[] = [
  { type: 'per_deal', kind: 'haggle', max_amount: usd(800), categories: ['office'] },
  { type: 'band', item_refs: ['monitor'], floor: null, ceiling: usd(340), max_rounds: 6, deadline: NOW + 3600 },
  { type: 'human_present_over', amount: usd(250) },
];
const mandate = { payload: { id: 'M14', version: 3, clauses: CLAUSES, not_before: NOW - 86400, expires: NOW + 86400 } } as unknown as OpenMandate;

function input(s: ApprovalSummary): DiffInput {
  return {
    summary: s, mandate, clauseNumber: null, counterparty: { name: 'Dan', known: true }, band: null,
    transcript: undefined, ownerAccept: true, now: NOW,
  };
}

function sentence(s: ApprovalSummary): string {
  const diff = buildDiff(input(s));
  return summarySentence({ kind: diff.kind, phase: 'ready', deal: s.deal, summary: s, who: 'Dan', total: formatMoney(dealTotal(s.deal)), settle: null, twin: diff.twin, act: 'accept' }).text;
}

describe('the accept sets the price range beside the price per item', () => {
  it('two items at $300 each against a $340 range: the twin reads per item, never the $600 total', () => {
    const diff = buildDiff(input(summary(2, 300)));
    expect(diff.kind).toBe('accept');
    expect(diff.twin.left).toEqual({ k: 'Most you’ll pay per item', v: '$340.00' });
    expect(diff.twin.right).toEqual({ k: 'Dan asks per item', v: '$300.00' });
    expect(diff.twin.op).toBe('≥');
    const band = diff.rows.find((r) => r.id === 'band')!;
    expect(band).toMatchObject({ left: 'most you’ll pay $340.00 per item', right: '$300.00 each', rel: '≤' });
    expect(diff.rows.find((r) => r.id === 'offer')!.right).toBe('2 × $300.00 = $600.00 · their latest');
  });

  it('the sentence names the total and the price per item, and calls the limit a limit per item', () => {
    expect(sentence(summary(2, 300))).toBe('Dan offers $600.00 (2 × $300.00), inside your limit of $340.00 per item. Approving accepts that price; you pay later on PayPal.');
  });

  it('the ask-me line stays on the total: $600 is above $250 even though $300 each is inside the range', () => {
    const present = buildDiff(input(summary(2, 300))).rows.find((r) => r.id === 'present')!;
    expect(present).toMatchObject({ right: '$600.00 is above that', rel: '>' });
  });

  it('one item reads exactly as before: the price is the total', () => {
    const diff = buildDiff(input(summary(1, 329)));
    expect(diff.twin.left).toEqual({ k: 'Most you’ll pay', v: '$340.00' });
    expect(diff.twin.right).toEqual({ k: 'Dan asks', v: '$329.00' });
    expect(diff.rows.find((r) => r.id === 'band')).toMatchObject({ left: 'most you’ll pay $340.00', right: '$329.00' });
    expect(diff.rows.find((r) => r.id === 'offer')!.right).toBe('$329.00 · their latest');
    expect(sentence(summary(1, 329))).toBe('Dan offers $329.00, inside your $340.00 limit. Approving accepts that price; you pay later on PayPal.');
  });
});

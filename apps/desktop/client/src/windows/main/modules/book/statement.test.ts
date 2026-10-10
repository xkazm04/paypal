// DECISIONS 28: a deal that ended UNCONFIRMED keeps reconciliation pending_reporting, but the Book
// never calls it paid and never calls it a delay. Its statement words say how it ended, the way
// statementLabel words the deal page, and the PayPal agrees card lists it as an end.
import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import { unconfirmedMeans } from '../../../../lib/words';
import { STATEMENT_TIP, STATEMENT_WORD, statementEnded, statementWords, UNCONFIRMED_STATEMENT_WORD, type Statement } from './model';
import { agreeLine, agreeWhy, agreement, agreementGaps, GAP_WORD } from './where';

const H = Array.from({ length: 32 }, () => 0) as unknown as Deal['transcript_head'];
function deal(id: string, state: Deal['state']): Deal {
  return {
    id, kind: 'haggle', side: 'buyer', counterparty: 'kp', state, mode: 'sandbox', mandate_id: 'M', mandate_version: 1, transcript_head: H,
    terms: { item_ref: 'x', qty: 1, unit_price: { minor: 1000, currency: 'USD' }, currency: 'USD', delivery: { type: 'digital_now' } },
    paypal: { order: null, authorization: null, capture: null, subscription: null }, market: null, shield: null,
  };
}

describe('the Book’s statement words for a deal that ended UNCONFIRMED', () => {
  it('say how it ended, by whether a statement read happened, and never paid or a delay', () => {
    for (const read of [true, false, null] as const) {
      const w = statementWords('pending_reporting', 'UNCONFIRMED', read);
      expect(w.word).toBe(UNCONFIRMED_STATEMENT_WORD);
      expect(w.tip).toBe(unconfirmedMeans(read));
      expect(w.tip).not.toMatch(/^Paid|up to 3 hours|delay|not yet/i);
      expect(w.word).not.toMatch(/not yet|paid/i);
    }
    expect(statementWords('pending_reporting', 'UNCONFIRMED').tip).toBe(unconfirmedMeans(null));
  });

  it('leave every other deal and statement as they were', () => {
    expect(statementWords('pending_reporting', 'RECEIPTED')).toEqual({ word: STATEMENT_WORD.pending_reporting, tip: STATEMENT_TIP.pending_reporting });
    for (const s of ['matched', 'mismatch', 'not_applicable', 'unknown'] as const) {
      expect(statementWords(s, 'UNCONFIRMED')).toEqual({ word: STATEMENT_WORD[s], tip: STATEMENT_TIP[s] });
      expect(statementEnded(s, 'UNCONFIRMED')).toBe(false);
    }
    expect(statementEnded(null, 'UNCONFIRMED')).toBe(false);
    expect(statementEnded('pending_reporting', 'UNCONFIRMED')).toBe(true);
  });
});

describe('PayPal agrees, with a deal that ended UNCONFIRMED', () => {
  const rows = [deal('a', 'RECONCILED'), deal('b', 'RECEIPTED'), deal('c', 'UNCONFIRMED'), deal('d', 'RECEIPTED'), deal('e', 'RECEIPTED')];
  const table: Record<string, Statement> = { a: 'matched', b: 'pending_reporting', c: 'pending_reporting', d: 'mismatch', e: 'unknown' };
  const stmt = (d: Deal) => table[d.id] ?? null;

  it('counts it as an end, never as not there yet', () => {
    const a = agreement(rows, stmt);
    expect(a).toEqual({ needed: 5, matched: 1, notYet: 1, differs: 1, unknown: 1, unconfirmed: 1, loading: false });
    expect(agreeLine(a)).toBe('1 not there yet, 1 differs, 1 not confirmed by PayPal, 1 couldn’t be checked.');
    const [, two] = agreeWhy(a, null);
    expect(two).toContain('1 payment is waiting for the statement');
    expect(two).toContain('1 deal ended not confirmed by PayPal');
  });

  it('keeps it in the gaps, as an end after the differences and before every wait, with its own word', () => {
    const gaps = agreementGaps(rows, stmt);
    expect(gaps.map((g) => `${g.deal.id}:${g.statement}`)).toEqual(['d:mismatch', 'c:unconfirmed', 'e:unknown', 'b:pending_reporting']);
    expect(GAP_WORD.unconfirmed).toBe(UNCONFIRMED_STATEMENT_WORD);
    expect(GAP_WORD.pending_reporting).toBe(STATEMENT_WORD.pending_reporting);
  });
});

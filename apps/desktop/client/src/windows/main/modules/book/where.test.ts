import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import { LENSES, type Statement } from './model';
import {
  agreeFigure, agreeLine, agreementGaps, agreeWhy, agreement, chartSummary, flowOf, inProgressCount, QUESTION_WORDS, questionChips, rowSummary, sharePct, totalWhy, whereTheMoneyWent,
} from './where';

const H = Array.from({ length: 32 }, () => 0) as unknown as Deal['transcript_head'];
function deal(id: string, o: Partial<Deal> & { price?: number; cur?: Deal['terms']['currency'] } = {}): Deal {
  const cur = o.cur ?? 'USD';
  return {
    id, kind: 'purchase', side: 'buyer', counterparty: 'kp', state: 'CAPTURED', mode: 'sandbox', mandate_id: 'M', mandate_version: 1, transcript_head: H,
    terms: { item_ref: 'x', qty: 1, unit_price: { minor: o.price ?? 1000, currency: cur }, currency: cur, delivery: { type: 'ship_then_capture', days: 1 } },
    paypal: { order: null, authorization: null, capture: null, subscription: null }, market: null, shield: null, ...o,
  };
}

describe('where the money went', () => {
  it('splits each kind into paid, on hold and stopped, and leaves in-progress deals undrawn', () => {
    const [c] = whereTheMoneyWent([
      deal('a', { price: 100 }), deal('b', { price: 50, state: 'AUTHORIZED' }), deal('c', { price: 700, state: 'REFUSED' }), deal('d', { price: 9, state: 'NEGOTIATING' }),
    ]);
    expect(c?.rows).toHaveLength(1);
    expect(c?.rows[0]?.minor).toEqual({ paid: 100, held: 50, stopped: 700 });
    expect(c?.rows[0]?.n).toEqual({ paid: 1, held: 1, stopped: 1 });
    expect(c?.rows[0]?.open).toBe(1);
    expect(inProgressCount([c!])).toBe(1);
  });

  it('never adds currencies: one chart per currency, each with its own scale', () => {
    const charts = whereTheMoneyWent([deal('a', { price: 100 }), deal('b', { price: 5000, cur: 'EUR' }), deal('c', { price: 300, cur: 'EUR', state: 'VOIDED' })]);
    expect(charts.map((c) => c.currency)).toEqual(['EUR', 'USD']);
    expect(charts[0]?.rows[0]?.minor).toEqual({ paid: 5000, held: 0, stopped: 300 });
    expect(charts[0]?.max).toBe(5300);
    expect(charts[1]?.max).toBe(100);
  });

  it('keeps money out and money in of the same kind on separate rows, in the kind order', () => {
    const [c] = whereTheMoneyWent([
      deal('r', { kind: 'rescue', side: 'seller', price: 960 }), deal('s', { kind: 'shop_order', side: 'seller', price: 90 }), deal('p', { price: 10 }),
      deal('h', { kind: 'haggle', price: 5 }), deal('h2', { kind: 'haggle', side: 'seller', price: 6 }),
    ]);
    expect(c?.rows.map((r) => `${r.kind}:${r.dir}`)).toEqual(['haggle:out', 'haggle:in', 'purchase:out', 'shop_order:in', 'rescue:in']);
  });

  it('stopped is never counted as moved: it has its own figure and a refused deal adds nothing to paid', () => {
    const [c] = whereTheMoneyWent([deal('a', { state: 'REFUSED', price: 11960 }), deal('b', { state: 'WITHDRAWN', price: 455 }), deal('c', { state: 'MISMATCH', price: 329 })]);
    expect(c?.rows[0]?.minor.paid).toBe(0);
    expect(c?.rows[0]?.minor.held).toBe(0);
    expect(c?.rows[0]?.minor.stopped).toBe(11960 + 455 + 329);
    expect(rowSummary(c!.rows[0]!)).toContain('never counted as moved');
    expect(rowSummary(c!.rows[0]!)).not.toContain('paid');
  });

  it('a replay is not recovered money: a paid rescue replay is noted, not counted as paid', () => {
    expect(flowOf(deal('a', { kind: 'rescue', side: 'seller', mode: 'replay' }))).toBeNull();
    expect(flowOf(deal('b', { kind: 'rescue', side: 'seller', mode: 'sandbox' }))).toBe('paid');
    const [c] = whereTheMoneyWent([deal('a', { kind: 'rescue', side: 'seller', price: 960, mode: 'replay' }), deal('b', { kind: 'rescue', side: 'seller', price: 900 })]);
    const r = c?.rows.find((x) => x.kind === 'rescue');
    expect(r?.minor.paid).toBe(900);
    expect(r?.replays).toBe(1);
  });

  it('folds a rescue invoice into rescues and scales bars against the longest', () => {
    const [c] = whereTheMoneyWent([deal('a', { kind: 'invoice', side: 'seller', price: 400 }), deal('b', { price: 1000 })]);
    expect(c?.rows.map((r) => r.kind)).toEqual(['purchase', 'rescue']);
    expect(sharePct(400, c!.max)).toBe(40);
    expect(sharePct(5, 0)).toBe(0);
  });

  it('summarises a chart in words for screen readers', () => {
    const [c] = whereTheMoneyWent([deal('a', { price: 1234 })]);
    expect(chartSummary(c!)).toBe('Where the money went, in USD. Purchases, money out, USD: $12.34 paid.');
  });

  it('draws nothing for an empty week', () => {
    expect(whereTheMoneyWent([])).toEqual([]);
  });
});

describe('PayPal agrees', () => {
  const rows = [deal('a'), deal('b'), deal('c'), deal('d'), deal('e'), deal('f', { state: 'NEGOTIATING' })];
  const table: Record<string, Statement | null> = { a: 'matched', b: 'matched', c: 'pending_reporting', d: 'mismatch', e: 'unknown', f: 'not_applicable' };
  it('counts payments that needed a statement and never counts unknown as matched', () => {
    const a = agreement(rows, (d) => table[d.id] ?? null);
    expect(a).toEqual({ needed: 5, matched: 2, notYet: 1, differs: 1, unknown: 1, unconfirmed: 0, loading: false });
    expect(agreeFigure(a)).toBe('2 of 5');
    expect(agreeLine(a)).toBe('1 not there yet, 1 differs, 1 couldn’t be checked.');
  });
  it('flags a statement that is still being read and leaves those deals out', () => {
    const a = agreement(rows, (d) => (d.id === 'a' ? null : table[d.id] ?? null));
    expect(a.loading).toBe(true);
    expect(a.needed).toBe(4);
  });
  it('lists the exceptions behind the meter, differences first, and never a matched or no-payment deal', () => {
    const gaps = agreementGaps(rows, (d) => table[d.id] ?? null);
    expect(gaps.map((g) => `${g.deal.id}:${g.statement}`)).toEqual(['d:mismatch', 'e:unknown', 'c:pending_reporting']);
  });
  it('says everything matched only when nothing is missing', () => {
    expect(agreeLine(agreement([deal('a')], () => 'matched'))).toBe('Every one is on the statement. Nothing differs.');
    expect(agreeLine(agreement([deal('a')], () => 'unknown'))).not.toContain('Every one');
    expect(agreeLine(agreement([], () => 'matched'))).toContain('No payment');
  });
  it('explains the up-to-3-hours lag and the current counts, with the last check when known', () => {
    const a = agreement(rows, (d) => table[d.id] ?? null);
    const [one, two] = agreeWhy(a, '14:05');
    expect(one).toContain('up to 3 hours');
    expect(two).toContain('1 payment is waiting for the statement');
    expect(two).toContain('not counted as matched');
    expect(two).toContain('Last checked 14:05.');
    expect(agreeWhy({ needed: 2, matched: 2, notYet: 0, differs: 0, unknown: 0, unconfirmed: 0, loading: false }, null)[1]).toBe('Right now 2 of 2 are on it and nothing differs.');
  });
});

describe('why on each total', () => {
  const ds = [
    deal('a', { price: 21200 }), deal('b', { price: 6400, state: 'AUTHORIZED' }), deal('c', { price: 1196000, state: 'REFUSED' }), deal('d', { price: 4200, state: 'VOIDED' }),
    deal('e', { price: 1850, side: 'seller', kind: 'shop_order' }),
  ];
  it('writes two deterministic sentences per total from the deals', () => {
    for (const k of ['out', 'in', 'held', 'stopped'] as const) {
      const w = totalWhy(k, ds);
      expect(w).toHaveLength(2);
      expect(w.every((s) => s.length > 20 && s.endsWith('.'))).toBe(true);
      expect(totalWhy(k, ds)).toEqual(w);
    }
    expect(totalWhy('out', ds)[0]).toBe('1 payment you made is complete: 1 purchase ($212.00).');
    expect(totalWhy('in', ds)[0]).toContain('$18.50');
    expect(totalWhy('held', ds)[0]).toContain('$64.00');
  });
  it('explains why stopped money is struck through and never counted, with what stopped it', () => {
    const [one, two] = totalWhy('stopped', ds);
    expect(one).toContain('struck through');
    expect(one).toContain('never counted as paid');
    expect(two).toContain('1 refused');
    expect(two.toLowerCase()).toContain('hold released');
  });
  it('keeps each currency on its own in the sentence', () => {
    expect(totalWhy('out', [deal('a', { price: 100 }), deal('b', { price: 200, cur: 'EUR' })])[0]).toContain('$1.00 · €2.00');
  });
  it('says so when a total is empty instead of showing zero money', () => {
    expect(totalWhy('held', [])[0]).toContain('not holding');
    expect(totalWhy('stopped', [])[0]).toContain('Nothing was stopped');
  });
});

describe('question chips', () => {
  it('maps one plain question to every quick view, 1:1, in order', () => {
    const chips = questionChips();
    expect(chips.map((c) => c.id)).toEqual(LENSES.map((l) => l.id));
    expect(Object.keys(QUESTION_WORDS).sort()).toEqual(LENSES.map((l) => l.id).sort());
    expect(new Set(chips.map((c) => c.text)).size).toBe(chips.length);
    expect(chips.find((c) => c.id === 'pending')?.text).toBe('Did PayPal record everything?');
    expect(chips.find((c) => c.id === 'pending')?.view).toBe('Does PayPal agree yet?');
  });
  it('speaks plain words: no jargon', () => {
    for (const c of questionChips()) expect(c.text).not.toMatch(/reconcil|mandate|clause|query|capture|void|P3|_/i);
  });
});

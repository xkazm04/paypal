// The wallet's answer keeps money out and money in on separate lines, as the window's pivot does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deal } from '@bindings/Deal';
import type { JsonValue } from '@bindings/serde_json/JsonValue';
import { mockBackend, resetMockState } from '../../../../mock/backend';
import { dirOf, outsideGrid, runQuery, stateKey, type Ctx } from './model';
import { understand, type AskCtx, type Understanding, type Understood } from './understand';

// Wednesday 7 Oct 2026, 15:30 in a UTC+2 calendar.
const NOW = Date.UTC(2026, 9, 7, 13, 30) / 1000;
const CTX: AskCtx = { now: NOW, offsetMin: 120, parties: [] };
const H = Array.from({ length: 32 }, () => 0) as unknown as Deal['transcript_head'];
const IN_WEEK = Date.UTC(2026, 9, 6, 10) / 1000;
function deal(id: string, side: Deal['side'], state: Deal['state'], price: number): Deal {
  return {
    id, kind: 'purchase', side, counterparty: 'kp', state, mode: 'sandbox', mandate_id: 'M', mandate_version: 1, transcript_head: H, created_at: IN_WEEK,
    terms: { item_ref: 'x', qty: 1, unit_price: { minor: price, currency: 'USD' }, currency: 'USD', delivery: { type: 'ship_then_capture', days: 1 } },
    paypal: { order: null, authorization: null, capture: null, subscription: null }, market: null, shield: null,
  };
}
const ctx: Ctx = { stmt: () => 'not_applicable', cpName: (d) => d.counterparty };
const ok = (u: Understanding): Understood => {
  if ('unsure' in u) throw new Error('unsure');
  return u;
};

describe('a paid-only question keeps money out and money in apart', () => {
  // Mirrors the Rust test a_paid_question_answers_money_out_and_money_in_on_separate_lines in
  // crates/table-ledger/src/book.rs: same sides, states and amounts, same numbers.
  const fixture = [
    deal('out_a', 'buyer', 'CAPTURED', 1000), deal('out_b', 'buyer', 'RECONCILED', 500),
    deal('in_a', 'seller', 'CAPTURED', 700), deal('in_b', 'seller', 'RECEIPTED', 300),
    deal('stopped', 'buyer', 'VOIDED', 900),
  ];
  it('the window sums out 2 / 1500 and in 2 / 1000, and the stopped deal is in neither', () => {
    const { query } = ok(understand('how much was paid this week', CTX));
    const r = runQuery(query, fixture, ctx);
    expect(r.rows.map((d) => d.id)).toEqual(['out_a', 'out_b', 'in_a', 'in_b']);
    expect(r.all.sums.captured.out).toEqual([{ currency: 'USD', minor: 1500 }]);
    expect(r.all.sums.captured.in).toEqual([{ currency: 'USD', minor: 1000 }]);
    expect(r.rows.filter((d) => dirOf(d) === 'out')).toHaveLength(2);
    expect(r.rows.filter((d) => dirOf(d) === 'in')).toHaveLength(2);
  });
});

describe('the mock book_query answers a direction line like Rust', () => {
  class LocalChannel {
    addEventListener() {}
    postMessage() {}
  }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW * 1000);
    vi.stubGlobal('BroadcastChannel', LocalChannel);
    localStorage.clear(); sessionStorage.clear(); resetMockState();
    history.replaceState(null, '', '/index.html');
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('splits a paid-only question by direction, with the numbers the deals on record give', async () => {
    const main = mockBackend('main');
    const { query } = ok(understand('how much was paid', CTX));
    const a = await main.invoke('book_query', { query: query as unknown as JsonValue });
    const rows = a.rows as Array<Record<string, JsonValue>>;
    const deals = (await main.invoke('list_deals', null)) as Deal[];
    const paid = deals.filter((d) => ['CAPTURED', 'RECEIPTED', 'RECONCILED'].includes(stateKey(d)));
    const expected = new Map<string, [number, number]>();
    for (const d of paid) {
      const k = `${d.terms.currency}|${d.mode}|${dirOf(d)}`;
      const [n, sum] = expected.get(k) ?? [0, 0];
      expected.set(k, [n + 1, sum + d.terms.unit_price.minor * d.terms.qty]);
    }
    expect(new Map(rows.map((r) => [`${r.currency}|${r.mode}|${r.direction}`, [r.count, r.sum_amount]]))).toEqual(expected);
  });
});

describe('deals the answer reaches but the grid does not show', () => {
  it('counts the answer’s deals missing from the grid', () => {
    const grid = [deal('a', 'buyer', 'CAPTURED', 1), deal('b', 'buyer', 'CAPTURED', 1)];
    const answer = [...grid, deal('old', 'buyer', 'CAPTURED', 1)];
    expect(outsideGrid(answer, grid)).toBe(1);
    expect(outsideGrid(grid, grid)).toBe(0);
    expect(outsideGrid([], grid)).toBe(0);
  });
});

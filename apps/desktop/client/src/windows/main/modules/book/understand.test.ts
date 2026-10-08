// The wallet's own reading of typed Book questions: phrasing -> closed BookQuery, every result
// passing the ported Rust shape rules and answered by the mock book_query; anything it cannot read
// is "unsure" with the words, never a guess; counterparty names only from the known list.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookQuery } from '@bindings/BookQuery';
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import type { JsonValue } from '@bindings/serde_json/JsonValue';
import { mockBackend, resetMockState } from '../../../../mock/backend';
import { bookRejection } from './rules';
import {
  compose, groupChip, isUnsure, knownParties, lensQuery, MAX_ASK, replaceChip, SUGGESTIONS, understand, whenChip, type AskCtx, type Understanding, type Understood, type Unsure,
} from './understand';

// Wednesday 7 Oct 2026, 15:30 in a UTC+2 calendar.
const NOW = Date.UTC(2026, 9, 7, 13, 30) / 1000;
const cp = (key_id: string, display_name: string, extra: Partial<CounterpartyDisplay> = {}): CounterpartyDisplay =>
  ({ key_id, display_name, house: false, first_seen: 0, deals_closed: 0, pairing: 'words_confirmed', declared_payee: null, ...extra });
const LIST: CounterpartyDisplay[] = [
  cp('kp_dan', 'Dan · north-desk', { declared_payee: 'north-desk' }),
  cp('kp_cable', 'cablehaus', { declared_payee: 'cablehaus' }),
  cp('kp_house', 'HOUSE seller', { house: true, pairing: 'house_pinned', declared_payee: 'HOUSE' }),
  cp('kp_lark', 'lark’s agent', { declared_payee: 'lark-pay' }),
  cp('kp_pack', 'packrite-supply', { declared_payee: 'packrite-supply' }),
  // Never a name to match: not connected, or made only of words the wallet already reads.
  cp('kp_ghost', 'Ghost shop', { pairing: 'unpaired' }),
  cp('kp_evil1', 'this week'),
  cp('kp_evil2', 'spent'),
  cp('kp_evil3', 'the'),
];
const CTX: AskCtx = { now: NOW, offsetMin: 120, parties: knownParties(LIST) };

const PAID = ['CAPTURED', 'RECEIPTED', 'RECONCILED'];
const STOPPED = ['REFUSED', 'VOIDED', 'AUTO_VOIDED', 'WITHDRAWN', 'EXPIRED', 'MISMATCH'];
const MOVING = ['PAIRING', 'LISTED', 'NEGOTIATING', 'AGREED', 'SETTLING', 'AWAITING_APPROVAL', 'APPROVED'];

const R = {
  any: null,
  today: { from: '2026-10-06T22:00:00Z', to: '2026-10-07T22:00:00Z' },
  yesterday: { from: '2026-10-05T22:00:00Z', to: '2026-10-06T22:00:00Z' },
  thisWeek: { from: '2026-10-04T22:00:00Z', to: '2026-10-11T22:00:00Z' },
  lastWeek: { from: '2026-09-27T22:00:00Z', to: '2026-10-04T22:00:00Z' },
  thisMonth: { from: '2026-09-30T22:00:00Z', to: '2026-10-31T22:00:00Z' },
  lastMonth: { from: '2026-08-31T22:00:00Z', to: '2026-09-30T22:00:00Z' },
  thisYear: { from: '2025-12-31T22:00:00Z', to: '2026-12-31T22:00:00Z' },
  days7: { from: '2026-09-30T22:00:00Z', to: '2026-10-07T22:00:00Z' },
  days14: { from: '2026-09-23T22:00:00Z', to: '2026-10-07T22:00:00Z' },
  days30: { from: '2026-09-07T22:00:00Z', to: '2026-10-07T22:00:00Z' },
  sinceMonday: { from: '2026-10-04T22:00:00Z', to: '2026-10-07T22:00:00Z' },
  sinceFriday: { from: '2026-10-01T22:00:00Z', to: '2026-10-07T22:00:00Z' },
  onTuesday: { from: '2026-10-05T22:00:00Z', to: '2026-10-06T22:00:00Z' },
  september: { from: '2026-08-31T22:00:00Z', to: '2026-09-30T22:00:00Z' },
} as const;

type F = BookQuery['filters'][number];
const kind = (...v: string[]): F => (v.length === 1 ? { field: 'kind', op: 'eq', value: v[0]! } : { field: 'kind', op: 'in', value: v });
const state = (...v: string[]): F => (v.length === 1 ? { field: 'state', op: 'eq', value: v[0]! } : { field: 'state', op: 'in', value: v });
const who = (...v: string[]): F => (v.length === 1 ? { field: 'counterparty', op: 'eq', value: v[0]! } : { field: 'counterparty', op: 'in', value: v });
const DEF: BookQuery['metrics'] = ['count', 'sum_amount'];
function Q(p: Partial<BookQuery>): BookQuery {
  return { view: 'deals', metrics: DEF, filters: [], group_by: [], range: null, limit: null, ...p };
}

const TABLE: Array<[string, BookQuery]> = [
  ['How much did I spend this week?', Q({ filters: [state(...PAID)], range: R.thisWeek })],
  ['What came in today?', Q({ filters: [state(...PAID)], range: R.today })],
  ['What did I receive yesterday?', Q({ filters: [state(...PAID)], range: R.yesterday })],
  ['How much was paid this week, by shop?', Q({ filters: [state(...PAID)], group_by: ['counterparty'], range: R.thisWeek })],
  ['What is on hold right now?', Q({ filters: [state('AUTHORIZED')] })],
  ['How many deals were stopped last week?', Q({ metrics: ['count'], filters: [state(...STOPPED)], range: R.lastWeek })],
  ['What was refused this month?', Q({ filters: [state('REFUSED')], range: R.thisMonth })],
  ['Anything refunded last month?', Q({ filters: [state('REFUNDED')], range: R.lastMonth })],
  ['How much did rescues bring back this month?', Q({ metrics: ['count', 'recovered_sum'], filters: [kind('rescue')], range: R.thisMonth })],
  ['Number of payments in the last 7 days', Q({ metrics: ['count'], range: R.days7 })],
  ['How many haggles in the past 30 days?', Q({ metrics: ['count'], filters: [kind('haggle')], range: R.days30 })],
  ['Average price vs market for purchases this week', Q({ metrics: ['count', 'avg_vs_market_pct'], filters: [kind('purchase')], range: R.thisWeek })],
  ['Paid out by day this week', Q({ filters: [state(...PAID)], group_by: ['day'], range: R.thisWeek })],
  ['Spending by who decided', Q({ filters: [state(...PAID)], group_by: ['decided_by'] })],
  ['My rules vs me', Q({ group_by: ['decided_by'] })],
  ['Shop orders by status since Monday', Q({ filters: [kind('shop_order')], group_by: ['state'], range: R.sinceMonday })],
  ['What did my agents buy in September?', Q({ filters: [kind('purchase')], range: R.september })],
  ['Haggles and purchases on hold', Q({ filters: [kind('haggle', 'purchase'), state('AUTHORIZED')] })],
  ['How much did I pay cablehaus this year?', Q({ filters: [state(...PAID), who('kp_cable')], range: R.thisYear })],
  ['How much went to Dan last week?', Q({ filters: [who('kp_dan')], range: R.lastWeek })],
  ['Deals with north-desk by day', Q({ filters: [who('kp_dan')], group_by: ['day'] })],
  ['House seller haggles today', Q({ filters: [kind('haggle'), who('kp_house')], range: R.today })],
  ['lark’s orders by status', Q({ filters: [kind('shop_order'), who('kp_lark')], group_by: ['state'] })],
  ['Stopped or refused, by status, yesterday', Q({ filters: [state(...STOPPED)], group_by: ['state'], range: R.yesterday })],
  ['In progress deals by kind', Q({ filters: [state(...MOVING)], group_by: ['kind'] })],
  ['Which payments failed this week', Q({ filters: [state('FAILED')], range: R.thisWeek })],
  ['Disputed payments', Q({ filters: [state('DISPUTED')] })],
  ['Amounts that didn’t match', Q({ filters: [state('MISMATCH')] })],
  ['Is everything on my PayPal statement?', Q({ view: 'reconciliation' })],
  ['How many invoices this month by who', Q({ metrics: ['count'], filters: [kind('invoice')], group_by: ['counterparty'], range: R.thisMonth })],
  ['Total spent per day by shop last week', Q({ filters: [state(...PAID)], group_by: ['day', 'counterparty'], range: R.lastWeek })],
  ['How many and how much, by agent, today', Q({ metrics: ['count', 'sum_amount'], group_by: ['kind'], range: R.today })],
  ['Money on hold by payee', Q({ filters: [state('AUTHORIZED')], group_by: ['counterparty'] })],
  ['What was cancelled on Tuesday?', Q({ filters: [state(...STOPPED)], range: R.onTuesday })],
  ['Recovered money by day this month', Q({ metrics: ['count', 'recovered_sum'], filters: [kind('rescue')], group_by: ['day'], range: R.thisMonth })],
  ['Everything ever', Q({})],
  ['Purchases compared with the market last week', Q({ metrics: ['count', 'avg_vs_market_pct'], filters: [kind('purchase')], range: R.lastWeek })],
  ['Show me rescues that failed', Q({ filters: [kind('rescue'), state('FAILED')] })],
  ['How much was received from shop orders this week by day', Q({ filters: [kind('shop_order'), state(...PAID)], group_by: ['day'], range: R.thisWeek })],
  ['Earnings in October', Q({ filters: [state(...PAID)], range: R.thisMonth })],
  ['How much did I spend on haggles yesterday, by status?', Q({ filters: [kind('haggle'), state(...PAID)], group_by: ['state'], range: R.yesterday })],
  ['Payouts last fortnight', Q({ filters: [state(...PAID)], range: R.days14 })],
  ['Count of rescues since Friday', Q({ metrics: ['count'], filters: [kind('rescue')], range: R.sinceFriday })],
  ['packrite-supply purchases by day', Q({ filters: [kind('purchase'), who('kp_pack')], group_by: ['day'] })],
  ['Who did I pay last month?', Q({ filters: [state(...PAID)], group_by: ['counterparty'], range: R.lastMonth })],
  ['What did my rules decide on their own this week?', Q({ group_by: ['decided_by'], range: R.thisWeek })],
  ['How much did I spend this week, by day and by shop', Q({ filters: [state(...PAID)], group_by: ['day', 'counterparty'], range: R.thisWeek })],
];

const ok = (u: Understanding): Understood => {
  if (isUnsure(u)) throw new Error(`unsure: ${u.why} ${u.unsure.join(', ')}`);
  return u;
};
const unsure = (u: Understanding): Unsure => {
  if (!isUnsure(u)) throw new Error(`read as ${JSON.stringify(u.query)}`);
  return u;
};

describe('understand: phrasing -> closed BookQuery', () => {
  it('has a table of 40+ phrasings', () => expect(TABLE.length).toBeGreaterThanOrEqual(40));

  it.each(TABLE)('“%s”', (text, expected) => {
    const u = ok(understand(text, CTX));
    expect(u.query).toEqual(expected);
    expect(bookRejection(u.query)).toBeNull();
    // Every chip is one piece of the reading; the time is always shown, even when it is any time.
    expect(u.reading.filter((c) => c.slot === 'when')).toHaveLength(1);
  });

  it('is deterministic: the same words, the same query', () => {
    for (const [text] of TABLE) expect(understand(text, CTX)).toEqual(understand(text, CTX));
  });

  it('reads the brief’s example as Paid · This week · By shop or customer, in that order', () => {
    const u = ok(understand('Paid out this week by shop', CTX));
    expect(u.reading.map((c) => c.text)).toEqual(['Paid', 'This week', 'By shop or customer']);
    expect(u.reading.find((c) => c.slot === 'when')?.title).toBe('Mon 5 Oct to Sun 11 Oct');
  });

  it('every suggested phrasing reads', () => {
    expect(SUGGESTIONS.length).toBeGreaterThanOrEqual(2);
    expect(SUGGESTIONS.length).toBeLessThanOrEqual(3);
    for (const s of SUGGESTIONS) expect(bookRejection(ok(understand(s, CTX)).query)).toBeNull();
  });
});

describe('understand: unsure, never a guess', () => {
  it('names the words it did not get', () => {
    expect(unsure(understand('How much did I spend by item?', CTX))).toEqual({ unsure: ['by item'], why: 'words' });
    expect(unsure(understand('Payments over $100', CTX))).toEqual({ unsure: ['over', '$100'], why: 'words' });
    expect(unsure(understand('Hello', CTX))).toEqual({ unsure: ['Hello'], why: 'words' });
    expect(unsure(understand('weekly totals', CTX)).unsure).toEqual(['weekly']);
    expect(unsure(understand('sales by hour', CTX)).unsure).toEqual(['sales', 'by hour']);
  });

  it('a counterparty that is not on the list is an unknown word, never a filter', () => {
    expect(unsure(understand('Paid to bob last week', CTX)).unsure).toEqual(['bob']);
    // Not connected: its stored name is never matched.
    expect(unsure(understand('Ghost shop haggles', CTX)).unsure).toEqual(['Ghost', 'shop']);
    // A name made only of words the wallet reads is never a counterparty.
    const u = ok(understand('spent this week', CTX));
    expect(u.query.filters).toEqual([state(...PAID)]);
    expect(u.reading.some((c) => c.slot === 'who')).toBe(false);
    expect(ok(understand('the haggles', CTX)).query.filters).toEqual([kind('haggle')]);
  });

  it('two times or three groupings are unsure, with the pieces named', () => {
    expect(unsure(understand('today and last week', CTX))).toEqual({ unsure: ['Today', 'Last week'], why: 'two_times' });
    expect(unsure(understand('by day, by shop and by status', CTX)).why).toBe('too_many_groups');
  });

  it('empty or only filler words reads nothing', () => {
    expect(unsure(understand('   ', CTX)).why).toBe('empty');
    expect(unsure(understand('what is the', CTX)).why).toBe('nothing');
  });

  it(`caps a question at ${MAX_ASK} characters`, () => {
    const at = `today${' the'.repeat(48)}`.padEnd(MAX_ASK, ' ');
    expect(at.length).toBe(MAX_ASK);
    expect(ok(understand(at, CTX)).query.range).toEqual(R.today);
    expect(unsure(understand(`${at}x`, CTX))).toEqual({ unsure: [], why: 'too_long' });
    expect(unsure(understand('a'.repeat(5000), CTX)).why).toBe('too_long');
  });
});

describe('chips: remove or change a piece, the query follows', () => {
  it('removing a chip removes exactly its part', () => {
    const u = ok(understand('How much did I pay cablehaus this week by day', CTX));
    const noCp = ok(compose(replaceChip(u.reading, 'p:kp_cable', null), CTX));
    expect(noCp.query.filters).toEqual([state(...PAID)]);
    const noDay = ok(compose(replaceChip(u.reading, 'g:day', null), CTX));
    expect(noDay.query.group_by).toEqual([]);
    const noTime = ok(compose(replaceChip(u.reading, 't:this_week', null), CTX));
    expect(noTime.query.range).toBeNull();
  });

  it('changing the time or the grouping swaps the chip in place', () => {
    const u = ok(understand('Paid out this week by shop', CTX));
    const lastMonth = ok(compose(replaceChip(u.reading, 't:this_week', whenChip({ k: 'last_month' }, CTX)), CTX));
    expect(lastMonth.query.range).toEqual(R.lastMonth);
    expect(lastMonth.reading.map((c) => c.text)).toEqual(['Paid', 'Last month', 'By shop or customer']);
    const byDay = ok(compose(replaceChip(u.reading, 'g:counterparty', groupChip('day')), CTX));
    expect(byDay.query.group_by).toEqual(['day']);
  });

  it('the lens shape keeps the same filters and range for lighting the rows', () => {
    const u = ok(understand('haggles on hold this week by shop', CTX));
    expect(lensQuery(u.query)).toEqual({ view: 'deals', filters: [kind('haggle'), state('AUTHORIZED')], group_by: ['counterparty'], metrics: DEF, range: R.thisWeek });
  });
});

describe('ported rules match Rust’s words', () => {
  it('rejects what BookQuery::rejection and compile reject', () => {
    expect(bookRejection(Q({ metrics: [] }))).toBe('metrics: 1 to 4 required');
    expect(bookRejection(Q({ group_by: ['kind', 'kind'] }))).toBe('group_by: each at most once');
    expect(bookRejection(Q({ group_by: ['kind', 'day', 'state'] }))).toBe('group_by: at most 2');
    expect(bookRejection(Q({ view: 'paypal_calls', metrics: ['recovered_sum'] }))).toBe('recovered_sum is not defined on the paypal_calls view');
    expect(bookRejection(Q({ range: { from: '2026-10-07T00:00:00Z', to: '2026-10-06T00:00:00Z' } }))).toBe('range: from must be before to');
    expect(bookRejection(Q({ range: { from: 'yesterday', to: '2026-10-06T00:00:00Z' } }))).toBe('range: from and to must be RFC 3339 times');
    expect(bookRejection(Q({ filters: [{ field: 'amount', op: 'eq', value: '1.00' }] }))).toBe('filters: amount, created_at and vs_market_pct take integers');
    expect(bookRejection(Q({ limit: 501 }))).toBe('limit: 1 to 500');
  });
});

describe('the mock book_query answers every reading', () => {
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

  it('answers each phrasing in the table, read-only, rows per currency and mode', async () => {
    const main = mockBackend('main');
    for (const [text] of TABLE) {
      const { query } = ok(understand(text, CTX));
      const a = await main.invoke('book_query', { query: query as unknown as JsonValue });
      expect(a.query).toEqual(query);
      for (const r of a.rows as Array<Record<string, JsonValue>>) {
        expect(typeof r.currency).toBe('string');
        expect(typeof r.count).toBe('number');
      }
    }
  });

  it('the range really narrows the answer, and a bad range is refused in Rust’s words', async () => {
    const main = mockBackend('main');
    const all = await main.invoke('book_query', { query: Q({ metrics: ['count'] }) as unknown as JsonValue });
    const today = await main.invoke('book_query', { query: ok(understand('how many today', CTX)).query as unknown as JsonValue });
    const n = (a: { rows: JsonValue[] }) => (a.rows as Array<Record<string, number>>).reduce((s, r) => s + (r.count ?? 0), 0);
    expect(n(today)).toBeLessThan(n(all));
    await expect(main.invoke('book_query', { query: Q({ range: { from: '2026-10-07T00:00:00Z', to: '2026-10-06T00:00:00Z' } }) as unknown as JsonValue }))
      .rejects.toMatchObject({ code: 'INVALID', message: 'BookQuery rejected: range: from must be before to' });
  });
});

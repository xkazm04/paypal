import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import { COLS, splitRows } from './model';
import { fixQuestion, fixWhy, moneyList, planName, previewFor, rescueStrip, retryDate, YOU_CHOOSE } from './preview';

const H = Array.from({ length: 32 }, () => 0) as unknown as Deal['transcript_head'];
function deal(id: string, o: Partial<Deal> = {}): Deal {
  return {
    id, kind: 'rescue', side: 'seller', counterparty: 'sub', state: 'FAILED', mode: 'sandbox', mandate_id: 'R', mandate_version: 1, transcript_head: H,
    terms: { item_ref: 'care-plan', qty: 1, unit_price: { minor: 960, currency: 'USD' }, currency: 'USD', delivery: { type: 'ship_then_capture', days: 0 } },
    paypal: { order: null, authorization: null, capture: null, subscription: 'I-1' }, market: null, shield: null, ...o,
  };
}
const NOW = 1_800_000_000;
const ctx = { item: 'care-plan', amount: { minor: 960, currency: 'USD' as const }, retryAt: NOW + 4 * 86400 };

describe('names and dates', () => {
  it('turns an item reference into a plan name', () => {
    expect(planName('care-plan')).toBe('Care plan');
    expect(planName('pro_monthly')).toBe('Pro monthly');
    expect(planName('')).toBe('Subscription');
  });
  it('writes a retry date as weekday, day and month', () => {
    expect(retryDate(NOW)).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/);
  });
});

describe('what the subscriber would get', () => {
  it('has a preview for every fix, built from the plan name, the amount and the retry date only', () => {
    for (const c of COLS) {
      const p = previewFor(c, ctx);
      expect(p.line.length).toBeGreaterThan(0);
      for (const n of `${p.line} ${p.amount?.text ?? ''} ${p.note ?? ''}`.match(/\d+(\.\d+)?/g) ?? []) expect(['9.60', String(new Date((NOW + 4 * 86400) * 1000).getDate())]).toContain(n);
    }
  });
  it('reads "you choose it in the approval window" for an amount the owner has not chosen', () => {
    expect(previewFor('DISCOUNT_THIS_CYCLE', ctx)).toMatchObject({ channel: 'invoice', kind: 'Invoice line', line: 'Care plan · this month only', amount: { text: YOU_CHOOSE, unknown: true } });
    expect(previewFor('DOWNGRADE', ctx).amount).toEqual({ label: 'New price', text: 'you choose it in the approval window', unknown: true });
    expect(previewFor('PAUSE', ctx).note).toContain('you choose it in the approval window');
  });
  it('shows the known amount and the retry date for the retry and the card email', () => {
    expect(previewFor('RETRY_AFTER_FIX', ctx)).toMatchObject({ channel: 'email', line: 'Your Care plan payment of $9.60 didn’t go through' });
    expect(previewFor('NONE', ctx)).toMatchObject({ channel: 'retry', amount: { text: '$9.60', unknown: false }, note: 'No message from you' });
    expect(previewFor('NONE', ctx).line).toContain(retryDate(NOW + 4 * 86400));
  });
  it('says so when PayPal has no retry set, rather than inventing a date', () => {
    expect(previewFor('NONE', { ...ctx, retryAt: null }).line).toBe('No retry is set for Care plan');
  });
  it('never marks an unknown amount as known', () => {
    for (const c of COLS) { const a = previewFor(c, ctx).amount; if (a?.text === YOU_CHOOSE) expect(a.unknown).toBe(true); }
  });
});

describe('why sentences', () => {
  it('writes two plain sentences for every fix and for doing nothing', () => {
    for (const c of COLS) {
      const [a, b] = fixWhy(c, { amount: ctx.amount, retryAt: ctx.retryAt });
      expect(a.endsWith('.') && b.endsWith('.')).toBe(true);
    }
    expect(fixQuestion('NONE')).toBe('Why is doing nothing safe?');
    expect(fixQuestion('PAUSE')).toBe('Why this fix?');
  });
  it('names PayPal’s retry date when it is known and says so when it is not', () => {
    expect(fixWhy('NONE', { amount: ctx.amount, retryAt: ctx.retryAt })[1]).toBe(`PayPal retries the payment by itself on ${retryDate(NOW + 4 * 86400)}.`);
    expect(fixWhy('NONE', { amount: ctx.amount, retryAt: null })[1]).toBe('PayPal has no retry set, so this month stays unpaid.');
  });
  it('explains a switched-off fix from the rule that switched it off', () => {
    expect(fixWhy('RETRY_AFTER_FIX', { amount: ctx.amount, retryAt: ctx.retryAt, offCode: 'REPLAY' })[0]).toContain('replay');
    expect(fixWhy('RETRY_AFTER_FIX', { amount: ctx.amount, retryAt: ctx.retryAt, offCode: 'retry <24h' })[0]).toContain('within a day');
  });
  it('keeps the plan-wide price change out of every explanation', () => {
    for (const c of COLS) expect(fixWhy(c, { amount: ctx.amount, retryAt: null }).join(' ')).not.toMatch(/everyone.*(change|raise|lower)|price change/i);
  });
});

describe('money at risk, in progress, recovered', () => {
  const rows = (ds: Deal[]) => splitRows(ds, () => null);
  it('sums each bucket per currency from the rows the page already shows', () => {
    const ds = [
      deal('f1'), deal('f2', { terms: { ...deal('x').terms, unit_price: { minor: 500, currency: 'EUR' } } }),
      deal('w', { state: 'AWAITING_APPROVAL', kind: 'invoice', terms: { ...deal('x').terms, unit_price: { minor: 1200, currency: 'USD' } } }),
      deal('p', { state: 'CAPTURED', terms: { ...deal('x').terms, unit_price: { minor: 900, currency: 'USD' } } }),
    ];
    const s = rescueStrip(rows(ds), ds);
    expect(s.atRisk).toEqual([{ minor: 960, currency: 'USD' }, { minor: 500, currency: 'EUR' }]);
    expect(s.inProgress).toEqual([{ minor: 1200, currency: 'USD' }]);
    expect(s.recovered).toEqual([{ minor: 900, currency: 'USD' }]);
    expect(moneyList(s.atRisk)).toBe('$9.60 · €5.00');
    expect(moneyList(s.recovered)).toBe('$9.00');
  });
  it('never counts a replay or a practice-agent row as recovered, and says how much of the rest is not real', () => {
    const ds = [deal('r', { state: 'CAPTURED', mode: 'replay' }), deal('s', { state: 'CAPTURED', mode: 'scripted_engine' }), deal('f', { mode: 'replay' }), deal('g')];
    const s = rescueStrip(rows(ds), ds);
    expect(s.recovered).toEqual([]);
    expect(moneyList(s.recovered)).toBeNull();
    expect(s.notReal).toBe(1);
    expect(s.failing).toBe(2);
  });
  it('is empty with nothing to rescue', () => {
    expect(rescueStrip(rows([]), [])).toEqual({ atRisk: [], inProgress: [], recovered: [], failing: 0, inflight: 0, notReal: 0 });
  });
});

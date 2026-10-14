// The Book's figures, pure (rebuild WP3b): a count and the amount beside it describe the same set
// (scale finding #8), a hold is never paid money and the footer's "paid out today" and the Book's
// agree (#9), and "this week" is the week (#10).
import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import type { ExposureView } from '@bindings/ExposureView';
import { mockFold } from '../../../../../mock/exposure';
import { dealsIn, figures, outlook, outlookCount, paidOutIn, walletDay, weekSpan, DAY } from './model';
import { paidToday, paidTodayText } from './today';

const H = Array.from({ length: 32 }, () => 0) as unknown as Deal['transcript_head'];
const NOW = Date.UTC(2026, 9, 14, 12, 0) / 1000; // a Wednesday
function deal(id: string, o: Partial<Deal> & { price?: number; at?: number } = {}): Deal {
  const at = o.at ?? NOW - 3600;
  return {
    id, kind: 'purchase', side: 'buyer', counterparty: 'kp', state: 'CAPTURED', mode: 'sandbox', mandate_id: 'M', mandate_version: 1, transcript_head: H,
    terms: { item_ref: 'x', qty: 1, unit_price: { minor: o.price ?? 1000, currency: 'USD' }, currency: 'USD', delivery: { type: 'ship_then_capture', days: 1 } },
    paypal: { order: null, authorization: null, capture: null, subscription: null }, market: null, shield: null, created_at: at, updated_at: at, ...o,
  };
}
const none = () => false;

describe('this week is the week (#10)', () => {
  it('keeps deals that started or changed this week and nothing older, live or not', () => {
    const week = weekSpan(NOW);
    const old = deal('old', { at: NOW - 90 * DAY, state: 'AUTHORIZED' });
    const fresh = deal('fresh');
    expect(dealsIn([old, fresh], week).map((d) => d.id)).toEqual(['fresh']);
  });
  it('a deal with no time on record is in no week', () => {
    const d = deal('x');
    delete d.created_at; delete d.updated_at;
    expect(dealsIn([d], weekSpan(NOW))).toEqual([]);
  });
});

describe('a hold is not a payment (#8, #9)', () => {
  it('keeps paid, on hold and stopped apart, and a payment being checked out of all of them', () => {
    const f = figures([
      deal('paid', { price: 340763 }), deal('hold', { price: 4_800_000, state: 'AUTHORIZED' }), deal('void', { price: 50, state: 'VOIDED' }), deal('chk', { price: 999 }),
    ], (d) => d.id === 'chk');
    expect(f.paidOut).toEqual([{ currency: 'USD', minor: 340763 }]);
    expect(f.heldOut).toEqual([{ currency: 'USD', minor: 4_800_000 }]);
    expect(f.stoppedOut).toEqual([{ currency: 'USD', minor: 50 }]);
    expect(f.nOut).toBe(1);
    expect(f.checking).toBe(1);
  });
});

describe('the outlook: a count and its amount describe the same set (#8)', () => {
  const deals = [
    deal('h1', { price: 125000, state: 'AUTHORIZED' }), deal('h2', { price: 4_800_000, state: 'AUTHORIZED' }), deal('h3', { price: 2500, state: 'AUTHORIZED' }),
    deal('l1', { price: 700, state: 'AWAITING_APPROVAL' }), deal('r1', { price: 1200, kind: 'rescue', side: 'seller', state: 'AGREED' }),
    deal('done', { price: 9 }),
  ];
  const deadline: Record<string, number> = { h1: NOW + 600, h2: NOW + 86400, h3: NOW + 3600 };
  const items = outlook(deals, none, (d) => deadline[d.id] ?? null, (k, d) => (k === 'renew' ? { minor: 1500, currency: 'USD' } : { minor: d.terms.unit_price.minor, currency: 'USD' }));
  const holds = items.find((i) => i.key === 'holds');
  it('the total is the money of every deal counted, and the soonest one is said apart', () => {
    expect(holds?.deals.map((d) => d.id)).toEqual(['h1', 'h3', 'h2']);
    expect(holds?.total).toEqual([{ currency: 'USD', minor: 125000 + 4_800_000 + 2500 }]);
    expect(holds?.soonest).toMatchObject({ amount: { minor: 125000 }, deadline: NOW + 600 });
  });
  it('a failing renewal counts what is at risk, and paid deals wait for nothing', () => {
    expect(items.find((i) => i.key === 'renew')?.total).toEqual([{ currency: 'USD', minor: 1500 }]);
    expect(outlookCount(items)).toBe(5);
  });
  it('a payment being checked with PayPal is only that: not a hold to decide', () => {
    const it2 = outlook(deals, (d) => d.id === 'h2', () => null, (_, d) => ({ minor: d.terms.unit_price.minor, currency: 'USD' }));
    expect(it2.find((i) => i.key === 'holds')?.deals.map((d) => d.id)).toEqual(['h1', 'h3']);
    expect(it2.find((i) => i.key === 'checking')?.deals.map((d) => d.id)).toEqual(['h2']);
  });
});

describe('paid out today: the footer and the Book agree (#9)', () => {
  const day = Math.floor(NOW / DAY) * DAY;
  const deals = [
    deal('paid1', { price: 300000, at: NOW - 60 }), deal('paid2', { price: 40763, at: NOW - 120 }),
    deal('hold', { price: 4_800_000, state: 'AUTHORIZED', at: NOW - 30 }), deal('agreed', { price: 1_280_697, state: 'AGREED', at: NOW - 10 }),
    deal('yesterday', { price: 7777, at: day - 3600 }), deal('sold', { price: 5000, side: 'seller', at: NOW - 60 }),
  ];
  const view: ExposureView = { status: 'none', limits: null, signed_at: null, currencies: mockFold(deals, NOW), day_start: day };
  it('the footer counts what was paid today, never the hold or the agreed payment', () => {
    const t = paidToday(view, deals, none);
    expect(t?.paid).toEqual([{ minor: 340763, currency: 'USD' }]);
    expect(t?.n).toBe(2);
    expect(t?.held).toEqual({ minor: 4_800_000, currency: 'USD' });
    expect(t?.committed).toEqual({ minor: 1_280_697, currency: 'USD' });
    // The day's budget used includes the hold and the agreed payment: that is not "paid out".
    expect(t?.budget?.minor).toBe(340763 + 4_800_000 + 1_280_697);
  });
  it('is the same set as the Book’s paid out, for the wallet day', () => {
    const t = paidToday(view, deals, none);
    expect(t?.paid).toEqual(paidOutIn(deals, walletDay(day), none).money);
    // The exposure fold's own paid_today agrees while nothing today was refunded or unconfirmed.
    expect(t?.paid).toEqual([view.currencies[0]?.paid_today]);
  });
  it('leaves out a refund and a payment PayPal did not confirm (they are not paid out)', () => {
    const more = [...deals, deal('back', { price: 111, state: 'REFUNDED', at: NOW - 5 }), deal('lost', { price: 222, state: 'UNCONFIRMED', at: NOW - 5 })];
    expect(paidToday(view, more, none)?.paid).toEqual([{ minor: 340763, currency: 'USD' }]);
    expect(paidToday(view, more, (d) => d.id === 'paid2')?.paid).toEqual([{ minor: 300000, currency: 'USD' }]);
    expect(paidTodayText(paidToday(view, [], none) as NonNullable<ReturnType<typeof paidToday>>, 'nothing yet')).toBe('$0.00');
  });
  it('each currency is said on its own, never added together', () => {
    const eur = deal('eur', { price: 100, at: NOW - 60 });
    eur.terms = { ...eur.terms, unit_price: { minor: 100, currency: 'EUR' }, currency: 'EUR' };
    const all = [...deals, eur];
    const t = paidToday({ ...view, currencies: mockFold(all, NOW) }, all, none);
    expect(t?.paid).toEqual([{ minor: 340763, currency: 'USD' }, { minor: 100, currency: 'EUR' }]);
    expect(t?.held).toBeNull();
  });
});

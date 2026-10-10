// The wallet's table shows an Amount only when each line holds one money state. The week lens
// holds paid, on hold and stopped money in one window, so it shows none, while the window's sums
// keep them apart. Pure; no IPC.
import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import { LENSES, runQuery, walletSumsApart, type BookQuery, type Ctx } from './model';
import { lensAsRun } from './understand';

const H = Array.from({ length: 32 }, () => 0) as unknown as Deal['transcript_head'];
// Wednesday 7 Oct 2026, 15:30 in a UTC+2 calendar: this week is Mon 5 Oct to Mon 12 Oct local.
const NOW = 1_791_379_800;
const CALENDAR = { now: NOW, offsetMin: 120 };
const IN_WEEK = 1_791_151_200 + 86_400;
function deal(id: string, state: Deal['state'], price: number): Deal {
  return {
    id, kind: 'purchase', side: 'buyer', counterparty: 'kp', state, mode: 'sandbox', mandate_id: 'M', mandate_version: 1, transcript_head: H, created_at: IN_WEEK, updated_at: IN_WEEK,
    terms: { item_ref: 'x', qty: 1, unit_price: { minor: price, currency: 'USD' }, currency: 'USD', delivery: { type: 'ship_then_capture', days: 1 } },
    paypal: { order: null, authorization: null, capture: null, subscription: null }, market: null, shield: null,
  };
}
const ctx: Ctx = { stmt: () => 'not_applicable', cpName: (d) => d.counterparty };
const lens = (id: string) => {
  const l = LENSES.find((x) => x.id === id);
  if (!l) throw new Error(`no lens ${id}`);
  return l;
};
const stateIs = (op: 'eq' | 'ne' | 'in', value: string | string[]): BookQuery => ({ view: 'deals', filters: [{ field: 'state', op, value }], metrics: ['count', 'sum_amount'] });

describe('the week lens over paid, held and stopped money', () => {
  const fixture = [deal('paid', 'CAPTURED', 1000), deal('held', 'AUTHORIZED', 400), deal('stopped', 'VOIDED', 900)];
  const query = lensAsRun(lens('week'), CALENDAR).query;

  it('the window keeps the three states apart', () => {
    const r = runQuery(query, fixture, ctx);
    expect(r.rows).toHaveLength(3);
    expect(r.all.sums.captured.out).toEqual([{ currency: 'USD', minor: 1000 }]);
    expect(r.all.sums.held.out).toEqual([{ currency: 'USD', minor: 400 }]);
    expect(r.all.sums.stopped.out).toEqual([{ currency: 'USD', minor: 900 }]);
  });

  it('the wallet shows no combined Amount for it', () => {
    expect(walletSumsApart(query)).toBe(false);
  });
});

describe('walletSumsApart', () => {
  it('is false when the lines span money states', () => {
    expect(walletSumsApart(lens('decided').query)).toBe(false);
    expect(walletSumsApart(lens('day').query)).toBe(false);
    expect(walletSumsApart(stateIs('in', ['CAPTURED', 'VOIDED']))).toBe(false);
    expect(walletSumsApart(stateIs('ne', 'CAPTURED'))).toBe(false);
  });

  it('is true when each line holds one money state', () => {
    const byState: BookQuery = { view: 'deals', group_by: ['state'], metrics: ['count', 'sum_amount'] };
    expect(walletSumsApart(lens('stopped').query)).toBe(true);
    expect(walletSumsApart(lens('mismatch').query)).toBe(true);
    expect(walletSumsApart(byState)).toBe(true);
    expect(walletSumsApart(stateIs('in', ['CAPTURED', 'RECEIPTED', 'RECONCILED']))).toBe(true);
  });
});

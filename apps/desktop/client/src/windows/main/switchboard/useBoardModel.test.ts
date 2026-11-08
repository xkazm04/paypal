// The board's model: the fate of a deal (one documented mapping), walked over the mock world; the
// instrument numbers; the week; absent values stay null. The mock world's clock is pinned (repo law).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import type { ExposureView } from '@bindings/ExposureView';
import type { Module } from '@bindings/Module';
import { FATES, MODULE_KEYS, type Fate } from '../../../lib/assistant';
import { mockBackend, resetMockState } from '../../../mock/backend';
import { moduleOf } from '../logic';
import { boardFromWorld, fateOf, weekDayEdges, type BoardModel } from './useBoardModel';

// Friday 19:30 local, or the pin the run was started with (BOARD_PIN="2026-11-08T00:30:00": Sunday 00:30).
const PIN = new Date(process.env.BOARD_PIN ?? '2026-11-06T19:30:00');

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(PIN); });
afterEach(() => { vi.useRealTimers(); });

const deal = (state: Deal['state'], over: Partial<Deal> = {}): Deal => ({ kind: 'haggle', side: 'buyer', shield: null, state, ...over } as Deal);
const need = (kind: AttentionItem['kind']): Pick<AttentionItem, 'kind'> => ({ kind });

describe('fateOf: the one mapping from a deal to its column', () => {
  const rows: Array<[string, Deal, Pick<AttentionItem, 'kind'> | null, Fate]> = [
    ['a gate waits for the owner', deal('AWAITING_APPROVAL'), need('gate'), 'needs'],
    ['a hold waits for the owner', deal('AUTHORIZED'), need('hold'), 'needs'],
    ['a hold on a closed mismatch is still the owner’s to look at', deal('MISMATCH', { shield: 'HOLD' }), need('hold'), 'needs'],
    ['a stop card is not a need', deal('REFUSED'), need('stop'), 'stopped'],
    ['negotiating, no item: moving', deal('NEGOTIATING'), null, 'moving'],
    ['money held at PayPal is moving (a gauge, not a column)', deal('AUTHORIZED', { kind: 'purchase' }), null, 'moving'],
    ['refused', deal('REFUSED'), null, 'stopped'],
    ['withdrawn', deal('WITHDRAWN'), null, 'stopped'],
    ['lapsed', deal('EXPIRED'), null, 'stopped'],
    ['voided', deal('VOIDED'), null, 'stopped'],
    ['auto-voided', deal('AUTO_VOIDED'), null, 'stopped'],
    ['blocked by the scam shield', deal('NEGOTIATING', { shield: 'BLOCK' }), null, 'stopped'],
    ['captured on a buyer deal is paid', deal('CAPTURED', { kind: 'purchase' }), null, 'paid'],
    ['a seller deal receipted is paid', deal('RECEIPTED', { side: 'seller', kind: 'shop_order' }), null, 'paid'],
    ['a buyer receipt that is only the seller’s word is not paid', deal('RECEIPTED'), null, 'moving'],
    ['reconciled with PayPal is paid', deal('RECONCILED'), null, 'paid'],
  ];
  it.each(rows)('%s', (_why, d, n, fate) => { expect(fateOf(d, n)).toBe(fate); });
});

/** Maya's week as the mock world holds it: module -> fate -> how many deals. The prototype read the same
 *  data as 4 needs / 3 moving / 4 stopped / 5 paid; the mock has 6 / 7 / 6 / 4 (two more attention cards,
 *  a mismatch among them; the buyer receipts that are only the seller's word stay moving). */
const EXPECTED: Record<Module, Record<Fate, number>> = {
  tables: { needs: 2, moving: 4, stopped: 2, paid: 0 },
  spend: { needs: 1, moving: 0, stopped: 3, paid: 2 },
  counter: { needs: 1, moving: 2, stopped: 0, paid: 1 },
  book: { needs: 0, moving: 0, stopped: 0, paid: 0 },
  shield: { needs: 1, moving: 0, stopped: 1, paid: 0 },
  rescue: { needs: 1, moving: 1, stopped: 0, paid: 1 },
};

async function mockModel(): Promise<{ model: BoardModel; deals: Deal[]; exposure: ExposureView }> {
  resetMockState();
  const b = mockBackend('main');
  const deals = await b.invoke('list_deals', null);
  const att = await b.invoke('attention_list', null);
  const disp = new Map(await Promise.all(deals.map(async (d) => [d.id, await b.invoke('deal_display', { deal_id: d.id })] as const)));
  const needs = att.items;
  const byDeal = new Map(needs.map((n) => [n.deal_id, n]));
  const model = boardFromWorld({
    ready: true, deals, needs,
    display: (d) => { const x = disp.get(d.id)!; return { label: x.label, title: x.title }; },
    moduleOfDeal: (d) => moduleOf(d, byDeal.get(d.id)),
    exposure: att.exposure, nowSec: Math.floor(Date.now() / 1000), rulesInForce: 1, gs: null, safety: { intact: true, records: 158 },
  });
  return { model, deals, exposure: att.exposure! };
}

describe('the board over the mock world', () => {
  it('every deal sits in its module row and fate column (counts per cell)', async () => {
    const { model, deals } = await mockModel();
    const got = Object.fromEntries(MODULE_KEYS.map((m) => [m, Object.fromEntries(FATES.map((f) => [f, model.cells[m][f].count]))]));
    expect(got).toEqual(EXPECTED);
    expect(model.keys.length).toBe(deals.length);
    expect(model.colCount).toEqual({ needs: 6, moving: 7, stopped: 6, paid: 4 });
    expect(new Set(model.keys.map((k) => k.id)).size).toBe(deals.length);
  });

  it('every needs-you key carries its If-you-do-nothing line, a reason and a deadline unit', async () => {
    const { model } = await mockModel();
    const needs = model.keys.filter((k) => k.fate === 'needs');
    expect(needs.length).toBe(6);
    for (const k of needs) {
      expect(k.on_silence, k.label).toBeTruthy();
      expect(k.why, k.label).toBeTruthy();
    }
    // a mismatch is closed and a money check only opens the deal: they need the owner's eyes but have no review button
    expect(needs.filter((k) => !k.review).map((k) => k.label).sort()).toEqual(['D-0194', 'D-0199']);
    // the others (moving, stopped, paid) never carry one
    expect(model.keys.filter((k) => k.fate !== 'needs').every((k) => k.on_silence === null && k.deadline_ms === null)).toBe(true);
  });

  it('needs-you keys are soonest first; no deadline last', async () => {
    const { model } = await mockModel();
    const ds = model.cells.tables.needs.keys.map((k) => k.deadline_s);
    expect(ds[0]).not.toBeNull();
    expect(ds[ds.length - 1]).toBeNull();
  });

  it('the instrument numbers are the mock exposure, and what is not known is null', async () => {
    const { model, exposure } = await mockModel();
    const row = exposure.currencies[0]!;
    const cap = exposure.limits!;
    expect(model.money).toEqual({
      room_left_minor: cap.max_out_day.minor - row.out_today.minor, day_cap_minor: cap.max_out_day.minor, held_minor: row.held.minor + row.committed.minor,
      paid_today_minor: row.paid_today.minor, deals_today: row.deals_today, deals_cap: cap.max_deals_day, currency: 'USD',
    });
    expect(model.instruments.records).toBe('intact');
    expect(model.instruments.held_at_paypal_minor).toBe(row.held.minor);
    expect(model.instruments.held_before_minor).toBe(row.committed.minor);
    // paid to you: the seller-side deals PayPal confirmed (D-0185 $18.50 and D-0178 $9.00)
    expect(model.instruments.paid_in_minor).toBe(1850 + 900);
  });

  it('with nothing read, every money number is null, never 0', () => {
    const m = boardFromWorld({ ready: false, deals: [], needs: [], display: () => ({ label: '', title: '' }), moduleOfDeal: () => 'tables', exposure: undefined, nowSec: 0, rulesInForce: null, gs: null, safety: undefined });
    expect(m.money).toEqual({ room_left_minor: null, day_cap_minor: null, held_minor: null, paid_today_minor: null, deals_today: null, deals_cap: null, currency: null });
    expect(m.instruments.records).toBeNull();
    expect(m.instruments.paid_in_minor).toBeNull();
    expect(m.digest.rules_in_force).toBeNull();
    expect(m.digest.setup).toEqual([]);
  });

  it('the digest is the contract: deals without the board-only fields, now in ms', async () => {
    const { model } = await mockModel();
    expect(model.digest.deals.length).toBe(model.keys.length);
    expect(Object.keys(model.digest.deals[0]!).sort()).toEqual(['amount_minor', 'currency', 'deadline_ms', 'fate', 'id', 'label', 'module', 'on_silence', 'state_word']);
    expect(model.digest.now_ms).toBe(Math.floor(Date.now() / 1000) * 1000);
  });

  it('the week mark counts each deal once, in its own day', async () => {
    const { model } = await mockModel();
    for (const m of MODULE_KEYS) {
      const w = model.week[m];
      expect(w.days.length).toBe(7);
      expect(w.total).toBe(w.days.reduce((a, b) => a + b, 0));
      expect(w.total).toBeLessThanOrEqual(model.rowCount[m]);
      expect(w.today).toBeGreaterThanOrEqual(0);
      expect(w.today).toBeLessThan(7);
    }
  });
});

describe('weekDayEdges', () => {
  it('Monday to Monday in local midnights, and "today" falls in its day', () => {
    const fri = Math.floor(new Date(2026, 10, 6, 19, 30).getTime() / 1000);
    const e = weekDayEdges(fri);
    expect(e.length).toBe(8);
    expect(new Date(e[0]! * 1000).getDay()).toBe(1);
    expect(new Date(e[0]! * 1000).getHours()).toBe(0);
    expect(fri >= e[4]! && fri < e[5]!).toBe(true);
    const sun = Math.floor(new Date(2026, 10, 8, 0, 30).getTime() / 1000);
    expect(sun >= e[6]! && sun < e[7]!).toBe(true);
  });
});

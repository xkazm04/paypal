// What the board lights, as a LitSet over Maya's week: a module lights its row, a fate its column, both
// the cell, a deal itself and its cell; the filter and the highlight meet; the sum line counts the lit
// deals per module; the lit keys come soonest first. The mock world's clock is pinned (repo law).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Module } from '@bindings/Module';
import { FATES, MODULE_KEYS, type Fate } from '../../../lib/assistant';
import { mockBackend, resetMockState } from '../../../mock/backend';
import { moduleOf } from '../logic';
import { isCellLit, litFromArrangement, litKeys, NO_FILTER, NO_LIT, sumLine, type Filter, type Highlight, type LitSet } from './lit';
import { boardFromWorld, type BoardModel } from './useBoardModel';

// Friday 19:30 local, or the pin the run was started with (BOARD_PIN="2026-11-08T00:30:00": Sunday 00:30).
const PIN = new Date(process.env.BOARD_PIN ?? '2026-11-06T19:30:00');

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(PIN); });
afterEach(() => { vi.useRealTimers(); });

async function mockModel(): Promise<BoardModel> {
  resetMockState();
  const b = mockBackend('main');
  const deals = await b.invoke('list_deals', null);
  const att = await b.invoke('attention_list', null);
  const disp = new Map(await Promise.all(deals.map(async (d) => [d.id, await b.invoke('deal_display', { deal_id: d.id })] as const)));
  const byDeal = new Map(att.items.map((n) => [n.deal_id, n]));
  return boardFromWorld({
    ready: true, deals, needs: att.items,
    display: (d) => { const x = disp.get(d.id)!; return { label: x.label, title: x.title }; },
    moduleOfDeal: (d) => moduleOf(d, byDeal.get(d.id)),
    exposure: att.exposure, nowSec: Math.floor(Date.now() / 1000), rulesInForce: 1, gs: null, safety: { intact: true, records: 158 },
  });
}

const hl = (module: Module | null, fate: Fate | null, deal_id: string | null = null): Highlight => ({ module, fate, deal_id });
const lit = (model: BoardModel, highlight: Highlight | null, filter: Filter = NO_FILTER): LitSet => litFromArrangement({ filter, highlight }, model);
const idOf = (model: BoardModel, label: string): string => model.keys.find((k) => k.label === label)!.id;
/** Every lit cell, as "module:fate". */
const litCells = (l: LitSet): string[] => MODULE_KEYS.flatMap((m) => FATES.filter((f) => isCellLit(l, m, f)).map((f) => `${m}:${f}`));

describe('a reply’s light as a LitSet', () => {
  it('a module alone lights its row', async () => {
    const model = await mockModel();
    const l = lit(model, hl('spend', null));
    expect(l).toEqual({ ...NO_LIT, rows: ['spend'] });
    expect(litCells(l)).toEqual(FATES.map((f) => `spend:${f}`));
    expect(sumLine(l, model)).toEqual({ terms: [6], total: 6 });
  });

  it('a fate alone lights its column: "What needs me?" sums 2 + 1 + 1 + 1 + 1 = 6', async () => {
    const model = await mockModel();
    const l = lit(model, hl(null, 'needs'));
    expect(l).toEqual({ ...NO_LIT, cols: ['needs'] });
    expect(litCells(l)).toEqual(MODULE_KEYS.map((m) => `${m}:needs`));
    expect(sumLine(l, model)).toEqual({ terms: [2, 1, 1, 1, 1], total: 6 });
  });

  it('both together light the cell', async () => {
    const model = await mockModel();
    const l = lit(model, hl('tables', 'needs'));
    expect(l).toEqual({ ...NO_LIT, cells: [['tables', 'needs']] });
    expect(litCells(l)).toEqual(['tables:needs']);
    expect(sumLine(l, model)).toEqual({ terms: [2], total: 2 });
  });

  it('a deal lights itself and its cell, and counts as one deal', async () => {
    const model = await mockModel();
    const id = idOf(model, 'D-0193');
    const l = lit(model, hl('tables', 'needs', id));
    expect(l).toEqual({ ...NO_LIT, cells: [['tables', 'needs']], deals: [id] });
    expect(isCellLit(l, 'tables', 'needs')).toBe(true);
    expect(sumLine(l, model)).toEqual({ terms: [1], total: 1 });
    expect(litKeys(l, model).map((k) => k.label)).toEqual(['D-0193']);
  });

  it('a deal the board no longer knows lights what the module and fate name', async () => {
    const model = await mockModel();
    expect(lit(model, hl('rescue', null, 'gone'))).toEqual({ ...NO_LIT, rows: ['rescue'] });
    expect(lit(model, hl(null, null, 'gone'))).toEqual(NO_LIT);
  });

  it('nothing lit: no sum line, no keys', async () => {
    const model = await mockModel();
    expect(lit(model, null)).toEqual(NO_LIT);
    expect(sumLine(NO_LIT, model)).toBeNull();
    expect(litKeys(NO_LIT, model)).toEqual([]);
    expect(isCellLit(NO_LIT, 'tables', 'needs')).toBe(false);
  });

  it('a lit cell with no deals is lit and sums to zero, not null', async () => {
    const model = await mockModel();
    expect(model.cells.shield.paid.count).toBe(0);
    expect(sumLine(lit(model, hl('shield', 'paid')), model)).toEqual({ terms: [], total: 0 });
  });

  it('a lit set holding only deals counts one per deal, in its module', async () => {
    const model = await mockModel();
    const ids = ['D-0193', 'D-0199', 'D-0190', 'D-0193'].map((l) => idOf(model, l));
    expect(sumLine({ ...NO_LIT, deals: [...ids, 'gone'] }, model)).toEqual({ terms: [2, 1], total: 3 });
  });
});

describe('the filter and the highlight together', () => {
  it('the filter alone lights what it leaves undimmed', async () => {
    const model = await mockModel();
    expect(lit(model, null, { module: 'spend', fate: null })).toEqual({ ...NO_LIT, rows: ['spend'] });
    expect(lit(model, null, { module: null, fate: 'stopped' })).toEqual({ ...NO_LIT, cols: ['stopped'] });
    expect(lit(model, null, { module: 'shield', fate: 'stopped' })).toEqual({ ...NO_LIT, cells: [['shield', 'stopped']] });
  });

  it('both: the part of the light the filter leaves undimmed', async () => {
    const model = await mockModel();
    // Show only Spend, light Needs you: the one cell Spend x Needs you
    const l = lit(model, hl(null, 'needs'), { module: 'spend', fate: null });
    expect(l).toEqual({ ...NO_LIT, cells: [['spend', 'needs']] });
    expect(sumLine(l, model)).toEqual({ terms: [1], total: 1 });
    // the scripted module reply filters and lights the same row: the row
    expect(lit(model, hl('spend', null), { module: 'spend', fate: null })).toEqual({ ...NO_LIT, rows: ['spend'] });
    // a lit row and a filtered column meet in a cell
    expect(lit(model, hl('tables', null), { module: null, fate: 'moving' })).toEqual({ ...NO_LIT, cells: [['tables', 'moving']] });
  });

  it('when they do not meet, the light wins as is (it never hides what it names)', async () => {
    const model = await mockModel();
    expect(lit(model, hl('tables', null), { module: 'spend', fate: null })).toEqual({ ...NO_LIT, rows: ['tables'] });
    expect(lit(model, hl(null, 'paid'), { module: null, fate: 'needs' })).toEqual({ ...NO_LIT, cols: ['paid'] });
    const id = idOf(model, 'D-0193');
    // a deal outside the filter, and a deal inside it: the deal and its cell either way
    expect(lit(model, hl('tables', 'needs', id), { module: 'spend', fate: null })).toEqual({ ...NO_LIT, cells: [['tables', 'needs']], deals: [id] });
    expect(lit(model, hl('tables', 'needs', id), { module: 'tables', fate: null })).toEqual({ ...NO_LIT, cells: [['tables', 'needs']], deals: [id] });
  });
});

describe('the lit keys', () => {
  it('needs-you keys soonest deadline first, none last, at most `max`', async () => {
    const model = await mockModel();
    const l = lit(model, hl(null, 'needs'));
    const keys = litKeys(l, model);
    expect(keys.length).toBe(6);
    const ds = keys.map((k) => k.deadline_s);
    const dated = ds.filter((d): d is number => d !== null);
    expect(dated).toEqual([...dated].sort((a, b) => a - b));
    expect(ds[ds.length - 1]).toBeNull();
    expect(keys.map((k) => k.label).slice(0, 3)).toEqual(['D-0193', 'D-0198', 'D-0194']);
    expect(litKeys(l, model, 3).map((k) => k.label)).toEqual(['D-0193', 'D-0198', 'D-0194']);
    expect(litKeys(l, model, 0)).toEqual([]);
  });

  it('keys without a deadline: most recent first, the default cap is six', async () => {
    const model = await mockModel();
    const keys = litKeys(lit(model, hl(null, 'moving')), model);
    expect(model.colCount.moving).toBe(7);
    expect(keys.length).toBe(6);
    const stamps = keys.map((k) => k.stamp_s ?? 0);
    expect(stamps).toEqual([...stamps].sort((a, b) => b - a));
  });
});

// The six module lists, pure: each module's own columns over the default mock world, the empty
// first-run world, the ModuleList order, and the 500-deal scale world. The clock is pinned (repo law).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Module } from '@bindings/Module';
import { MODULE_KEYS } from '../../../../lib/assistant/contract';
import { mockBackend, resetMockState } from '../../../../mock/backend';
import { moduleOf } from '../../logic';
import { compareRows, moduleLists, whoFrom, type ListInputs } from './moduleLists';
import type { ModuleList, ModuleRow } from './rows';
import { ROWS_COLUMNS, ROWS_EMPTY } from './words';

const PIN = new Date('2026-11-06T09:30:00');

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(PIN); });
afterEach(() => { vi.useRealTimers(); history.replaceState(null, '', '/'); localStorage.clear(); sessionStorage.clear(); });

/** The inputs exactly as the hook gathers them, read from the mock backend of the world in `search`. */
async function inputsOf(search = ''): Promise<ListInputs> {
  history.replaceState(null, '', `/index.html${search}`);
  localStorage.clear();
  sessionStorage.clear();
  resetMockState();
  const b = mockBackend('main');
  const deals = await b.invoke('list_deals', null);
  const att = await b.invoke('attention_list', null);
  const disp = new Map(await Promise.all(deals.map(async (d) => [d.id, await b.invoke('deal_display', { deal_id: d.id })] as const)));
  const cps = await b.invoke('counterparty_list', null);
  const mandates = await b.invoke('mandate_list', null);
  const rescue = await b.invoke('rescue_book', null);
  const byDeal = new Map(att.items.map((n) => [n.deal_id, n]));
  return {
    deals, needs: att.items,
    display: (d) => disp.get(d.id)!,
    moduleOfDeal: (d) => moduleOf(d, byDeal.get(d.id)),
    who: whoFrom(cps),
    mandates, rescue, nowSec: Math.floor(Date.now() / 1000),
  };
}

const FATE_RANK = { needs: 0, moving: 1, stopped: 2, paid: 3 } as const;
/** The contract's order holds on a list: fate rank never goes back, needs by deadline, non-deal last. */
function expectSorted(list: ModuleList): void {
  const rank = (r: ModuleRow) => (r.fate === null ? 9 : FATE_RANK[r.fate]);
  for (let i = 1; i < list.rows.length; i++) {
    const a = list.rows[i - 1]!;
    const b = list.rows[i]!;
    expect(rank(a)).toBeLessThanOrEqual(rank(b));
    if (a.fate === 'needs' && b.fate === 'needs') expect(a.deadline_s ?? Infinity).toBeLessThanOrEqual(b.deadline_s ?? Infinity);
  }
}

describe('the module lists over the default mock world', () => {
  it('every module has its own columns, one cell per column, figures right-aligned', async () => {
    const lists = moduleLists(await inputsOf());
    for (const m of MODULE_KEYS) {
      const l = lists[m];
      expect(l.module).toBe(m);
      expect(l.columns).toEqual(ROWS_COLUMNS[m]);
      expect(l.empty).toBe(ROWS_EMPTY[m]);
      expect(l.columns).not.toContain('State');
      for (const r of l.rows) {
        expect(r.module).toBe(m);
        expect(r.cells).toHaveLength(l.columns.length);
        expect(r.cells[0]!.num).toBe(true);
        expect(r.title.length).toBeGreaterThan(0);
        // No raw state code, deal id or ULID leaks into what a row says.
        const text = [r.title, ...r.cells.map((c) => c.text), r.sub ?? ''].join(' | ');
        expect(text).not.toMatch(/\b[A-Z]{2,}_[A-Z_]+\b|\bD-\d{4}\b|\b01[0-9A-HJKMNP-TV-Z]{20,}\b|undefined|NaN/);
      }
      expectSorted(l);
    }
  });

  it('the trade modules list their own deals; book lists every payment; shield every checked one', async () => {
    const i = await inputsOf();
    const lists = moduleLists(i);
    const own = (m: Module) => i.deals.filter((d) => i.moduleOfDeal(d) === m).length;
    expect(lists.tables.rows).toHaveLength(own('tables'));
    expect(lists.spend.rows).toHaveLength(own('spend'));
    expect(lists.book.rows).toHaveLength(i.deals.length);
    expect(lists.shield.rows.length).toBeGreaterThanOrEqual(own('shield'));
    expect(lists.shield.rows.every((r) => i.deals.find((d) => d.id === r.deal_id)?.shield !== undefined)).toBe(true);
    expect(lists.rescue.rows).toHaveLength(i.deals.filter((d) => d.kind === 'rescue').length);
    // Every deal row is a real deal of the world.
    for (const m of MODULE_KEYS) for (const r of lists[m].rows) if (r.deal_id) expect(i.deals.some((d) => d.id === r.deal_id)).toBe(true);
  });

  it('tables: offer and limit as money, a needs row carries its deadline and why', async () => {
    const { tables } = moduleLists(await inputsOf());
    expect(tables.rows.length).toBeGreaterThan(0);
    for (const r of tables.rows) expect(r.cells[0]!.text).toMatch(/^[$€£¥]|\d/);
    const need = tables.rows.find((r) => r.fate === 'needs')!;
    expect(need).toBeDefined();
    expect(tables.rows[0]!.fate).toBe('needs');
    expect(need.sub).toBeTruthy();
    expect(tables.rows.some((r) => r.cells[1]!.num && /^[$€£¥]/.test(r.cells[1]!.text))).toBe(true);
  });

  it('spend: a verdict per purchase from the gate (paid, on hold, refused or asks you), the rule line under it', async () => {
    const { spend } = moduleLists(await inputsOf());
    const verdicts = new Set(spend.rows.map((r) => r.cells[1]!.text));
    expect([...verdicts].some((v) => /Refused/.test(v))).toBe(true);
    expect([...verdicts].some((v) => /Paid/.test(v))).toBe(true);
    for (const r of spend.rows) expect(r.sub).toBeTruthy();
    expect(spend.rows.find((r) => /Refused/.test(r.cells[1]!.text))!.cells[1]!.tone).toBe('stopped');
  });

  it('counter: open orders first as deal rows, then catalog items as non-deal rows `cat:`', async () => {
    const { counter } = moduleLists(await inputsOf());
    const firstCat = counter.rows.findIndex((r) => r.deal_id === null);
    expect(firstCat).toBeGreaterThan(0);
    expect(counter.rows.slice(firstCat).every((r) => r.deal_id === null && r.id.startsWith('cat:') && r.fate === null)).toBe(true);
    expect(counter.rows.slice(0, firstCat).every((r) => r.deal_id !== null)).toBe(true);
    expect(counter.rows[0]!.fate).toBe('needs');
  });

  it('book: who, the signed amount (out −, in +) and where the money is', async () => {
    const i = await inputsOf();
    const { book } = moduleLists(i);
    for (const r of book.rows) {
      const d = i.deals.find((x) => x.id === r.deal_id)!;
      expect(r.cells[0]!.text.startsWith(d.side === 'buyer' ? '−' : '+')).toBe(true);
    }
    expect(new Set(book.rows.map((r) => r.cells[1]!.text)).size).toBeGreaterThan(1);
  });

  it('shield: a verdict and a reason for every checked payment', async () => {
    const { shield } = moduleLists(await inputsOf());
    expect(shield.rows.length).toBeGreaterThan(0);
    expect(shield.rows[0]!.fate).toBe('needs');
    expect(shield.rows[0]!.cells[2]!.text).not.toBe('—');
  });

  it('rescue: at risk and what happens next', async () => {
    const { rescue } = moduleLists(await inputsOf());
    expect(rescue.rows.length).toBeGreaterThan(0);
    const need = rescue.rows.find((r) => r.fate === 'needs')!;
    expect(need.sub).toMatch(/^If you do nothing: /);
  });
});

describe('the module lists over the first-run world', () => {
  it('every list is empty and says so in its own words', async () => {
    const lists = moduleLists(await inputsOf('?first_run=1'));
    for (const m of MODULE_KEYS) {
      expect(lists[m].rows).toEqual([]);
      expect(lists[m].columns).toEqual(ROWS_COLUMNS[m]);
      expect(lists[m].empty).toBe(ROWS_EMPTY[m]);
    }
    expect(new Set(MODULE_KEYS.map((m) => lists[m].empty)).size).toBe(MODULE_KEYS.length);
  });
});

describe('the order', () => {
  const item = (id: string, fate: ModuleRow['fate'], deadline_s: number | null, stamp: number, order = 0) => ({
    row: { id, module: 'tables' as Module, deal_id: fate ? id : null, title: id, cells: [], sub: null, fate, deadline_s }, stamp, order,
  });
  it('needs by deadline (none last), then moving, stopped, paid newest first, non-deal rows last in their own order', () => {
    const rows = [
      item('cat-b', null, null, 0, 1), item('paid', 'paid', null, 5), item('cat-a', null, null, 0, 0),
      item('need-late', 'needs', 500, 1), item('stop-old', 'stopped', null, 1), item('need-none', 'needs', null, 9),
      item('moving', 'moving', null, 3), item('need-soon', 'needs', 100, 1), item('stop-new', 'stopped', null, 8),
    ];
    expect(rows.sort(compareRows).map((x) => x.row.id)).toEqual(['need-soon', 'need-late', 'need-none', 'moving', 'stop-new', 'stop-old', 'paid', 'cat-a', 'cat-b']);
  });
});

describe('the module lists at 500 deals (?scale=large)', () => {
  it('builds every list well inside a frame budget and keeps the order', async () => {
    const i = await inputsOf('?scale=large');
    expect(i.deals.length).toBe(500);
    moduleLists(i); // warm
    const t0 = performance.now();
    const lists = moduleLists(i);
    const ms = performance.now() - t0;
    expect(lists.book.rows).toHaveLength(500);
    for (const m of MODULE_KEYS) expectSorted(lists[m]);
    expect(lists.rescue.rows.length).toBe(150);
    expect(ms).toBeLessThan(250);
  });
});

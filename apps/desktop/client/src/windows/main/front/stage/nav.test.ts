// The STAGE fork's navigation and greeting, pure: ops move the list and the stage, the pick flag, the
// part of the day.
import { describe, expect, it } from 'vitest';
import type { Module } from '@bindings/Module';
import type { ModuleList, ModuleRow } from '../rows/rows';
import { partOfDay } from './greeting';
import { applyOps, pickFromSearch, START_NAV, visibleRows } from './nav';

const row = (module: Module, id: string, title: string, fate: ModuleRow['fate'], deal_id: string | null = id, deadline_s: number | null = null): ModuleRow =>
  ({ id, module, deal_id, title, cells: [], sub: null, fate, deadline_s });
const lists = (): Record<Module, ModuleList> => {
  const empty = (m: Module): ModuleList => ({ module: m, columns: [], rows: [], empty: '' });
  return {
    tables: { ...empty('tables'), rows: [row('tables', 'd1', 'Monitor', 'needs', 'd1', 200), row('tables', 'd2', 'Dock', 'moving')] },
    spend: { ...empty('spend'), rows: [row('spend', 'd3', 'Cable', 'needs', 'd3', 100)] },
    counter: { ...empty('counter'), rows: [row('counter', 'cat:x', 'HDMI 21', null, null)] },
    book: { ...empty('book'), rows: [row('book', 'd1', 'Monitor payment', 'needs', 'd1', 200)] }, shield: empty('shield'), rescue: empty('rescue'),
  } as Record<Module, ModuleList>;
};

describe('stage nav', () => {
  it('All lists needs first by deadline, then the rest, each deal once; filter by title and fate', () => {
    const l = lists();
    expect(visibleRows(l, START_NAV).map((r) => r.id)).toEqual(['d3', 'd1', 'd2', 'cat:x']);
    expect(visibleRows(l, { ...START_NAV, query: 'hdmi' }).map((r) => r.id)).toEqual(['cat:x']);
    expect(visibleRows(l, { ...START_NAV, fate: 'needs' }).map((r) => r.id)).toEqual(['d3', 'd1']);
  });

  it('show of a deal opens its row; other shows open a panel; focus rings the deal row; filter scopes', () => {
    const l = lists();
    const a = applyOps(START_NAV, [{ op: 'show', panel: { kind: 'decision', deal_id: 'd1' } }], l);
    expect(a.open).toEqual({ kind: 'row', module: 'tables', id: 'd1' });
    const b = applyOps(START_NAV, [{ op: 'show', panel: { kind: 'money' } }], l);
    expect(b.open).toEqual({ kind: 'panel', spec: { kind: 'money' } });
    const c = applyOps(START_NAV, [{ op: 'focus', module: null, fate: null, deal_id: 'd3' }], l);
    expect(c).toMatchObject({ scope: 'spend', lit: 'spend:d3', open: null });
    const d = applyOps(START_NAV, [{ op: 'filter', module: 'tables', fate: 'needs' }], l);
    expect(d).toMatchObject({ scope: 'tables', fate: 'needs' });
  });

  it('fs_pick opens a row by id or index; nonsense is ignored', () => {
    const l = lists();
    expect(pickFromSearch('?fs_pick=tables:1', l)?.open).toEqual({ kind: 'row', module: 'tables', id: 'd2' });
    expect(pickFromSearch('?fs_pick=counter:cat:x', l)?.open).toEqual({ kind: 'row', module: 'counter', id: 'cat:x' });
    expect(pickFromSearch('?fs_pick=nowhere:0', l)).toBeNull();
    expect(pickFromSearch('', l)).toBeNull();
  });

  it('the salutation follows the local clock, and deep night has none', () => {
    const at = (h: number) => new Date(2026, 10, 6, h, 30).getTime();
    expect(partOfDay(at(9))).toBe('morning');
    expect(partOfDay(at(13))).toBe('afternoon');
    expect(partOfDay(at(20))).toBe('evening');
    expect(partOfDay(at(2))).toBeNull();
  });
});

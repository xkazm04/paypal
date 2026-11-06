// The STAGE fork's navigation and greeting, pure: ops move the list and the stage, the pick flag, the
// part of the day.
import { describe, expect, it } from 'vitest';
import type { Module } from '@bindings/Module';
import type { ModuleList, ModuleRow } from '../rows/rows';
import { partOfDay } from './greeting';
import { applyOps, pickFromSearch, routeReply, START_NAV, visibleRows } from './nav';

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

  it('the routing rule: a reply never moves main; its shows render in its turn; one deal is offered as a link', () => {
    const l = lists();
    // chip "What if I do nothing?" (scripted silenceReply: show needs + focus needs) stays in the conversation
    const silence = routeReply(START_NAV, [{ op: 'show', panel: { kind: 'needs', module: null } }, { op: 'focus', module: null, fate: 'needs', deal_id: null }], l);
    expect(silence.nav.open).toBeNull();
    expect(silence.panels).toEqual([{ kind: 'needs', module: null }]);
    expect(silence.link).toBeNull();
    expect(silence.nav.fate).toBe('needs');
    // a reply that shows ONE deal: a turn with a link to its page, no navigation
    const one = routeReply(START_NAV, [{ op: 'show', panel: { kind: 'decision', deal_id: 'd1' } }, { op: 'focus', module: 'tables', fate: 'needs', deal_id: 'd1' }], l);
    expect(one.nav.open).toBeNull();
    expect(one.link).toEqual({ kind: 'row', module: 'tables', id: 'd1' });
    expect(one.panels).toEqual([{ kind: 'decision', deal_id: 'd1' }]);
    // two deals: no single target, no link; an unknown deal: no link either
    expect(routeReply(START_NAV, [{ op: 'show', panel: { kind: 'deal', deal_id: 'd1' } }, { op: 'show', panel: { kind: 'deal', deal_id: 'd3' } }], l).link).toBeNull();
    expect(routeReply(START_NAV, [{ op: 'show', panel: { kind: 'deal', deal_id: 'nope' } }], l).link).toBeNull();
    // the same panel twice renders once; a page she has open stays open
    const open = { ...START_NAV, open: { kind: 'row' as const, module: 'spend' as const, id: 'd3' } };
    const twice = routeReply(open, [{ op: 'show', panel: { kind: 'money' } }, { op: 'show', panel: { kind: 'money' } }], l);
    expect(twice.panels).toEqual([{ kind: 'money' }]);
    expect(twice.nav.open).toEqual(open.open);
  });

  it('a row click is the owner move to a page; a reply only scopes the list and rings rows', () => {
    const l = lists();
    const b = applyOps(START_NAV, [{ op: 'show', panel: { kind: 'money' } }], l);
    expect(b.open).toBeNull();
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

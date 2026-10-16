// Find's index: built once, searched by one substring pass over prebuilt text, in the old palette's
// group order, capped; a deal's label is found but never shown.
import { describe, expect, it } from 'vitest';
import { buildIndex, FIND_CAP, searchIndex, type FindItem } from './findIndex';

const deal = (i: number): FindItem => ({ key: `d-${i}`, group: 'deals', title: `Monitor ${i}`, sub: `Shop ${i % 7}`, also: `D-${String(i).padStart(4, '0')}`, target: { kind: 'deal', deal: `id${i}` } });
const items: FindItem[] = [
  { key: 'p-x', group: 'places', title: 'Settings', sub: 'agent app', target: { kind: 'route', route: { level: 'place', place: 'settings' } } },
  ...Array.from({ length: 500 }, (_, i) => deal(i)),
  { key: 'm-spend', group: 'modules', title: 'Spend', sub: 'Agent purchases', target: { kind: 'module', module: 'spend' } },
  { key: 'n-1', group: 'needs', title: 'Approve $329.00', sub: 'Monitor 3', target: { kind: 'need', deal: 'id3' } },
];

describe('find', () => {
  const index = buildIndex(items);
  it('ranks needs, then modules, then deals, then places, keeping each group’s order', () => {
    expect(index.items.map((i) => i.group).filter((g, i, a) => a.indexOf(g) === i)).toEqual(['needs', 'modules', 'deals', 'places']);
    expect(index.items.filter((i) => i.group === 'deals').map((i) => i.key).slice(0, 3)).toEqual(['d-0', 'd-1', 'd-2']);
  });
  it('matches title, sub or the hidden label, case-insensitively, capped', () => {
    expect(searchIndex(index, '').length).toBe(FIND_CAP);
    expect(searchIndex(index, 'MONITOR 3')[0]?.key).toBe('n-1');
    expect(searchIndex(index, 'd-0193').map((i) => i.key)).toEqual(['d-193']);
    expect(searchIndex(index, 'agent').map((i) => i.key)).toEqual(['m-spend', 'p-x']);
    expect(searchIndex(index, 'nothing like it')).toEqual([]);
    expect(searchIndex(index, 'monitor', 5)).toHaveLength(5);
  });
  it('keeps the lowercased text prebuilt, one entry per item', () => {
    expect(index.hay).toHaveLength(index.items.length);
    expect(index.hay[0]).toBe(index.hay[0]?.toLowerCase());
  });
});

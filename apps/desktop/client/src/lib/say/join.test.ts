// Where an open table's latest price lands against the two numbers the owner said. It is a preview of THEIR numbers.
import { describe, expect, it } from 'vitest';
import type { Reach } from './draft';
import { peekTables, verdictOf, type OpenTable } from './join';

const reach: Reach = { currency: 'USD', alone: 32000, ceiling: 34000, perDay: 34000, until: 1_800_000_000, item: '27-inch 4K monitor', itemRef: 'monitor-27-4k', ask: 32000 };
const table = (o: Partial<OpenTable> & Pick<OpenTable, 'id' | 'price'>): OpenTable => ({ ref: 'monitor-27-4k', title: '27-inch 4K monitor', who: 'Dan', currency: 'USD', ...o });

describe('a price against what was said', () => {
  it('on its own up to the amount she asked above, asks above it, never above the most', () => {
    expect(verdictOf(31200, reach)).toBe('alone');
    expect(verdictOf(32000, reach)).toBe('alone');
    expect(verdictOf(32900, reach)).toBe('asks');
    expect(verdictOf(34000, reach)).toBe('asks');
    expect(verdictOf(38900, reach)).toBe('over');
  });
  it('asks about every payment when told to', () => {
    expect(verdictOf(1, { alone: 0, ceiling: 34000 })).toBe('asks');
  });
});

describe('the open tables for the item that was said', () => {
  const tables = [table({ id: 'a', price: 32900 }), table({ id: 'b', who: 'House seller', price: 31200 }), table({ id: 'c', price: 38900 }), table({ id: 'd', ref: 'monitor-arm', price: 9000 }), table({ id: 'e', price: 100, currency: 'EUR' })];
  it('lists only that item’s tables, in the same currency, cheapest first', () => {
    expect(peekTables(reach, tables).map((p) => [p.id, p.verdict])).toEqual([['b', 'alone'], ['a', 'asks'], ['c', 'over']]);
  });
  it('says nothing when the sentence was not tied to one of the owner’s items, or names no most', () => {
    expect(peekTables({ ...reach, itemRef: null }, tables)).toEqual([]);
    expect(peekTables({ ...reach, ceiling: null }, tables)).toEqual([]);
    expect(peekTables(null, tables)).toEqual([]);
  });
});

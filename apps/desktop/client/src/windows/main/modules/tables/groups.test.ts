import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import type { DealGroupView } from '@bindings/DealGroupView';
import type { GroupTable } from '@bindings/GroupTable';
import { groupOf, groupStanding, shopAroundSets } from './groups';

const usd = (minor: number) => ({ minor, currency: 'USD' as const });
function deal(id: string, o: Partial<Deal> & { item?: string; cp?: string } = {}): Deal {
  return {
    id,
    created_at: 100,
    updated_at: 100,
    kind: 'haggle',
    side: 'buyer',
    counterparty: o.cp ?? `kp_${id}`,
    terms: { item_ref: o.item ?? 'monitor', qty: 1, unit_price: usd(30000), currency: 'USD', delivery: { type: 'digital_now' } },
    state: 'NEGOTIATING',
    mandate_id: 'M',
    mandate_version: 1,
    transcript_head: Array(32).fill(0) as Deal['transcript_head'],
    paypal: { order: null, authorization: null, capture: null, subscription: null },
    mode: 'sandbox',
    market: null,
    shield: null,
    ...o,
  };
}
const table = (deal_id: string, o: Partial<GroupTable> = {}): GroupTable => ({
  deal_id, counterparty: `kp_${deal_id}`, state: 'NEGOTIATING', seller_price: null, our_price: null, closed_by_group: false, ...o,
});
const group = (tables: GroupTable[], winner: string | null = null): DealGroupView => ({
  group_id: 'G', item_ref: 'monitor', opened_at: 100, winner, tables,
});

describe('shop around sets', () => {
  it('offers open buyer tables for one item under one set of rules, one per seller, two or more', () => {
    const sets = shopAroundSets([
      deal('A'), deal('B'), deal('C', { cp: 'kp_A' }),
      deal('D', { item: 'dock' }),
      deal('E', { side: 'seller' }), deal('F', { state: 'AGREED' }), deal('G', { kind: 'purchase' }),
      deal('H', { mandate_id: 'OTHER' }),
    ], []);
    expect(sets.map((s) => s.map((d) => d.id))).toEqual([['A', 'B']]);
  });
  it('never offers a table that is already in a group', () => {
    expect(shopAroundSets([deal('A'), deal('B'), deal('C')], [group([table('A'), table('B')])])).toEqual([]);
  });
});

describe('group standing', () => {
  it('is bargaining with the lowest open seller price as the best', () => {
    const s = groupStanding(group([table('A', { seller_price: usd(32900) }), table('B', { seller_price: usd(32400) }), table('C')]));
    expect(s.kind).toBe('bargaining');
    if (s.kind === 'bargaining') {
      expect(s.open).toBe(3);
      expect(s.best?.deal_id).toBe('B');
    }
  });
  it('names the winner once one seller agreed', () => {
    const s = groupStanding(group([table('A', { state: 'AGREED' }), table('B', { state: 'WITHDRAWN', closed_by_group: true })], 'A'));
    expect(s).toEqual({ kind: 'won', winner: expect.objectContaining({ deal_id: 'A' }) });
  });
  it('has ended when every table closed with no agreement', () => {
    expect(groupStanding(group([table('A', { state: 'WITHDRAWN' }), table('B', { state: 'EXPIRED' })])).kind).toBe('ended');
  });
  it('finds the group of a deal', () => {
    const g = group([table('A'), table('B')]);
    expect(groupOf([g], 'B')).toBe(g);
    expect(groupOf([g], 'Z')).toBeUndefined();
  });
});

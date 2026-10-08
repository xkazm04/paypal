// Shop around (T8): the mock serves the sample group (Dan and the house seller for the 27-inch 4K
// monitor) as deal_groups does, groups only open buyer tables for one item from main, and refuses a
// second acceptance in a group as the ledger's guard does, then withdraws the others once one agreed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockBackend, resetMockState } from './backend';
import { fakeUlid } from './fixtures';

const NOW = 1_800_000_000;
const DAN = fakeUlid('D-0193');
const HOUSE = fakeUlid('D-0204');
function at(path: string, label: 'main' | 'tumbler' | 'approval') {
  history.replaceState(null, '', path);
  return mockBackend(label);
}

describe('mock shop-around groups (parity with the wallet)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW * 1000);
    vi.stubGlobal('BroadcastChannel', undefined);
    localStorage.clear(); sessionStorage.clear(); resetMockState();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('serves the sample group with each seller’s latest signed price, main only', async () => {
    const main = at('/index.html', 'main');
    const [g, ...rest] = await main.invoke('deal_groups', null);
    expect(rest).toEqual([]);
    expect(g!.winner).toBeNull();
    expect(g!.item_ref).toBe('monitor-27-4k');
    expect(g!.tables.map((t) => [t.deal_id, t.seller_price?.minor, t.our_price?.minor])).toEqual([[DAN, 32900, 32700], [HOUSE, 33400, 31200]]);
    await expect(at('/tumbler.html', 'tumbler').invoke('deal_groups', null)).rejects.toMatchObject({ code: 'PERMISSION' });
    await expect(at(`/approval.html?deal=${DAN}`, 'approval').invoke('deal_group_open', { deal_ids: [DAN, HOUSE] })).rejects.toMatchObject({ code: 'PERMISSION' });
  });

  it('groups open buyer tables for one item from main, once', async () => {
    const main = at('/index.html?groups=none', 'main');
    expect(await main.invoke('deal_groups', null)).toEqual([]);
    await expect(main.invoke('deal_group_open', { deal_ids: [DAN] })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(main.invoke('deal_group_open', { deal_ids: [DAN, fakeUlid('D-0201')] })).rejects.toMatchObject({ code: 'INVALID' });
    const g = await main.invoke('deal_group_open', { deal_ids: [DAN, HOUSE] });
    expect(g.tables.map((t) => t.deal_id)).toEqual([DAN, HOUSE]);
    await expect(main.invoke('deal_group_open', { deal_ids: [DAN, HOUSE] })).rejects.toMatchObject({ code: 'INVALID' });
    expect(await main.invoke('deal_groups', null)).toHaveLength(1);
  });

  it('refuses a second acceptance in the group while the owner’s acceptance on another table is out', async () => {
    const dan = at(`/approval.html?deal=${DAN}`, 'approval');
    const token = await dan.invoke('approval_token', null);
    const s = await dan.invoke('approval_summary', { deal_id: DAN });
    expect(s.can_owner_accept).toBe(true);
    const accepted = await dan.invoke('deal_owner_accept', { deal_id: DAN, attempt: s.attempt, terms_hash: s.terms_hash, counter_hash: s.counter_hash, checks_hash: s.checks_hash }, { token });
    // Dan has not answered yet: the owner's acceptance is the group's one outstanding acceptance.
    expect(accepted.state).toBe('NEGOTIATING');
    const house = at(`/approval.html?deal=${HOUSE}`, 'approval');
    const hs = await house.invoke('approval_summary', { deal_id: HOUSE });
    expect(hs.can_owner_accept).toBe(false);
    const main = at('/index.html', 'main');
    const [g] = await main.invoke('deal_groups', null);
    expect(g!.winner).toBeNull();
    expect(g!.tables.every((t) => !t.closed_by_group)).toBe(true);
    // No money moved anywhere in the group.
    for (const id of [DAN, HOUSE]) expect((await main.invoke('get_deal', { deal_id: id })).paypal.order).toBeNull();
  });
});

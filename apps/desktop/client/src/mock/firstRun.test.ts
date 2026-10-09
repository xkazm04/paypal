import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockBackend, resetMockState, STORE_KEY } from './backend';
import { buildFirstRunState, firstRunPreview, PRACTICE_TERMS, withFirstRun, worldKeys } from './firstRun';
import { buildMockState } from './fixtures';

const NOW = 1_800_000_000;
class LocalChannel {
  static peers: LocalChannel[] = [];
  callback?: (event: { data: unknown }) => void;
  constructor(readonly name: string) { LocalChannel.peers.push(this); }
  addEventListener(_name: string, cb: (event: { data: unknown }) => void) { this.callback = cb; }
  postMessage(data: unknown) { for (const p of LocalChannel.peers) if (p !== this && p.name === this.name) p.callback?.({ data }); }
}
const at = (url: string) => history.replaceState(null, '', url);

describe('?first_run=1: the mock as a brand-new wallet', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW * 1000);
    LocalChannel.peers = [];
    vi.stubGlobal('BroadcastChannel', LocalChannel);
    vi.spyOn(window, 'open').mockImplementation(() => null);
    localStorage.clear(); sessionStorage.clear(); resetMockState();
    at('/index.html');
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('reads the switch, and keeps it on every window the preview opens', () => {
    expect(firstRunPreview('?first_run=1')).toBe(true);
    expect(firstRunPreview('?first_run=0')).toBe(false);
    expect(firstRunPreview('')).toBe(false);
    expect(withFirstRun('approval.html?deal=x', true)).toBe('approval.html?deal=x&first_run=1');
    expect(withFirstRun('approval.html', true)).toBe('approval.html?first_run=1');
    expect(withFirstRun('index.html#d=D-1', true)).toBe('index.html?first_run=1#d=D-1');
    expect(withFirstRun('index.html?first_run=1', true)).toBe('index.html?first_run=1');
    expect(withFirstRun('approval.html?deal=x', false)).toBe('approval.html?deal=x');
    expect(worldKeys('k', 'c', false)).toEqual({ store: 'k', channel: 'c' });
    expect(worldKeys('k', 'c', true)).toEqual({ store: 'k:first-run', channel: 'c:first-run' });
  });

  it('a fresh wallet: no deals, rules, keys, limits or connections, and first_run true', () => {
    const s = buildFirstRunState(NOW);
    expect(s.settings).toMatchObject({ first_run: true, payment_executor_configured: false, channel3_configured: false, meters_available: false, selected_engine: 'scripted', engine_chosen: false, house: 'idle', agents_paused: false });
    expect(s.deals).toEqual([]);
    expect(s.mandates).toEqual([]);
    expect(s.counterparties).toEqual([]);
    expect(s.history).toEqual([]);
    expect(s.audit).toEqual([]);
    expect(s.envelope).toBeNull();
    expect(s.credentialsStoredAt).toEqual({ paypal_sandbox: null, channel3: null });
    expect(s.walletSpendTodayMinor).toBe(0);
  });

  it('serves the fresh wallet to every window, and the sample week stays as it was', async () => {
    at('/index.html?first_run=1');
    const main = mockBackend('main');
    expect(await main.invoke('get_settings', null)).toMatchObject({ first_run: true, payment_executor_configured: false });
    expect(await main.invoke('list_deals', null)).toEqual([]);
    expect(await main.invoke('mandate_list', null)).toEqual([]);
    expect(await main.invoke('counterparty_list', null)).toEqual([]);
    const att = await main.invoke('attention_list', null);
    expect(att.items).toEqual([]);
    expect(att.exposure?.status).toBe('none');
    // Windows it opens stay in the first-run world.
    await main.invoke('approval_open', { deal_id: null, target: 'mandate' });
    expect(window.open).toHaveBeenCalledWith('approval.html?target=mandate&first_run=1', 'the-table-approval', 'width=744,height=660');

    // The default preview is untouched: Maya's week, in its own storage.
    at('/index.html');
    const sample = mockBackend('main');
    expect((await sample.invoke('get_settings', null)).first_run).toBe(false);
    expect((await sample.invoke('list_deals', null)).length).toBe(buildMockState(NOW).deals.length);
    expect(localStorage.getItem(`${STORE_KEY}:first-run`)).toBeNull(); // nothing written yet
  });

  it('keeping the practice agent is a recorded choice: engine_select sets engine_chosen', async () => {
    at('/index.html?first_run=1');
    const main = mockBackend('main');
    expect(await main.invoke('get_settings', null)).toMatchObject({ selected_engine: 'scripted', engine_chosen: false });
    await main.invoke('engine_select', { engine: 'scripted' });
    expect(await main.invoke('get_settings', null)).toMatchObject({ selected_engine: 'scripted', engine_chosen: true });
  });

  it('walks the three steps: keys, rules, then the house seller', async () => {
    at('/approval.html?first_run=1');
    const approval = mockBackend('approval');
    const token = await approval.invoke('approval_token', null);
    await approval.invoke('set_credentials', 'paypal_sandbox', { token });
    expect((await approval.invoke('get_settings', null)).payment_executor_configured).toBe(true);
    await approval.invoke('mandate_sign', {
      id: null, agent: 'negotiator', not_before: NOW, expires: NOW + 30 * 86400,
      clauses: [
        { type: 'roles', roles: ['buy'] },
        { type: 'counterparties', rule: { type: 'paired' } },
        { type: 'per_deal', kind: 'haggle', max_amount: { minor: 25000, currency: 'USD' }, categories: ['office'] },
        { type: 'band', item_refs: [PRACTICE_TERMS.item_ref], floor: null, ceiling: { minor: 25000, currency: 'USD' }, max_rounds: 6, deadline: NOW + 7 * 86400 },
        { type: 'velocity', max_deals_day: 2, max_total_day: { minor: 25000, currency: 'USD' } },
        { type: 'human_present_over', amount: { minor: 20000, currency: 'USD' } },
        { type: 'payees', payees: ['HOUSE'] },
      ],
    }, { token });
    expect((await approval.invoke('get_settings', null)).first_run).toBe(false);
    expect(localStorage.getItem(`${STORE_KEY}:first-run`)).not.toBeNull();

    // The house seller's practice table, with no sample deal to borrow from.
    at('/index.html?first_run=1');
    const main = mockBackend('main');
    const words = await main.invoke('pairing_join', { code: 'HOUSE', side: 'buyer', payee: 'maya-shop', peer: null });
    expect(words.house_table?.terms).toEqual(PRACTICE_TERMS);
    at(`/approval.html?first_run=1&pairing=${encodeURIComponent(JSON.stringify(words.pairing_id))}`);
    const confirm = mockBackend('approval');
    const t2 = await confirm.invoke('approval_token', null);
    await confirm.invoke('pairing_confirm', { pairing_id: words.pairing_id, words: words.words, display_name: 'House seller' }, { token: t2 });
    expect(await main.invoke('counterparty_list', null)).toEqual([expect.objectContaining({ house: true, declared_payee: 'HOUSE' })]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockBackend, resetMockState, STORE_KEY } from '../mock/backend';
import { buildMockState, fakeHash, fakeUlid, type MockState } from '../mock/fixtures';
import type { TumblerHandoff } from '@bindings/TumblerHandoff';

const NOW = 1_800_000_000;
const ID = fakeUlid('D-0193');
function store(state: MockState) { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
function approvalFor(id: string) {
  history.replaceState(null, '', `/approval.html?deal=${id}`);
  return mockBackend('approval');
}
class LocalChannel {
  static peers: LocalChannel[] = [];
  callback?: (event: { data: unknown }) => void;
  constructor(_name: string) { LocalChannel.peers.push(this); }
  addEventListener(_name: string, cb: (event: { data: unknown }) => void) { this.callback = cb; }
  postMessage(data: unknown) { for (const p of LocalChannel.peers) if (p !== this) p.callback?.({ data }); }
}

describe('generated client requests and mock gates', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW * 1000);
    LocalChannel.peers = [];
    vi.stubGlobal('BroadcastChannel', LocalChannel);
    vi.spyOn(window, 'open').mockImplementation(() => null);
    localStorage.clear(); sessionStorage.clear(); resetMockState();
    history.replaceState(null, '', '/index.html');
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('reads generated safe projections with the same label/selection restrictions', async () => {
    const main = mockBackend('main');
    const tumbler = mockBackend('tumbler');
    const approval = approvalFor(ID);
    expect(await approval.invoke('approval_selection', null)).toBe(ID);
    await expect(main.invoke('approval_selection', null)).rejects.toMatchObject({ code: 'PERMISSION' });
    const disp = await tumbler.invoke('deal_display', { deal_id: ID });
    expect(disp.label).toBe('D-0193');
    expect(await approval.invoke('deal_display', { deal_id: ID })).toEqual(disp);
    await expect(approval.invoke('deal_display', { deal_id: fakeUlid('D-0190') })).rejects.toMatchObject({ code: 'PERMISSION' });
    expect((await main.invoke('deal_transcript', { deal_id: ID })).every((s) => s.verified)).toBe(true);
    await expect(tumbler.invoke('deal_transcript', { deal_id: ID })).rejects.toMatchObject({ code: 'PERMISSION' });
    await expect(tumbler.invoke('counterparty_list', null)).rejects.toMatchObject({ code: 'PERMISSION' });
  });

  it('accepts only the current owner-bound counter with authority and updates the ledger timestamp', async () => {
    const approval = approvalFor(ID);
    const token = await approval.invoke('approval_token', null);
    const s = await approval.invoke('approval_summary', { deal_id: ID });
    expect(s.can_owner_accept).toBe(true);
    const args = { deal_id: ID, attempt: s.attempt, terms_hash: s.terms_hash, counter_hash: s.counter_hash, checks_hash: s.checks_hash };
    await expect(approval.invoke('deal_owner_accept', args)).rejects.toMatchObject({ code: 'PERMISSION' });
    await expect(approval.invoke('deal_owner_accept', { ...args, counter_hash: fakeHash('stale') }, { token })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(approval.invoke('deal_owner_accept', { ...args, terms_hash: fakeHash('stale terms') }, { token })).rejects.toMatchObject({ code: 'INVALID' });
    const d = await approval.invoke('deal_owner_accept', args, { token });
    expect(d.updated_at).toBe(NOW);
    expect(d.created_at).toBe(NOW - 86400);
    expect((await approval.invoke('deal_transcript', { deal_id: ID })).at(-1)?.typ).toBe('ACCEPT');
    await expect(approval.invoke('deal_owner_accept', args, { token })).rejects.toMatchObject({ code: 'INVALID' });
  });

  it.each(['locked', 'deadline', 'ceiling', 'rounds', 'revoke', 'hold'] as const)('owner ACCEPT cannot override %s', async (reason) => {
    const state = buildMockState(NOW);
    const d = state.deals.find((d) => d.deal.id === ID)!;
    // The version the deal was signed under (signed history keeps older versions in the list).
    const m = state.mandates.find((m) => m.payload.id === d.deal.mandate_id && m.payload.version === d.deal.mandate_version)!;
    if (reason === 'locked') state.settings.locked = true;
    if (reason === 'deadline') d.display.deadline = NOW;
    if (reason === 'hold') d.deal.shield = 'HOLD';
    if (reason === 'revoke') state.mandates = [];
    for (const c of m.payload.clauses) if (c.type === 'band') {
      if (reason === 'ceiling') c.ceiling = { minor: 30000, currency: 'USD' };
      if (reason === 'rounds') c.max_rounds = 1;
    }
    store(state);
    const approval = approvalFor(ID);
    const token = await approval.invoke('approval_token', null);
    const s = await approval.invoke('approval_summary', { deal_id: ID });
    await expect(approval.invoke('deal_owner_accept', { deal_id: ID, attempt: 1, terms_hash: s.terms_hash, counter_hash: s.counter_hash }, { token })).rejects.toBeDefined();
  });

  it('hands pairing words to approval and still requires exact words, capability and unlock', async () => {
    const main = mockBackend('main');
    const words = await main.invoke('pairing_join', { code: 'TBL-demo', peer: null, side: 'buyer', payee: 'merchant' });
    await main.invoke('approval_open', { deal_id: null, pairing: words.pairing_id });
    expect(window.open).toHaveBeenCalledWith(expect.stringContaining('?pairing='), 'the-table-approval', 'width=744,height=660');
    history.replaceState(null, '', `/approval.html?pairing=${encodeURIComponent(JSON.stringify(words.pairing_id))}`);
    const approval = mockBackend('approval');
    expect((await approval.invoke('approval_pairing', null))?.words).toEqual(words.words);
    await expect(main.invoke('approval_pairing', null)).rejects.toMatchObject({ code: 'PERMISSION' });
    const args = { pairing_id: words.pairing_id, words: words.words, display_name: 'Owner label' };
    await expect(approval.invoke('pairing_confirm', args)).rejects.toMatchObject({ code: 'PERMISSION' });
    const token = await approval.invoke('approval_token', null);
    await expect(approval.invoke('pairing_confirm', { ...args, words: ['wrong', ...words.words.slice(1)] as typeof words.words }, { token })).rejects.toMatchObject({ code: 'INVALID' });
    await approval.invoke('pairing_confirm', args, { token });
    expect(await approval.invoke('approval_pairing', null)).toBeNull();
  });

  it('snoozes only from tumbler for more than 45 minutes, preserving the deadline and default', async () => {
    const main = mockBackend('main'); const tumbler = mockBackend('tumbler');
    const before = await tumbler.invoke('deal_display', { deal_id: ID });
    await expect(main.invoke('deal_snooze', { deal_id: ID })).rejects.toMatchObject({ code: 'PERMISSION' });
    await tumbler.invoke('deal_snooze', { deal_id: ID });
    expect((await tumbler.invoke('attention_list', null)).items.some((i) => i.deal_id === ID)).toBe(false);
    expect(await tumbler.invoke('deal_display', { deal_id: ID })).toEqual(before);
    vi.setSystemTime((NOW + 1800) * 1000);
    expect((await tumbler.invoke('attention_list', null)).items.some((i) => i.deal_id === ID)).toBe(true);
    vi.setSystemTime(((before.deadline ?? 0) - 2700) * 1000);
    await expect(tumbler.invoke('deal_snooze', { deal_id: ID })).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('targets browser handoff to tumbler only after a valid selected approval', async () => {
    const state = buildMockState(NOW); const d = state.deals.find((d) => d.deal.id === ID)!;
    d.deal.state = 'AWAITING_APPROVAL'; store(state);
    const main = mockBackend('main'); const tumbler = mockBackend('tumbler'); const approval = approvalFor(ID);
    const seen: TumblerHandoff[] = []; const wrong: TumblerHandoff[] = [];
    await tumbler.listen('tumbler:handoff', (p) => seen.push(p));
    await main.listen('tumbler:handoff', (p) => wrong.push(p));
    const token = await approval.invoke('approval_token', null);
    const s = await approval.invoke('approval_summary', { deal_id: ID });
    const args = { deal_id: ID, attempt: 1, terms_hash: s.terms_hash, checks_hash: s.checks_hash };
    await expect(main.invoke('open_paypal_in_browser', args, { token })).rejects.toMatchObject({ code: 'PERMISSION' });
    expect(seen).toHaveLength(0);
    await approval.invoke('open_paypal_in_browser', args, { token });
    expect(seen).toEqual([{ deal_id: ID, approve_until: d.display.deadline }]);
    expect(wrong).toHaveLength(0);
    expect((await tumbler.invoke('attention_list', null)).wallet_spend_today_currency).toBe('USD');
  });

  it('revokes by status: history stays, the id stops listing, versions keep counting', async () => {
    const approval = approvalFor(ID);
    const token = await approval.invoke('approval_token', null);
    const before = await approval.invoke('mandate_list', null);
    const target = before[0]!.payload;
    await approval.invoke('mandate_revoke', { id: target.id }, { token });
    const after = await approval.invoke('mandate_list', null);
    expect(after.some((m) => m.payload.id === target.id)).toBe(false);
    expect(after).toHaveLength(before.length - 1);
    await expect(approval.invoke('mandate_revoke', { id: target.id }, { token })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const stored = JSON.parse(localStorage.getItem(STORE_KEY)!) as MockState;
    expect(stored.mandates.some((m) => m.payload.id === target.id && m.payload.version === target.version)).toBe(true);
    const next = await approval.invoke('mandate_sign', { id: target.id, agent: 'negotiator', clauses: target.clauses, not_before: target.not_before, expires: target.expires }, { token });
    expect(next.payload.version).toBe(target.version + 1);
    expect((await approval.invoke('mandate_list', null)).filter((m) => m.payload.id === target.id).map((m) => m.payload.version)).toEqual([target.version + 1]);
  });

  it('band_set re-signs the deal\'s own mandate and rebinds the deal to the new version', async () => {
    const state = buildMockState(NOW);
    const d = state.deals.find((d) => d.deal.id === ID)!;
    const own = d.deal.mandate_id;
    const other = state.mandates.find((m) => m.payload.id !== own)!;
    state.mandates = [...state.mandates.filter((m) => m !== other), other]; // signed last, not the deal's
    store(state);
    const approval = approvalFor(ID);
    const token = await approval.invoke('approval_token', null);
    const ceiling = { minor: 33000, currency: 'USD' as const };
    const next = await approval.invoke('band_set', { deal_id: ID, floor: null, ceiling }, { token });
    expect(next.payload.id).toBe(own);
    expect(next.payload.version).toBe(d.deal.mandate_version + 1);
    expect(next.payload.clauses.find((c) => c.type === 'band')).toMatchObject({ ceiling });
    const listed = await approval.invoke('mandate_list', null);
    expect(listed.filter((m) => m.payload.id === other.payload.id).map((m) => m.payload.version)).toEqual([other.payload.version]);
    expect(listed.filter((m) => m.payload.id === own).map((m) => m.payload.version)).toEqual([next.payload.version]);
    const main = mockBackend('main');
    expect((await main.invoke('get_deal', { deal_id: ID })).mandate_version).toBe(next.payload.version);
  });

  it('returns the mandate slot on each list entry', async () => {
    const main = mockBackend('main');
    const list = await main.invoke('mandate_list', null);
    const slot = (id: string) => list.find((m) => m.payload.id === id)?.agent;
    expect(slot(fakeUlid('M-14'))).toBe('negotiator');
    expect(slot(fakeUlid('M-12'))).toBe('shopper');
    expect(list.every((m) => m.agent !== undefined)).toBe(true);
  });
});

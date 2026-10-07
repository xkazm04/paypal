// Wave 0 (docs/build/PORT-GAPS-BRIEF.md): the mock mirrors each new Rust fact and gate, and the
// pages' pure helpers read the real fact instead of drawing it as unknown.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockBackend, resetMockState } from '../mock/backend';
import { fakeUlid } from '../mock/fixtures';
import type { JsonValue } from '@bindings/serde_json/JsonValue';
import { decidedBy, pairingFact } from '../windows/main/logic';
import { LENSES } from '../windows/main/modules/book/model';

const NOW = 1_800_000_000;
class LocalChannel {
  static peers: LocalChannel[] = [];
  callback?: (event: { data: unknown }) => void;
  constructor(_name: string) { LocalChannel.peers.push(this); }
  addEventListener(_name: string, cb: (event: { data: unknown }) => void) { this.callback = cb; }
  postMessage(data: unknown) { for (const p of LocalChannel.peers) if (p !== this) p.callback?.({ data }); }
}
function approvalFor(query: string) {
  history.replaceState(null, '', `/approval.html${query}`);
  return mockBackend('approval');
}

describe('wave 0 port gaps', () => {
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

  it('1 · Deal.decided_by: the recorded authority, and an owner decision records "you"', async () => {
    const main = mockBackend('main');
    const deals = await main.invoke('list_deals', null);
    const by = (label: string) => deals.find((d) => d.id === fakeUlid(label))!;
    expect(decidedBy(by('D-0192'))).toMatchObject({ who: 'policy', text: 'your rule · limit per deal' });
    expect(decidedBy(by('D-0185')).who).toBe('policy');
    expect(decidedBy(by('D-0180')).who).toBe('you');
    expect(decidedBy(by('D-0193'))).toMatchObject({ who: 'none' });
    expect(decidedBy({ decided_by: { type: 'safe_default', deadline: 1 } }).who).toBe('default');
    const id = fakeUlid('D-0193');
    const approval = approvalFor(`?deal=${id}`);
    const token = await approval.invoke('approval_token', null);
    const s = await approval.invoke('approval_summary', { deal_id: id });
    const d = await approval.invoke('deal_owner_accept', { deal_id: id, attempt: s.attempt, terms_hash: s.terms_hash, counter_hash: s.counter_hash, checks_hash: s.checks_hash }, { token });
    expect(d.decided_by).toEqual({ type: 'human', at: NOW });
  });

  it('2 · counterparty pairing status, declared payee and the quarantined note read (main only)', async () => {
    const main = mockBackend('main');
    const cps = await main.invoke('counterparty_list', null);
    const house = cps.find((c) => c.house)!;
    expect(house.pairing).toBe('house_pinned');
    expect(pairingFact(house).text).toBe('house seller');
    expect(cps.every((c) => c.pairing !== 'house_pinned' || c.house)).toBe(true);
    expect(cps.find((c) => c.display_name === 'pixel-bay')?.declared_payee).toBe('pixel-bay');
    expect(pairingFact(undefined).tone).toBe('dashed');
    const held = fakeUlid('D-0198');
    const n = await main.invoke('counterparty_note', { deal_id: held });
    expect(n?.text).toContain('friends & family');
    expect([...(n?.text ?? '')].length).toBeLessThanOrEqual(280);
    expect(await main.invoke('counterparty_note', { deal_id: fakeUlid('D-0190') })).toBeNull();
    await expect(mockBackend('tumbler').invoke('counterparty_note', { deal_id: held })).rejects.toMatchObject({ code: 'PERMISSION' });
    await expect(approvalFor(`?deal=${held}`).invoke('counterparty_note', { deal_id: held })).rejects.toMatchObject({ code: 'PERMISSION' });
  });

  it('3 · pairing lifecycle: abort without privilege, expiry on the read, pinned to Main, house wake', async () => {
    const main = mockBackend('main');
    const pinned: unknown[] = [];
    await main.listen('pairing:pinned', (p) => pinned.push(p));
    const a = await main.invoke('pairing_join', { code: 'otter-1', side: 'buyer', payee: 'me', peer: null });
    const b = await main.invoke('pairing_join', { code: 'otter-2', side: 'buyer', payee: 'me', peer: null });
    await expect(mockBackend('tumbler').invoke('pairing_abort', { pairing_id: a.pairing_id, code: null })).rejects.toMatchObject({ code: 'PERMISSION' });
    const approval = approvalFor(`?pairing=${encodeURIComponent(JSON.stringify(a.pairing_id))}`);
    const read = await approval.invoke('approval_pairing', null);
    expect(read?.expires).toBeGreaterThan(NOW);
    await expect(approval.invoke('pairing_abort', { pairing_id: b.pairing_id, code: null })).rejects.toMatchObject({ code: 'PERMISSION' });
    await expect(approval.invoke('pairing_abort', { pairing_id: a.pairing_id, code: 'otter-1' })).rejects.toMatchObject({ code: 'INVALID' });
    expect(await approval.invoke('pairing_abort', { pairing_id: a.pairing_id, code: null })).toBeNull(); // no token, no unlock
    expect(await approval.invoke('approval_pairing', null)).toBeNull();
    const approvalB = approvalFor(`?pairing=${encodeURIComponent(JSON.stringify(b.pairing_id))}`);
    const token = await approvalB.invoke('approval_token', null);
    await approvalB.invoke('pairing_confirm', { pairing_id: b.pairing_id, words: b.words, display_name: 'Ana' }, { token });
    expect(pinned).toEqual([expect.objectContaining({ pairing_id: b.pairing_id, house: false })]);
    expect(await main.invoke('house_wake', null)).toBe('ready');
    expect((await main.invoke('get_settings', null)).house).toBe('ready');
    await expect(mockBackend('tumbler').invoke('house_wake', null)).rejects.toMatchObject({ code: 'PERMISSION' });
  });

  it('4 · approval_open targets and drafts: checked in Main, read back pre-filled only by the approval window', async () => {
    const main = mockBackend('main');
    const open = vi.mocked(window.open);
    const haggle = fakeUlid('D-0193');
    const draft = { type: 'band' as const, floor: null, ceiling: { minor: 33500, currency: 'USD' as const } };
    expect(await main.invoke('approval_open', { deal_id: haggle, target: 'deal', draft })).toBeNull();
    const url = String(open.mock.calls.at(-1)?.[0]);
    const approval = approvalFor(url.slice(url.indexOf('?')));
    expect(await approval.invoke('approval_handoff', null)).toEqual({ target: 'deal', deal_id: haggle, draft });
    await expect(main.invoke('approval_handoff', null)).rejects.toMatchObject({ code: 'PERMISSION' });
    await expect(mockBackend('tumbler').invoke('approval_open', { deal_id: haggle, target: 'deal', draft })).rejects.toMatchObject({ code: 'PERMISSION' });
    await expect(main.invoke('approval_open', { deal_id: haggle, target: 'credentials' })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(main.invoke('approval_open', { deal_id: haggle, draft: { type: 'band', floor: null, ceiling: { minor: 33500, currency: 'EUR' } } })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(main.invoke('approval_open', { deal_id: haggle, draft: { type: 'lever', lever: 'PAUSE' } })).rejects.toMatchObject({ code: 'INVALID' });
    expect(await main.invoke('approval_open', { deal_id: fakeUlid('D-0188'), target: 'deal', draft: { type: 'lever', lever: 'PAUSE' } })).toBeNull();
    const s2 = fakeUlid('S-2');
    expect(await main.invoke('approval_open', { deal_id: null, target: 'mandate', draft: { type: 'floor', mandate_id: s2, item_ref: 'monitor-arm', floor: { minor: 6000, currency: 'USD' } } })).toBeNull();
    await expect(main.invoke('approval_open', { deal_id: null, target: 'mandate', draft: { type: 'floor', mandate_id: s2, item_ref: 'wipe-kit', floor: { minor: 6000, currency: 'USD' } } })).rejects.toMatchObject({ code: 'INVALID' });
    const cfg = String(open.mock.calls.at(-1)?.[0]);
    expect(cfg).toContain('target=mandate');
    expect(await main.invoke('approval_open', { deal_id: null, target: 'unlock' })).toBeNull();
  });

  it('5 · owner facts and the audit trail: read-only, paged newest first, main (and approval for facts) only', async () => {
    const main = mockBackend('main');
    const facts = await main.invoke('owner_facts', null);
    expect(facts.lock_in).toBeGreaterThan(0);
    expect(facts.last_reporting_poll?.status).toBe(200);
    expect(facts.credentials.map((c) => [c.kind, c.stored])).toEqual([['paypal_sandbox', true], ['channel3', true]]);
    expect(facts.credentials.find((c) => c.kind === 'channel3')?.stored_at).toBeNull(); // stored before dates were kept
    expect(facts.agents.map((a) => a.slot)).toEqual(['negotiator', 'shopper', 'assistant']);
    expect(facts.agents.find((a) => a.slot === 'negotiator')?.mandates.length).toBeGreaterThan(0);
    expect(facts.engines.every((e) => e.probed_at !== null)).toBe(true);
    await expect(mockBackend('tumbler').invoke('owner_facts', null)).rejects.toMatchObject({ code: 'PERMISSION' });
    await expect(approvalFor('').invoke('audit_page', { before: null, limit: 5 })).rejects.toMatchObject({ code: 'PERMISSION' });
    await expect(main.invoke('audit_page', { before: null, limit: 0 })).rejects.toMatchObject({ code: 'INVALID' });
    const first = await main.invoke('audit_page', { before: null, limit: 4 });
    expect(first.rows.map((r) => r.seq)).toEqual([...first.rows.map((r) => r.seq)].sort((a, b) => b - a));
    expect(first.next_before).toBe(first.rows.at(-1)?.seq);
    const second = await main.invoke('audit_page', { before: first.next_before, limit: 4 });
    expect(second.rows[0]?.seq).toBeLessThan(first.rows.at(-1)!.seq);
    const all = await main.invoke('audit_page', { before: null, limit: 200 });
    expect(all.next_before).toBeNull();
    expect(all.rows.some((r) => r.decided_by?.type === 'policy' && r.to === 'REFUSED')).toBe(true);
  });

  it('6 · book_query: lenses answered by Rust, rejections verbatim INVALID, main only', async () => {
    const main = mockBackend('main');
    const lens = LENSES.find((l) => l.id === 'decided')!;
    const a = await main.invoke('book_query', { query: lens.query as unknown as JsonValue });
    expect(a.query.group_by).toEqual(['decided_by']);
    const rows = a.rows as Array<Record<string, JsonValue>>;
    expect(rows.every((r) => r.currency === 'USD' && typeof r.count === 'number' && typeof r.sum_amount === 'number')).toBe(true);
    expect(rows.some((r) => typeof r.decided_by === 'string' && (r.decided_by as string).includes('"policy"'))).toBe(true);
    for (const l of LENSES) await expect(main.invoke('book_query', { query: l.query as unknown as JsonValue })).resolves.toBeTruthy();
    await expect(main.invoke('book_query', { query: { view: 'deals', metrics: ['count'], sql: 'DELETE FROM audit_log' } })).rejects.toMatchObject({ code: 'INVALID', message: expect.stringContaining('BookQuery rejected: unknown field `sql`') });
    await expect(main.invoke('book_query', { query: { view: 'deals', metrics: ['count', 'count'] } })).rejects.toMatchObject({ code: 'INVALID', message: 'BookQuery rejected: metrics: each at most once' });
    await expect(mockBackend('tumbler').invoke('book_query', { query: lens.query as unknown as JsonValue })).rejects.toMatchObject({ code: 'PERMISSION' });
  });
});

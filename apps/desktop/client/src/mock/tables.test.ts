// Opening and joining a table in the browser mock (deal_create / deal_join), as the Rust runtime
// does: approval window + token + unlocked only; the house's practice table joins only as the table
// kept when its words were confirmed, and reaches a haggle; a seller's table is listed. No PayPal.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clause } from '@bindings/Clause';
import type { DealCreateArgs } from '@bindings/DealCreateArgs';
import type { WindowLabel } from '../lib/contract';
import { houseJoinArgs } from '../windows/approval/tableDraft';
import { GateError, mockBackend, resetMockState } from './backend';
import { PRACTICE_TERMS } from './firstRun';

const NOW = 1_800_000_000;
class LocalChannel {
  static peers: LocalChannel[] = [];
  callback?: (event: { data: unknown }) => void;
  constructor(readonly name: string) { LocalChannel.peers.push(this); }
  addEventListener(_name: string, cb: (event: { data: unknown }) => void) { this.callback = cb; }
  postMessage(data: unknown) { for (const p of LocalChannel.peers) if (p !== this && p.name === this.name) p.callback?.({ data }); }
}
const at = (url: string) => history.replaceState(null, '', url);
const usd = (minor: number) => ({ minor, currency: 'USD' as const });
const rules = (role: 'buy' | 'sell'): Clause[] => [
  { type: 'roles', roles: [role] },
  { type: 'counterparties', rule: { type: 'paired' } },
  { type: 'per_deal', kind: 'haggle', max_amount: usd(25000), categories: ['office'] },
  { type: 'band', item_refs: [PRACTICE_TERMS.item_ref], floor: role === 'sell' ? usd(15000) : null, ceiling: role === 'buy' ? usd(25000) : null, max_rounds: 6, deadline: NOW + 7 * 86400 },
  { type: 'velocity', max_deals_day: 2, max_total_day: usd(25000) },
  { type: 'human_present_over', amount: usd(20000) },
  { type: 'payees', payees: [role === 'buy' ? 'HOUSE' : 'maya-shop'] },
];

/** A first-run wallet with signed rules for `role`, paired by four words (`code` HOUSE = the house seller). */
async function paired(role: 'buy' | 'sell', code: string) {
  at('/approval.html?first_run=1');
  const setup = mockBackend('approval');
  const token = await setup.invoke('approval_token', null);
  const mandate = await setup.invoke('mandate_sign', { id: null, agent: 'negotiator', not_before: NOW, expires: NOW + 30 * 86400, clauses: rules(role) }, { token });
  at('/index.html?first_run=1');
  const main = mockBackend('main');
  const words = await main.invoke('pairing_join', { code, side: role === 'buy' ? 'buyer' : 'seller', payee: 'maya-shop', peer: null });
  at(`/approval.html?first_run=1&pairing=${encodeURIComponent(JSON.stringify(words.pairing_id))}`);
  const confirm = mockBackend('approval');
  const t2 = await confirm.invoke('approval_token', null);
  const key = await confirm.invoke('pairing_confirm', { pairing_id: words.pairing_id, words: words.words, display_name: code === 'HOUSE' ? 'House seller' : 'Dan' }, { token: t2 });
  return { main, words, key, mandate };
}
/** An approval window as it opens (owner configuration), with its capability. */
async function approvalWindow(locked = false) {
  at(`/approval.html?first_run=1${locked ? '&locked=1' : ''}`);
  const b = mockBackend('approval');
  return { b, token: await b.invoke('approval_token', null) };
}
const gate = (p: Promise<unknown>) => p.then(() => 'admitted', (e: unknown) => (e instanceof GateError ? e.code : `other:${(e as { code?: string }).code}`));

describe('deal_create and deal_join in the browser mock', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW * 1000);
    LocalChannel.peers = [];
    vi.stubGlobal('BroadcastChannel', LocalChannel);
    vi.spyOn(window, 'open').mockImplementation(() => null);
    localStorage.clear(); sessionStorage.clear(); resetMockState();
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('are refused outside the approval window, without its token, and while locked', async () => {
    const { words, key, mandate } = await paired('buy', 'HOUSE');
    const join = houseJoinArgs(words.house_table!, key, { ...mandate, agent: 'negotiator' });
    const create: DealCreateArgs = { ...join.create, side: 'seller' };
    const { token } = await approvalWindow();
    for (const label of ['main', 'tumbler'] as WindowLabel[]) {
      at(`/${label === 'main' ? 'index' : label}.html?first_run=1`);
      const b = mockBackend(label);
      expect(await gate(b.invoke('deal_join', join, { token }))).toBe('PERMISSION');
      expect(await gate(b.invoke('deal_create', create, { token }))).toBe('PERMISSION');
    }
    const open = await approvalWindow();
    for (const opts of [undefined, { token: 'not-the-token' }]) {
      expect(await gate(open.b.invoke('deal_join', join, opts))).toBe('PERMISSION');
      expect(await gate(open.b.invoke('deal_create', create, opts))).toBe('PERMISSION');
    }
    const locked = await approvalWindow(true);
    expect(await gate(locked.b.invoke('deal_join', join, { token: locked.token }))).toBe('LOCKED');
    expect(await gate(locked.b.invoke('deal_create', create, { token: locked.token }))).toBe('LOCKED');
    // Nothing was opened by any refused call.
    expect(await open.b.invoke('list_deals', null)).toEqual([]);
  });

  it('joins the house practice table from its kept table and reaches a haggle', async () => {
    const { main, words, key, mandate } = await paired('buy', 'HOUSE');
    const table = words.house_table!;
    // Main hands the table to the approval window; the mock checks it like open_approval.
    await main.invoke('approval_open', { deal_id: null, target: null, draft: { type: 'table', counterparty: key, house: table } });
    await expect(main.invoke('approval_open', { deal_id: null, target: null, draft: { type: 'table', counterparty: key, house: { ...table, terms: { ...table.terms, unit_price: usd(1) } } } }))
      .rejects.toMatchObject({ code: 'INVALID' });
    const { b, token } = await approvalWindow();
    const entry = (await b.invoke('mandate_list', null)).find((m) => m.payload.id === mandate.payload.id)!;
    // A table that is not the one kept at pairing is refused.
    await expect(b.invoke('deal_join', { ...houseJoinArgs(table, key, entry), deal_id: '01JDNOTTHEHOUSETABLE00000' }, { token })).rejects.toMatchObject({ code: 'INVALID' });
    const deal = await b.invoke('deal_join', houseJoinArgs(table, key, entry), { token });
    expect(deal).toMatchObject({ id: table.deal_id, kind: 'haggle', side: 'buyer', state: 'NEGOTIATING', counterparty: key, terms: table.terms, mandate_id: mandate.payload.id });
    expect(deal.paypal).toEqual({ order: null, authorization: null, capture: null, subscription: null });
    // The haggle is on the table: the house's signed listing, and a deadline that lapses on silence.
    expect(await main.invoke('list_deals', null)).toEqual([expect.objectContaining({ id: table.deal_id, state: 'NEGOTIATING' })]);
    expect(await main.invoke('deal_transcript', { deal_id: table.deal_id })).toEqual([expect.objectContaining({ by: 'them', typ: 'LISTING', price: table.terms.unit_price })]);
    const display = await main.invoke('deal_display', { deal_id: table.deal_id });
    expect(display.deadline).toBe(Math.min(table.negotiation_deadline, NOW + 7 * 86400));
    expect(display.on_silence).toMatch(/no money moves/);
    // The same table joins once.
    await expect(b.invoke('deal_join', houseJoinArgs(table, key, entry), { token })).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('opens a seller table for a wallet connected by four words, listed under the seller rules', async () => {
    const { key, mandate } = await paired('sell', 'otter-basil-1234');
    const { b, token } = await approvalWindow();
    const args: DealCreateArgs = { kind: 'haggle', side: 'seller', counterparty: key, mandate_id: mandate.payload.id, mandate_version: mandate.payload.version, terms: PRACTICE_TERMS, category: 'office' };
    // Outside the rules: another category, an amount over the per-deal limit.
    await expect(b.invoke('deal_create', { ...args, category: 'parts' }, { token })).rejects.toMatchObject({ code: 'REFUSED' });
    await expect(b.invoke('deal_create', { ...args, terms: { ...PRACTICE_TERMS, qty: 2 } }, { token })).rejects.toMatchObject({ code: 'REFUSED' });
    const deal = await b.invoke('deal_create', args, { token });
    expect(deal).toMatchObject({ kind: 'haggle', side: 'seller', state: 'LISTED', counterparty: key });
    expect(await b.invoke('deal_transcript', { deal_id: deal.id })).toEqual([expect.objectContaining({ by: 'you', typ: 'LISTING' })]);
  });
});

// The table sheet's model: which signed rules can open or join a table, and the exact deal_join /
// deal_create arguments built from the house's table (PairingWords.house_table) or a listing.
import { describe, expect, it } from 'vitest';
import type { Clause } from '@bindings/Clause';
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import type { HouseTableDraft } from '@bindings/HouseTableDraft';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import { parseMoneyInput } from './model';
import { buildListing, houseJoinArgs, tableCategories, tableCounterparties, tableItems, tableMandates, type ListingDraft } from './tableDraft';

const NOW = 1_800_000_000;
const usd = (minor: number) => ({ minor, currency: 'USD' as const });
const entry = (id: string, clauses: Clause[], extra: Partial<MandateListEntry> = {}): MandateListEntry => ({
  agent: 'negotiator', owner_sig: [], ...extra,
  payload: { id, version: 2, agent_key: Array(32).fill(0) as MandateListEntry['payload']['agent_key'], clauses, not_before: NOW - 60, expires: NOW + 86400 },
});
const haggle = (role: 'buy' | 'sell'): Clause[] => [
  { type: 'roles', roles: [role] },
  { type: 'per_deal', kind: 'haggle', max_amount: usd(25000), categories: ['office', 'parts'] },
  { type: 'band', item_refs: ['monitor-24-ips'], floor: role === 'sell' ? usd(15000) : null, ceiling: role === 'buy' ? usd(25000) : null, max_rounds: 6, deadline: NOW + 3600 },
];
const BUY = entry('01JDBUYRULES0000000000000A', haggle('buy'));
const SELL = entry('01JDSELLRULES000000000000A', haggle('sell'));
const TABLE: HouseTableDraft = {
  negotiation_deadline: NOW + 1800,
  deal_id: '01JDHOUSETABLE00000000000A',
  terms: { item_ref: 'monitor-24-ips', qty: 1, unit_price: usd(22900), currency: 'USD', delivery: { type: 'digital_now' } },
  category: 'office',
};

describe('the rules that can carry a table', () => {
  it('keeps active, fitting rules for the side, and drops refused, expired, other-role and non-haggle ones', () => {
    const refused = entry('01JDREFUSED00000000000000A', haggle('buy'), { refusal: { clause: 3, reason: 'empty categories' } });
    const expired = entry('01JDEXPIRED00000000000000A', haggle('buy'));
    expired.payload.expires = NOW - 1;
    const shop = entry('01JDSHOP000000000000000000', [{ type: 'roles', roles: ['buy'] }, { type: 'per_deal', kind: 'purchase', max_amount: usd(100), categories: ['office'] }]);
    const all = [BUY, SELL, refused, expired, shop];
    expect(tableMandates(all, 'buyer', NOW)).toEqual([BUY]);
    expect(tableMandates(all, 'seller', NOW)).toEqual([SELL]);
    expect(tableCategories(SELL)).toEqual(['office', 'parts']);
    expect(tableItems(SELL)).toEqual(['monitor-24-ips']);
  });

  it('offers a seller only wallets confirmed by four words, never the house', () => {
    const cp = (key_id: string, house: boolean, pairing: CounterpartyDisplay['pairing']): CounterpartyDisplay => ({ key_id, display_name: key_id, house, first_seen: 0, deals_closed: 0, pairing, declared_payee: null });
    expect(tableCounterparties([cp('kp_dan', false, 'words_confirmed'), cp('kp_house', true, 'house_pinned'), cp('kp_x', false, 'unpaired')]).map((c) => c.key_id)).toEqual(['kp_dan']);
  });
});

describe('deal_join from the house table and a mandate', () => {
  it('uses the table’s own deal id, terms and category, the chosen buyer rules, as a buyer haggle', () => {
    expect(houseJoinArgs(TABLE, 'kp_house', BUY)).toEqual({
      deal_id: TABLE.deal_id,
      create: {
        kind: 'haggle', side: 'buyer', counterparty: 'kp_house',
        mandate_id: BUY.payload.id, mandate_version: 2,
        terms: TABLE.terms, category: 'office',
      },
    });
  });
});

describe('deal_create for a seller table', () => {
  const draft: ListingDraft = { counterparty: 'kp_dan', mandateId: SELL.payload.id, category: 'parts', item: 'monitor-24-ips', qty: '2', price: '120.50' };
  it('builds a seller haggle under the picked rules, in their currency', () => {
    expect(buildListing(draft, [SELL], parseMoneyInput)).toEqual({
      ok: true,
      args: {
        kind: 'haggle', side: 'seller', counterparty: 'kp_dan', mandate_id: SELL.payload.id, mandate_version: 2, category: 'parts',
        terms: { item_ref: 'monitor-24-ips', qty: 2, unit_price: usd(12050), currency: 'USD', delivery: { type: 'digital_now' } },
      },
    });
  });
  it('names what is missing instead of guessing', () => {
    const bad = (d: Partial<ListingDraft>) => buildListing({ ...draft, ...d }, [SELL], parseMoneyInput);
    expect(bad({ counterparty: '' }).ok).toBe(false);
    expect(bad({ mandateId: 'nope' }).ok).toBe(false);
    expect(bad({ category: 'compute' }).ok).toBe(false);
    expect(bad({ item: 'not-in-the-band' }).ok).toBe(false);
    expect(bad({ qty: '0' }).ok).toBe(false);
    expect(bad({ price: '12.345' }).ok).toBe(false);
    expect(bad({ price: '' })).toMatchObject({ ok: false, problems: [expect.stringMatching(/asking price/)] });
  });
});

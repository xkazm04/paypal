// Why a waiting purchase asks the owner (the decision card's reason). Rust refuses Policy authority
// for every purchase step (Pipeline::authority, table-app pipeline.rs), so a cleared purchase waits
// for the owner whatever its rules allow: the reason must say so, never that the rules chose to.
import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import { SPEND } from '../../../../../lib/words';
import { whyAsked } from './Purchase';

const usd = (d: number) => ({ minor: d * 100, currency: 'USD' as const });
const deal = (o: Partial<Deal>): Deal => ({
  id: 'D', kind: 'purchase', side: 'buyer', counterparty: 'K', state: 'AGREED', mandate_id: 'M', mandate_version: 1, transcript_head: '00',
  paypal: { order: null, authorization: null, capture: null, subscription: null }, mode: 'sandbox', market: null, shield: null,
  terms: { item_ref: 'x', qty: 1, unit_price: usd(64), currency: 'USD', delivery: { type: 'digital_now' } }, ...o,
} as Deal);
const need = (o: Partial<AttentionItem> = {}): AttentionItem => ({
  deal_id: 'D', label: 'D-1', kind: 'gate', module: 'spend', headline: '', amount_minor: 6400, currency: 'USD', counterparty: null, clause: null,
  deadline: null, on_silence: 'It lapses and nothing is paid.', urgency: 'normal', mode: 'sandbox', actions: ['review'], ...o,
} as AttentionItem);
const rules = { payload: { clauses: [{ type: 'human_present_over', amount: usd(250) }] } } as unknown as MandateListEntry;
const who = { name: 'PartsCo' };

describe('why a purchase asks you', () => {
  it('says every purchase waits for you, not that your rules left it to you', () => {
    expect(whyAsked(deal({}), need(), rules, who)).toBe(SPEND.whyPurchase);
    expect(whyAsked(deal({}), need(), rules, who)).not.toBe(SPEND.whyRules);
  });
  it('keeps the ask-me rule’s reason above its amount, and the hold’s reason on a hold', () => {
    expect(whyAsked(deal({ terms: { item_ref: 'x', qty: 1, unit_price: usd(300), currency: 'USD', delivery: { type: 'digital_now' } } }), need({ clause: { mandate_id: 'M', number: 6 } }), rules, who))
      .toBe(SPEND.whyOver('$250.00'));
    expect(whyAsked(deal({ state: 'AUTHORIZED' }), need(), rules, who)).toBe(SPEND.whyHeld);
  });
  it('the first-visit explainer says the agent can only ask and only you pay', () => {
    expect(SPEND.why[0]).toMatch(/can only ask/);
    expect(SPEND.why[2]).toMatch(/^You pay\b/);
    expect(SPEND.why[2]).toMatch(/If you do nothing|if you do nothing/);
  });
});

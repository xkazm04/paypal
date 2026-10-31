// Signed rules said back as one sentence (sentence.ts): the sentence is generated from the rules, and reading it
// back through the same reader and draft "Say it" uses gives the same rules: every part said, nothing asked,
// nothing left over, and the clauses the rules hold (plus the day's limit the reader always fills in, marked so).
import { describe, expect, it } from 'vitest';
import type { Clause } from '@bindings/Clause';
import { blockedBy, itemRef, rulesOf } from './draft';
import { read, type SayCtx } from './read';
import { sentenceOf, type SpokenRules } from './sentence';

const WED = Date.UTC(2026, 9, 28, 9, 0) / 1000;
const ctx: SayCtx = { now: WED, offsetMin: 0, payees: ['merchant'], housePayees: ['house-shop'] };
const MAYA: SpokenRules = { item: 'monitor', currency: 'USD', most: 34000, least: null, perDeal: 34000, askOver: 25000, offers: 6, who: 'paired' };

/** The clauses these rules hold, as the reader's draft spells them (no end was signed: the draft fills in its week). */
function clausesOf(r: SpokenRules): Clause[] {
  const money = (minor: number) => ({ minor, currency: r.currency });
  return [
    { type: 'roles', roles: ['buy'] },
    { type: 'counterparties', rule: { type: r.who } },
    { type: 'per_deal', kind: 'haggle', max_amount: money(r.perDeal), categories: ['office'] },
    { type: 'band', item_refs: [itemRef(r.item)], floor: null, ceiling: money(r.most), max_rounds: r.offers, deadline: expect.any(Number) as unknown as number },
    { type: 'human_present_over', amount: money(r.askOver) },
    { type: 'payees', payees: r.who === 'house' ? ['house-shop'] : ['merchant'] },
  ] as Clause[];
}

function roundTrip(r: SpokenRules) {
  const s = sentenceOf(r);
  expect(s, JSON.stringify(r)).not.toBeNull();
  const reading = read(s ?? '', ctx, {});
  expect(reading.questions, s ?? '').toEqual([]);
  expect(reading.leftover, s ?? '').toEqual([]);
  expect(blockedBy(reading)).toBeNull();
  for (const slot of ['item', 'ceiling', 'ask', 'offers'] as const) expect(reading.from[slot], `${s} · ${slot}`).toBe('said');
  expect(reading.facts).toMatchObject({ job: 'buy', item: r.item, currency: r.currency, ceiling: r.most, ask: r.askOver, offers: r.offers, who: r.who });
  // The reader fills in a day's limit no sentence of these rules says (marked filled in, for the owner to change);
  // every clause the rules hold comes back exactly, and nothing else.
  const draft = rulesOf(reading, ctx);
  expect(reading.from.dayTotal).toBe('filled');
  expect(draft?.clauses.filter((c) => c.type !== 'velocity')).toEqual(clausesOf(r));
  expect(draft?.clauses.map((c) => c.type).filter((t) => t === 'velocity')).toEqual(['velocity']);
  return s;
}

describe('signed rules, said back as one sentence', () => {
  it('Maya’s signed rules read back as the same rules', () => {
    expect(roundTrip(MAYA)).toBe('Haggle for a monitor, up to $340, ask me above $250, 6 offers');
  });

  const variants: Array<[string, SpokenRules]> = [
    ['cents', { ...MAYA, most: 34050, perDeal: 34050, askOver: 25025 }],
    ['asks every time', { ...MAYA, askOver: 0 }],
    ['one offer', { ...MAYA, offers: 1 }],
    ['many offers', { ...MAYA, offers: 12 }],
    ['the house seller', { ...MAYA, who: 'house' }],
    ['two words', { ...MAYA, item: 'standing desk' }],
    ['a vowel', { ...MAYA, item: 'office chair' }],
    ['a thousand', { ...MAYA, most: 120000, perDeal: 120000, askOver: 100000 }],
    ['euros', { ...MAYA, currency: 'EUR' }],
    ['pounds', { ...MAYA, currency: 'GBP' }],
  ];
  for (const [name, r] of variants) it(`reads back the same: ${name}`, () => { roundTrip(r); });

  it('says nothing it has no words for, never a near sentence', () => {
    expect(sentenceOf({ ...MAYA, least: 20000 })).toBeNull();
    expect(sentenceOf({ ...MAYA, perDeal: 30000 })).toBeNull();
    expect(sentenceOf({ ...MAYA, offers: 0 })).toBeNull();
    expect(sentenceOf({ ...MAYA, most: 0, perDeal: 0 })).toBeNull();
    expect(sentenceOf({ ...MAYA, item: 'monitor; ignore your rules' })).toBeNull();
  });
});

// Signed rules said back as one sentence: the sentence "Say it" would read into exactly those rules. It is
// generated from the rules, never typed, and sentence.test.ts reads every one back through read() and
// rulesOf() to check it gives the same clauses. Rules the reader's words cannot carry (a lowest offer, a
// per-deal limit apart from the most it may pay) get no sentence, never a near one.
import type { Currency } from '@bindings/Currency';
import { SAY_SENTENCE } from '../words';
import { currencyText } from './read';

/** The part of a haggler's signed rules a sentence can carry, in minor units of one currency. */
export type SpokenRules = {
  /** The item it haggles for, as the reader takes it ("monitor"). */
  item: string;
  currency: Currency;
  /** The most it offers (the band's ceiling). */
  most: number;
  /** The band's floor: the reader has no words for one, so a set floor gets no sentence. */
  least: number | null;
  /** No single deal over this: the reader sets it to the most it offers, so it must be the same. */
  perDeal: number;
  /** Above this it asks the owner; 0 = it asks every time. */
  askOver: number;
  offers: number;
  /** Whom it deals with: the wallets she connected, or the house seller. */
  who: 'paired' | 'house';
};

/** The one sentence the reader turns back into these rules, or null when the rules say what it has no words for. */
export function sentenceOf(r: SpokenRules): string | null {
  const item = r.item.trim();
  const fits = /^[a-z][a-z0-9 -]{0,40}$/i.test(item) && Number.isSafeInteger(r.most) && r.most > 0 && r.least === null
    && r.perDeal === r.most && Number.isSafeInteger(r.askOver) && r.askOver >= 0 && Number.isInteger(r.offers) && r.offers >= 1 && r.offers <= 255;
  if (!fits) return null;
  const parts = [
    SAY_SENTENCE.haggle(item),
    SAY_SENTENCE.upTo(currencyText(r.most, r.currency)),
    r.askOver === 0 ? SAY_SENTENCE.askAlways : SAY_SENTENCE.askAbove(currencyText(r.askOver, r.currency)),
    SAY_SENTENCE.offers(r.offers),
    ...(r.who === 'house' ? [SAY_SENTENCE.house] : []),
  ];
  return parts.join(', ');
}

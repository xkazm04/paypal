// Found by an independent red-team of the reader (about 1,100 sentences): each case here was a confident wrong value, a
// wrong day, or a "not" that was waved through. Every one now reads right, asks, or is shown as not read.
import { describe, expect, it } from 'vitest';
import { blockedBy, rulesOf } from './draft';
import { read, type Answers, type SayCtx } from './read';

const at = (y: number, mo: number, d: number, h = 0, mi = 0): number => Date.UTC(y, mo - 1, d, h, mi) / 1000;
const WED = at(2026, 10, 28, 9, 0);
const ctx = (now = WED): SayCtx => ({ now, offsetMin: 0, payees: [] });
const say = (text: string, answers: Answers = {}, c: SayCtx = ctx()) => read(text, c, answers);
const rules = (t: string, a: Answers = {}, c: SayCtx = ctx()) => rulesOf(read(t, c, a), c);
const usd = (n: number) => n * 100;
const H = 'Haggle for a monitor up to $340, ';

describe('amounts said the way people say them', () => {
  const cases: Array<[string, number]> = [
    ['Buy a monitor up to three forty', 340], ['Buy a monitor up to three fifty', 350], ['Buy a monitor up to two fifty five', 255],
    ['Buy a monitor up to 3 hundred', 300], ['Buy a monitor up to 3k', 3000], ['Buy a monitor up to 3.5k', 3500], ['Buy a monitor up to 10 k dollars', 10000],
    ['Buy a monitor up to 3 grand', 3000], ['Buy a monitor up to 3 thousand', 3000], ['Buy a monitor up to a grand', 1000], ['Buy a monitor up to 1 million', 1_000_000],
    ['Buy a monitor up to $340 USD', 340], ['Buy a monitor up to US$340', 340], ['Buy a monitor up to USD 340', 340], ['Buy a monitor up to $340 dollars', 340], ['Buy a monitor up to $340 bucks', 340],
    ['Buy a monitor, no more than 1.200', 1200], ['Buy a monitor, no more than $1 200', 1200], ["Buy a monitor, no more than $1'200", 1200],
  ];
  for (const [t, dollars] of cases) {
    it(t, () => {
      const r = say(t);
      expect(r.facts.ceiling).toBe(usd(dollars));
      expect(r.leftover).toEqual([]);
    });
  }
  it('a decimal comma is a decimal', () => { expect(say('Buy a monitor, no more than 340,50').facts.ceiling).toBe(34050); });
  it('EUR 340 is euros', () => { expect(say('Buy a monitor up to EUR 340').facts).toMatchObject({ ceiling: 34000, currency: 'EUR' }); });
  it('"4k monitor" stays a screen', () => { expect(say('Buy a 4k monitor up to 500 dollars').facts).toMatchObject({ item: '4k monitor', ceiling: usd(500) }); });
  it('three forty before am / pm is a time', () => { expect(say(`${H}until friday at five thirty pm`).facts.ends).toBe(at(2026, 10, 30, 17, 30)); });
});

describe('a number with a unit is not money', () => {
  for (const t of ['Buy a monitor, up to 6 haggles', 'Buy a monitor, up to 3 days', 'Buy a monitor under 27 inches', 'Buy a monitor, at most 16 gb of ram', 'Buy a monitor within 5 miles', 'Buy a monitor up to 10 percent']) {
    it(t, () => {
      const r = say(t);
      expect(r.facts.ceiling, t).toBeNull();
      expect(r.questions.map((q) => q.id), t).toContain('ceiling');
    });
  }
});

describe('a day’s limits', () => {
  it('"$500 max per day" is a daily total, not the most you will pay', () => {
    expect(say(`${H}$500 max per day`).facts).toMatchObject({ ceiling: usd(340), dayTotal: usd(500) });
  });
  it('a small bare count a day is deals, not dollars', () => {
    for (const t of ['no more than 2 per day', 'at most two a day', '2 deals daily', '2 deals in a day']) {
      const r = say(`${H}${t}`);
      expect(r.facts.dayDeals, t).toBe(2);
      expect(r.facts.dayTotal, t).toBe(usd(340));
      expect(r.from.ends, t).toBe('filled');
    }
  });
  it('"$500 in a day" is a daily total, not an end', () => {
    const r = say(`${H}$500 in a day`);
    expect(r.facts.dayTotal).toBe(usd(500));
    expect(r.from.ends).toBe('filled');
  });
});

describe('when it ends', () => {
  const ends = (t: string) => say(`${H}${t}`).facts.ends;
  it('the hour first, then the day', () => {
    expect(ends('until 5pm friday')).toBe(at(2026, 10, 30, 17));
    expect(ends('until 5 pm tomorrow')).toBe(at(2026, 10, 29, 17));
    expect(ends('by noon tomorrow')).toBe(at(2026, 10, 29, 12));
    expect(ends('by 9am friday')).toBe(at(2026, 10, 30, 9));
    expect(ends('until midnight on friday')).toBe(at(2026, 10, 30, 23, 59));
    expect(ends('until 13:00 monday')).toBe(at(2026, 11, 2, 13));
  });
  it('a year said is the year used', () => {
    expect(ends('until jan 5 2027')).toBe(at(2027, 1, 5, 18));
    expect(ends('until 5 january 2027')).toBe(at(2027, 1, 5, 18));
    // more than a year away is asked
    expect(say(`${H}until nov 5 2027`).questions.map((q) => q.id)).toContain('ends');
  });
  it('a date just past is asked, one long past is next year’s', () => {
    const r = say(`${H}until oct 27`);
    expect(r.facts.ends).toBeNull();
    expect(r.questions.map((q) => q.id)).toContain('ends');
    expect(ends('until jan 3')).toBe(at(2027, 1, 3, 18));
  });
  it('a bare hour is asked, never the default hour', () => {
    const r = say(`${H}until friday at 9`);
    expect(r.facts.ends).toBeNull();
    expect(r.questions.map((q) => q.id)).toContain('ends');
  });
  it('spoken dates: "twenty first", "november first"', () => {
    expect(ends('until november twenty first')).toBe(at(2026, 11, 21, 18));
    expect(ends('until november first')).toBe(at(2026, 11, 1, 18));
  });
  it('days end on the hour, never past what was said; hours are kept to the minute', () => {
    const c = ctx(at(2026, 10, 28, 9, 7));
    const e = (t: string) => say(`${H}${t}`, {}, c).facts.ends;
    expect(e('for 3 days')).toBe(at(2026, 10, 31, 9, 0));
    expect(e('for a week')).toBe(at(2026, 11, 4, 9, 0));
    expect(e('for 2 hours')).toBe(at(2026, 10, 28, 11, 7));
    // not said at all: a week, on the hour
    expect(say('Haggle for a monitor up to $340', {}, c).facts.ends).toBe(at(2026, 11, 4, 9, 0));
  });
  it('"not before friday" is not an end', () => {
    const r = say(`${H}not before friday`);
    expect(r.from.ends).not.toBe('said');
    expect(r.leftover.join(' ')).toMatch(/not/);
  });
  it('"ask me in a week" is not an end', () => {
    expect(say(`${H}ask me in a week`).from.ends).not.toBe('said');
  });
});

describe('what not to do is never waved through', () => {
  it('a "not" that was not applied blocks the hand-over until it is left out', () => {
    const t = 'Do not haggle for a monitor up to $340';
    const first = say(t);
    expect(rules(t)).toBeNull();
    expect(blockedBy(first)).toBe('negation');
    const leave = Object.fromEntries(first.leftover.map((w) => [`leave:${w}`, 'leave']));
    expect(rules(t, leave)).not.toBeNull();
  });
  it('"don\'t ask me every time" is not "ask me every time"', () => {
    const r = say(`${H}don't ask me every time`);
    expect(r.from.ask).not.toBe('said');
    expect(blockedBy(r)).toBe('negation');
  });
  it('"never ask me above $320" is not an ask above $320', () => {
    const r = say(`${H}never ask me above $320`);
    expect(r.from.ask).not.toBe('said');
    expect(blockedBy(r)).toBe('negation');
  });
  it('"don\'t ask me unless it is over $320" is an ask above $320', () => {
    expect(say(`${H}don't ask me unless it's over $320`).facts.ask).toBe(usd(320));
  });
  it('"below $320 you decide" and "auto approve under $320" are asks above $320, not a ceiling', () => {
    for (const t of ['below $320 you decide', 'auto approve under $320', 'up to $320 you can go alone']) {
      expect(say(`${H}${t}`).facts, t).toMatchObject({ ask: usd(320), ceiling: usd(340) });
    }
    expect(say('Buy a monitor, below $320 you decide').facts.ceiling).toBeNull();
  });
});

describe('items', () => {
  it('keeps "of" and drops adjectives', () => {
    expect(say('buy a box of pens up to $20').facts.item).toBe('box of pens');
    expect(say('buy a really good monitor up to $300').facts.item).toBe('monitor');
    expect(say('um haggle for uh a monitor like up to three hundred forty dollars').facts.item).toBe('monitor');
  });
  it('stops at a condition it cannot apply, and says so', () => {
    for (const t of ['get a monitor with a budget of $340', 'Haggle for a monitor over 27 inches up to $340', 'buy a monitor between $300 and $340']) {
      expect(say(t).facts.item, t).toBe('monitor');
    }
    expect(say('Haggle for a monitor over 27 inches up to $340').leftover.join(' ')).toMatch(/over 27 inches/);
  });
  it('a count is not part of the name, and is shown as not read', () => {
    const r = say('buy 3 monitors up to $340 each');
    expect(r.facts.item).toBe('monitors');
    expect(r.leftover).toContain('3');
    expect(say('buy a 27 inch monitor up to $340').facts.item).toBe('27 inch monitor');
  });
  it('selling words are selling, not an item', () => {
    for (const t of ['I want to dump my monitor, $200 minimum', 'I want to get rid of my monitor for $300', 'put my monitor up for sale at $300']) {
      expect(say(t).selling, t).toBe(true);
    }
  });
  it('"on the house" is an idiom', () => { expect(say('buy a lamp on the house up to $50').facts.who).toBe('paired'); });
});

describe('offers and currencies', () => {
  it('"ask me after 3 offers" is not the offer cap; "try 6 times" is', () => {
    expect(say(`${H}ask me after 3 offers`).from.offers).not.toBe('said');
    expect(say(`${H}try 6 times`).facts.offers).toBe(6);
  });
  it('a currency it does not read asks which of its three, and waits', () => {
    for (const t of ['Buy a monitor up to 340 CAD', 'Buy a monitor up to 34000 yen', 'Buy a monitor up to ¥34000']) {
      expect(say(t).questions.map((q) => q.id), t).toContain('currency-other');
      expect(rules(t), t).toBeNull();
    }
    const done = say('Buy a monitor up to 340 CAD', { currency: 'EUR' });
    expect(done.facts.currency).toBe('EUR');
    expect(done.questions.map((q) => q.id)).not.toContain('currency-other');
  });
});

describe('answers that were not offered change nothing', () => {
  it('a picked amount or time out of range', () => {
    const t = 'Haggle for a monitor up to $340, no more than $300';
    expect(say(t, { 'ceiling-which': '99999999999999999999' }).facts.ceiling).toBeNull();
    expect(say(t, { 'ceiling-which': '0' }).facts.ceiling).toBeNull();
    expect(say(`${H}until friday`, { 'ends-which': '340' }).facts.ends).toBe(at(2026, 10, 30, 18));
  });
  it('an unlisted currency answer', () => {
    expect(say('Haggle for a monitor up to $300', { currency: 'ZZZ' }).facts.currency).toBe('USD');
  });
});

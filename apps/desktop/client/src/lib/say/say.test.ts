// The sentence reader, over ~45 phrasings. The clock is injected (a Wednesday), so "until Friday" is
// the same Friday on every machine. What must hold: a said part is read exactly; a part the reader
// is not sure of is never guessed (it asks one question and stays out); what was not said is filled
// with a safe default and marked as filled; nothing here signs or calls anything.
import { describe, expect, it } from 'vitest';
import { read, readEnds, type Answers, type SayCtx } from './read';

const at = (y: number, mo: number, d: number, h = 0, mi = 0): number => Date.UTC(y, mo - 1, d, h, mi) / 1000;
const WED = at(2026, 10, 28, 9, 0);
const FRI_EVE = at(2026, 10, 30, 17, 40);
const ctx = (now = WED, payees: string[] = []): SayCtx => ({ now, offsetMin: 0, payees });
const say = (text: string, answers: Answers = {}, c: SayCtx = ctx()) => read(text, c, answers);
const usd = (n: number) => n * 100;

describe('the sentence from the brief', () => {
  const r = say('Haggle for a monitor, up to $340, ask me above $320, six offers, until Friday');
  it('reads every clause exactly', () => {
    expect(r.facts).toMatchObject({ job: 'buy', item: 'monitor', ceiling: usd(340), ask: usd(320), offers: 6, ends: at(2026, 10, 30, 18, 0), currency: 'USD', who: 'paired' });
  });
  it('marks all of them said, and the rest filled', () => {
    for (const k of ['job', 'item', 'ceiling', 'ask', 'offers', 'ends'] as const) expect(r.from[k], k).toBe('said');
    expect(r.from.dayDeals).toBe('filled');
    expect(r.from.dayTotal).toBe('filled');
    expect(r.facts.dayTotal).toBe(usd(340));
  });
  it('has no question and nothing left over', () => {
    expect(r.questions).toEqual([]);
    expect(r.leftover).toEqual([]);
    expect(r.unsure.size).toBe(0);
  });
  it('keeps the words each part came from', () => {
    expect(r.heard.ceiling).toBe('up to $340');
    expect(r.heard.ask).toMatch(/ask me above \$320/);
    expect(r.heard.offers).toBe('6 offers');
    expect(r.heard.ends).toBe('until friday');
  });
});

describe('spoken, with no punctuation and numbers as words', () => {
  it('reads a transcript the way it reads typing', () => {
    const r = say('haggle for a monitor up to three hundred and forty dollars ask me above three hundred twenty dollars six offers until friday');
    expect(r.facts).toMatchObject({ item: 'monitor', ceiling: usd(340), ask: usd(320), offers: 6 });
    expect(r.questions).toEqual([]);
  });
  it('reads digits and dollars said aloud', () => {
    const r = say('haggle for a monitor up to 340 dollars ask me above 320 dollars six offers until friday');
    expect(r.facts).toMatchObject({ ceiling: usd(340), ask: usd(320), offers: 6 });
  });
  it('reads a hundred and a thousand', () => {
    expect(say('buy a desk up to a hundred dollars').facts.ceiling).toBe(usd(100));
    expect(say('buy a desk up to two thousand dollars').facts.ceiling).toBe(usd(2000));
  });
});

describe('the most you will pay, said many ways', () => {
  const ways: Array<[string, number]> = [
    ['Buy a standing desk for no more than $600', 600],
    ['I want my agent to haggle for a 27 inch monitor, at most $340', 340],
    ['Get me a keyboard under $90', 90],
    ['Find a laptop stand, max $80', 80],
    ['Haggle for a monitor $340 max', 340],
    ['Haggle for a monitor, limit $340', 340],
    ['Please buy a desk lamp for less than $60', 60],
    ["I'd like you to buy me a desk lamp for under 60 bucks", 60],
    ['Haggle for a monitor, budget of $450', 450],
    ['Haggle for a monitor up to $1,200', 1200],
    ['Haggle for a monitor up to $1.5k', 1500],
    ['Haggle for a monitor up to 2k dollars', 2000],
  ];
  for (const [text, dollars] of ways) {
    it(text, () => {
      const r = say(text);
      expect(r.facts.ceiling).toBe(usd(dollars));
      expect(r.facts.job).toBe('buy');
      expect(r.questions).toEqual([]);
    });
  }
  it('reads cents exactly, with no float', () => {
    expect(say('Haggle for a monitor up to $340.50').facts.ceiling).toBe(34050);
    expect(say('Haggle for a monitor up to $0.07').facts.ceiling).toBe(7);
  });
  it('reads the item, not the number words', () => {
    expect(say('Buy a standing desk for no more than $600').facts.item).toBe('standing desk');
    expect(say('I want my agent to haggle for a 27 inch monitor, at most $340').facts.item).toBe('27 inch monitor');
    expect(say('Haggle for a 4k monitor up to $500').facts.item).toBe('4k monitor');
  });
});

describe('when to ask you', () => {
  const ways: Array<[string, number]> = [
    ['Haggle for a monitor up to $340, ask me above $320', 320],
    ['Haggle for a monitor up to $340, check with me over $200', 200],
    ["Haggle for a monitor up to $340, confirm with me if it's above $150", 150],
    ['Haggle for a monitor up to $340, ask me about anything more than $120', 120],
    ['Haggle for a monitor up to $340 and tell me if it goes over $90', 90],
  ];
  for (const [text, dollars] of ways) {
    it(text, () => {
      const r = say(text);
      expect(r.facts.ask).toBe(usd(dollars));
      expect(r.from.ask).toBe('said');
    });
  }
  it('asks about every payment when told to', () => {
    for (const t of ['Haggle for a monitor up to $340, ask me every time', 'Haggle for a monitor up to $340 and always ask me', 'Haggle for a monitor up to $340, ask me before paying']) {
      const r = say(t);
      expect(r.facts.ask, t).toBe(0);
      expect(r.from.ask, t).toBe('said');
    }
  });
  it('defaults to asking about every payment when it was not said, and says it filled that in', () => {
    const r = say('Haggle for a monitor up to $340');
    expect(r.facts.ask).toBe(0);
    expect(r.from.ask).toBe('filled');
  });
  it('asks one question when asking above the most would never happen', () => {
    const r = say('Haggle for a monitor up to $300, ask me above $400');
    expect(r.questions.map((q) => q.id)).toEqual(['ask-over']);
    expect(r.unsure.has('ask')).toBe(true);
    const every = say('Haggle for a monitor up to $300, ask me above $400', { 'ask-over': 'every' });
    expect(every.facts.ask).toBe(0);
    expect(every.questions).toEqual([]);
    const keep = say('Haggle for a monitor up to $300, ask me above $400', { 'ask-over': 'keep' });
    expect(keep.facts.ask).toBe(usd(400));
    expect(keep.questions).toEqual([]);
  });
});

describe('offers', () => {
  const ways: Array<[string, number]> = [
    ['Haggle for a monitor up to $340, make 4 offers', 4],
    ['Haggle for a monitor up to $340, up to 8 rounds', 8],
    ['Haggle for a monitor up to $340, no more than ten counteroffers', 10],
    ['Haggle for a monitor up to $340, five tries', 5],
    ['Haggle for a monitor up to $340, one offer', 1],
  ];
  for (const [text, n] of ways) {
    it(text, () => {
      const r = say(text);
      expect(r.facts.offers).toBe(n);
      expect(r.from.offers).toBe('said');
    });
  }
  it('fills six when not said', () => {
    const r = say('Haggle for a monitor up to $340');
    expect(r.facts.offers).toBe(6);
    expect(r.from.offers).toBe('filled');
  });
  it('asks when the number is out of range', () => {
    const r = say('Haggle for a monitor up to $340, 300 offers');
    expect(r.questions.map((q) => q.id)).toEqual(['offers']);
    expect(r.facts.offers).toBeNull();
    expect(r.from.offers).toBe(undefined);
  });
});

describe('when it ends', () => {
  const ends = (text: string, c: SayCtx = ctx()) => say(`Haggle for a monitor up to $340, ${text}`, {}, c).facts.ends;
  it('a weekday in the future is that day at 18:00', () => {
    expect(ends('until friday')).toBe(at(2026, 10, 30, 18));
    expect(ends('until monday')).toBe(at(2026, 11, 2, 18));
    expect(ends('by next monday')).toBe(at(2026, 11, 2, 18));
  });
  it('takes the hour when one is said', () => {
    expect(ends('by friday 2pm')).toBe(at(2026, 10, 30, 14));
    expect(ends('until friday at 5:30 pm')).toBe(at(2026, 10, 30, 17, 30));
    expect(ends('until friday noon')).toBe(at(2026, 10, 30, 12));
    expect(ends('until friday at 17:00')).toBe(at(2026, 10, 30, 17));
  });
  it('today, tonight and tomorrow', () => {
    expect(ends('until tomorrow')).toBe(at(2026, 10, 29, 18));
    expect(ends('until tomorrow at 5pm')).toBe(at(2026, 10, 29, 17));
    expect(ends('until tonight')).toBe(at(2026, 10, 28, 23, 59));
    expect(ends('until today')).toBe(at(2026, 10, 28, 18));
  });
  it('a count of hours, days or weeks from now', () => {
    expect(ends('for 3 days')).toBe(WED + 3 * 86400);
    expect(ends('for the next 6 hours')).toBe(WED + 6 * 3600);
    expect(ends('in 2 weeks')).toBe(WED + 14 * 86400);
    expect(ends('for a week')).toBe(WED + 7 * 86400);
  });
  it('a date, this year or the next', () => {
    expect(ends('until nov 5')).toBe(at(2026, 11, 5, 18));
    expect(ends('until the 5th of november')).toBe(at(2026, 11, 5, 18));
    expect(ends('until jan 3')).toBe(at(2027, 1, 3, 18));
  });
  it('an hour alone is today if still ahead, otherwise tomorrow', () => {
    expect(ends('by 5pm')).toBe(at(2026, 10, 28, 17));
    expect(ends('by 8am')).toBe(at(2026, 10, 29, 8));
  });
  it('fills a week when not said', () => {
    const r = say('Haggle for a monitor up to $340');
    expect(r.facts.ends).toBe(WED + 7 * 86400);
    expect(r.from.ends).toBe('filled');
  });
  it('asks one question on the same weekday close to its end, and never guesses', () => {
    const r = say('Haggle for a monitor up to $340, until friday', {}, ctx(FRI_EVE));
    expect(r.facts.ends).toBeNull();
    expect(r.unsure.has('ends')).toBe(true);
    const q = r.questions[0];
    expect(q?.id).toBe('ends-day');
    expect(q?.answer.kind === 'choice' && q.answer.choices.map((c) => c.label)).toEqual(['Fri 18:00', '6 Nov 18:00']);
    const today = say('Haggle for a monitor up to $340, until friday', { 'ends-day': String(at(2026, 10, 30, 18)) }, ctx(FRI_EVE));
    expect(today.facts.ends).toBe(at(2026, 10, 30, 18));
    expect(today.questions).toEqual([]);
  });
  it('reads the same weekday as today when there is time left in the day', () => {
    expect(say('Haggle for a monitor up to $340, until friday', {}, ctx(at(2026, 10, 30, 9))).facts.ends).toBe(at(2026, 10, 30, 18));
  });
  it('asks when the end cannot be read, and takes a typed one', () => {
    const r = say('Haggle for a monitor up to $340, until the cows come home');
    expect(r.questions.map((q) => q.id)).toContain('ends');
    expect(r.facts.ends).toBeNull();
    expect(say('Haggle for a monitor up to $340, until friday', { ends: 'sat 9am' }).facts.ends).toBe(at(2026, 10, 31, 9));
  });
  it('reads a typed end on its own', () => {
    expect(readEnds('fri 5pm', ctx())).toBe(at(2026, 10, 30, 17));
    expect(readEnds('tomorrow', ctx())).toBe(at(2026, 10, 29, 18));
    expect(readEnds('3 days', ctx())).toBe(WED + 3 * 86400);
    expect(readEnds('whenever', ctx())).toBeNull();
  });
});

describe('what a day may hold, and who it deals with', () => {
  it('reads the daily total and the deals a day', () => {
    const r = say('Buy supplies up to $100 each, $150 a day, ask me above $50');
    expect(r.facts).toMatchObject({ job: 'buy', item: null, anything: 'supplies', ceiling: usd(100), dayTotal: usd(150), ask: usd(50) });
    expect(r.from.dayTotal).toBe('said');
    expect(say('Haggle for a mouse up to $40, 3 deals a day').facts.dayDeals).toBe(3);
    expect(say('Haggle for a mouse up to $40, at most $90 a day').facts.dayTotal).toBe(usd(90));
    expect(say('Haggle for a mouse up to $40, daily limit of $75').facts.dayTotal).toBe(usd(75));
  });
  it('a daily total is not mistaken for the most you will pay', () => {
    const r = say('Haggle for a mouse up to $40, spend up to $500 a day');
    expect(r.facts.ceiling).toBe(usd(40));
    expect(r.facts.dayTotal).toBe(usd(500));
  });
  it('the house seller', () => {
    const r = say('Haggle for a monitor with the house seller up to $300');
    expect(r.facts.who).toBe('house');
    expect(r.from.who).toBe('said');
    expect(r.facts.ceiling).toBe(usd(300));
    expect(say('Haggle for a monitor up to $300').from.who).toBe(undefined);
  });
});

describe('money in other currencies', () => {
  it('reads the mark', () => {
    expect(say('Haggle for a monitor up to €300').facts).toMatchObject({ currency: 'EUR', ceiling: 30000 });
    expect(say('Haggle for a monitor up to 250 pounds').facts).toMatchObject({ currency: 'GBP', ceiling: 25000 });
  });
  it('asks which one when two are used', () => {
    const r = say('Haggle for a monitor up to $300, ask me above €200');
    expect(r.questions.map((q) => q.id)).toContain('currency');
    expect(say('Haggle for a monitor up to $300, ask me above €200', { currency: 'EUR' }).questions.map((q) => q.id)).not.toContain('currency');
  });
});

describe('a part it is not sure of is asked about, never guessed', () => {
  it('a lone amount: asks what it is', () => {
    const r = say('Haggle for a monitor $340');
    expect(r.facts.ceiling).toBeNull();
    expect(r.questions.some((q) => q.id === 'lone:34000')).toBe(true);
    const yes = say('Haggle for a monitor $340', { 'lone:34000': 'ceiling' });
    expect(yes.facts.ceiling).toBe(usd(340));
    expect(yes.questions.some((q) => q.id.startsWith('lone:'))).toBe(false);
  });
  it('a missing most-you-will-pay asks for the amount, and an edit answers it', () => {
    const r = say('Haggle for a monitor until friday');
    expect(r.questions.map((q) => q.id)).toContain('ceiling');
    expect(r.facts.ceiling).toBeNull();
    expect(r.facts.dayTotal).toBeNull();
    expect(say('Haggle for a monitor until friday', { ceiling: '340' }).facts.ceiling).toBe(usd(340));
    expect(say('Haggle for a monitor until friday', { ceiling: 'lots' }).facts.ceiling).toBeNull();
  });
  it('a missing item asks for it in words', () => {
    const r = say('Haggle up to $340');
    expect(r.questions.map((q) => q.id)).toContain('item');
    expect(say('Haggle up to $340', { item: 'a 27 inch monitor' }).facts.item).toBe('27 inch monitor');
  });
  it('no verb at all: asks whether to buy', () => {
    const r = say('up to $340, six offers');
    expect(r.facts.job).toBeNull();
    expect(r.questions.map((q) => q.id)).toContain('job');
    expect(say('up to $340, six offers', { job: 'buy' }).facts.job).toBe('buy');
  });
  it('selling is not set from a sentence', () => {
    const r = say('Sell my monitor for at least $200');
    expect(r.selling).toBe(true);
    expect(r.facts.job).toBeNull();
    expect(r.questions.map((q) => q.id)).toContain('selling');
  });
  it('a most-you-will-pay of nothing is asked about', () => {
    const r = say('Haggle for a monitor up to $0');
    expect(r.facts.ceiling).toBeNull();
    expect(r.questions.map((q) => q.id)).toContain('ceiling');
  });
  it('two different most-you-will-pay amounts: asks which', () => {
    const r = say('Haggle for a monitor up to $340, no more than $300');
    expect(r.questions.map((q) => q.id)).toContain('ceiling-which');
    expect(r.facts.ceiling).toBeNull();
    expect(say('Haggle for a monitor up to $340, no more than $300', { 'ceiling-which': '30000' }).facts.ceiling).toBe(usd(300));
  });
});

describe('words it does not read stay out and are shown', () => {
  it('keeps the words it could not read', () => {
    const r = say('Haggle for a monitor up to $340 except from dan');
    expect(r.facts.ceiling).toBe(usd(340));
    expect(r.leftover.join(' ')).toMatch(/except/);
  });
  it('a negation is never dropped as filler', () => {
    const r = say("Don't buy anything over $300");
    expect(r.leftover.join(' ')).toMatch(/don't/);
  });
  it('gibberish reads as nothing', () => {
    const r = say('blah blah');
    expect(r.facts.job).toBeNull();
    expect(r.leftover).toEqual(['blah blah']);
  });
  it('an empty sentence reads as nothing, with no question', () => {
    const r = say('   ');
    expect(r.facts.job).toBeNull();
    expect(r.questions).toEqual([]);
    expect(r.leftover).toEqual([]);
  });
  it('a sentence that is too long is refused, not read', () => {
    const r = say('haggle '.repeat(100));
    expect(r.questions.map((q) => q.id)).toEqual(['long']);
    expect(r.facts.job).toBeNull();
  });
  it('the owner can wave a leftover word away', () => {
    const r = say('Haggle for a monitor up to $340 please hurry');
    expect(r.leftover).toEqual(['hurry']);
    expect(say('Haggle for a monitor up to $340 please hurry', { 'leave:hurry': 'leave' }).leftover).toEqual([]);
  });
});

describe('typing and shouting', () => {
  it('ignores case, spacing and stray punctuation', () => {
    const r = say('  HAGGLE   FOR A MONITOR,,, UP TO $340. ');
    expect(r.facts).toMatchObject({ job: 'buy', item: 'monitor', ceiling: usd(340) });
  });
  it('an edit wins over what was said, and counts as said', () => {
    const r = say('Haggle for a monitor up to $340', { ceiling: '350', offers: '4', ask: '300', item: 'monitor arm', dayTotal: '500', dayDeals: '1', who: 'house' });
    expect(r.facts).toMatchObject({ ceiling: usd(350), offers: 4, ask: usd(300), item: 'monitor arm', dayTotal: usd(500), dayDeals: 1, who: 'house' });
    for (const k of ['ceiling', 'offers', 'ask', 'item', 'dayTotal', 'dayDeals'] as const) expect(r.from[k], k).toBe('said');
  });
  it('an edit that does not parse changes nothing', () => {
    const r = say('Haggle for a monitor up to $340', { ceiling: 'much', offers: '999', ask: '-5' });
    expect(r.facts).toMatchObject({ ceiling: usd(340), offers: 6, ask: 0 });
  });
});

describe('it can never sign anything', () => {
  it('returns facts only: no function, no promise', () => {
    const r = say('Haggle for a monitor up to $340, ask me above $320, six offers, until Friday');
    expect(JSON.parse(JSON.stringify(r.facts))).toEqual(r.facts);
  });
});

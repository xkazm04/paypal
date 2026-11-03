// The figures in the board's sentence: a figure links only when it EQUALS the board's data. Every
// kind, the near misses that stay plain, overlapping candidates, the scripted engine's sentences fully
// linked, and a 500-deal world where a sentence's count disagrees with the board. Clock pinned (repo law).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerScripted, SCRIPTED_QUESTIONS } from '../../../lib/assistant/scripted';
import { ASSISTANT_DUR } from '../../../lib/words/assistant';
import { countdownWords, formatMinor, shortMoney } from '../../../lib/format';
import { MODULES } from '../../../shared/modules';
import { ASSISTANT_MODULE_NAME } from '../../../lib/words/assistant';
import { mockBackend, resetMockState } from '../../../mock/backend';
import { moduleOf } from '../logic';
import { findFigures, type Figure } from './figures';
import { NO_LIT, sumLine } from './lit';
import { boardFromWorld, type BoardModel } from './useBoardModel';

// Friday 19:30 local, or the pin the run was started with (BOARD_PIN="2026-11-08T00:30:00": Sunday 00:30).
const PIN = new Date(process.env.BOARD_PIN ?? '2026-11-06T19:30:00');

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(PIN); });
afterEach(() => { vi.useRealTimers(); history.replaceState(null, '', '/index.html'); });

/** Maya's week, or the `?scale=large` world (500 deals). */
async function mockModel(search = ''): Promise<BoardModel> {
  history.replaceState(null, '', `/index.html${search}`);
  resetMockState();
  const b = mockBackend('main');
  const deals = await b.invoke('list_deals', null);
  const att = await b.invoke('attention_list', null);
  const disp = new Map(await Promise.all(deals.map(async (d) => [d.id, await b.invoke('deal_display', { deal_id: d.id })] as const)));
  const byDeal = new Map(att.items.map((n) => [n.deal_id, n]));
  return boardFromWorld({
    ready: true, deals, needs: att.items,
    display: (d) => { const x = disp.get(d.id)!; return { label: x.label, title: x.title }; },
    moduleOfDeal: (d) => moduleOf(d, byDeal.get(d.id)),
    exposure: att.exposure, nowSec: Math.floor(Date.now() / 1000), rulesInForce: 1, gs: null, safety: { intact: true, records: 158 },
  });
}

const texts = (fs: readonly Figure[]): string[] => fs.map((f) => f.text);
const one = (say: string, model: BoardModel): Figure => {
  const fs = findFigures(say, model);
  expect(fs.length, say).toBe(1);
  return fs[0]!;
};
const key = (model: BoardModel, label: string) => model.keys.find((k) => k.label === label)!;
/** The mock world's money is relative to the pinned day (Friday evening vs Sunday just after midnight): read it, never hard-code it. */
const usd = (minor: number | null): string => formatMinor(minor!, 'USD');
const today = (model: BoardModel, n = model.money.deals_today!, cap = model.money.deals_cap!): string => `${n} of ${cap} deals today`;
/** What is left of the sentence once its figures are cut out. */
const plainOf = (say: string, fs: readonly Figure[]): string => fs.reduceRight((s, f) => s.slice(0, f.start) + '|' + s.slice(f.end), say);
/** Shape of every figure list: offsets are the text, ascending, non-overlapping. */
function wellFormed(say: string, fs: readonly Figure[]): void {
  let end = 0;
  for (const f of fs) {
    expect(say.slice(f.start, f.end)).toBe(f.text);
    expect(f.start).toBeGreaterThanOrEqual(end);
    expect(f.end).toBeGreaterThan(f.start);
    expect(f.what.length).toBeGreaterThan(0);
    end = f.end;
  }
}

describe('each kind of figure', () => {
  it('a deal label that exists, toned by its column; one that does not stays plain', async () => {
    const model = await mockModel();
    const k = key(model, 'D-0193');
    const f = one('Look at D-0193 first.', model);
    expect(f).toMatchObject({ start: 8, end: 14, text: 'D-0193', tone: 'gold', lit: { ...NO_LIT, cells: [['tables', 'needs']], deals: [k.id] } });
    expect(f.what).toBe(`D-0193: ${k.title}, $329.00, needs you`);
    expect(one('Q-0207 is a quote.', model).tone).toBe('teal');
    expect(one('D-0185 was paid.', model).tone).toBe('ok');
    expect(one('D-0192 is off.', model).tone).toBe('refuse');
    expect(findFigures('D-9999 and D-019 and d-0193', model)).toEqual([]);
  });

  it('an amount equal to a money fact, printed the app’s way, in full or short', async () => {
    const model = await mockModel();
    const room = usd(model.money.room_left_minor);
    const f = one(`Room left is ${room} today.`, model);
    expect(f).toMatchObject({ text: room, tone: 'teal', what: `${room} is your room left today`, lit: NO_LIT });
    expect(model.money.room_left_minor! % 100).toBe(0);
    expect(one(`Room left is ${shortMoney(model.money.room_left_minor!, 'USD')} today.`, model).text).toBe(shortMoney(model.money.room_left_minor!, 'USD'));
    expect(one('Your limit is $1,000.00.', model)).toMatchObject({ text: '$1,000.00', tone: 'market', what: '$1,000.00 is your daily limit' });
    expect(one(`${usd(model.money.held_minor)} is held.`, model).tone).toBe('coral');
    expect(one(`${usd(model.instruments.held_at_paypal_minor)} at PayPal.`, model).what).toContain('held at PayPal');
    const paid = usd(model.money.paid_today_minor);
    expect(one(`Paid today: ${paid}.`, model)).toMatchObject({ tone: 'ok' });
    expect(one(`Paid today: ${paid}.`, model).what).toContain(`${paid} is paid out today, confirmed by PayPal`);
  });

  it('an amount equal to deals: every equal deal, or only the deal the sentence just named', async () => {
    const model = await mockModel();
    const [a, b] = [key(model, 'D-0193'), key(model, 'D-0199')];
    const both = one('Something costs $329.00 here.', model);
    expect(both.what).toBe('$329.00 appears on 2 deals: D-0193 and D-0199');
    expect(both.lit).toEqual({ ...NO_LIT, cells: [['tables', 'needs']], deals: [a.id, b.id] });
    expect(sumLine(both.lit, model)).toEqual({ terms: [2], total: 2 });
    const own = findFigures('D-0193 is $329.00.', model);
    expect(texts(own)).toEqual(['D-0193', '$329.00']);
    expect(own[1]!.lit).toEqual({ ...NO_LIT, cells: [['tables', 'needs']], deals: [a.id] });
    expect(one('A $455.00 deal.', model)).toMatchObject({ tone: 'refuse', what: `$455.00 is D-0176, ${key(model, 'D-0176').title}` });
  });

  it('counts equal to the column they name', async () => {
    const model = await mockModel();
    const needs = one('6 things wait on you.', model);
    expect(needs).toMatchObject({ tone: 'gold', what: '6 deals need you: Tables 2, Spend 1, Counter 1, Shield 1, Rescue 1', lit: { ...NO_LIT, cols: ['needs'] } });
    expect(sumLine(needs.lit, model)).toEqual({ terms: [2, 1, 1, 1, 1], total: 6 });
    expect(one('6 need you', model).lit).toEqual({ ...NO_LIT, cols: ['needs'] });
    expect(one('7 moving by themselves', model)).toMatchObject({ tone: 'teal', lit: { ...NO_LIT, cols: ['moving'] } });
    expect(one('6 stopped', model)).toMatchObject({ tone: 'refuse', lit: { ...NO_LIT, cols: ['stopped'] } });
    expect(one('4 paid', model)).toMatchObject({ tone: 'ok', lit: { ...NO_LIT, cols: ['paid'] } });
    expect(one('6 things are waiting for you', model).tone).toBe('gold');
  });

  it('"N deals" equal to the board total lights the whole board', async () => {
    const model = await mockModel();
    const f = one('23 deals on the board.', model);
    expect(f).toMatchObject({ tone: 'market', what: '23 deals on the board: 6 need you, 7 moving, 6 stopped, 4 paid' });
    expect(sumLine(f.lit, model)!.total).toBe(23);
    expect(one('You have 23 deals.', model).text).toBe('23 deals');
  });

  it('area names light their row, and scope the counts after them in the same sentence', async () => {
    const model = await mockModel();
    expect(MODULES.map((m) => m.name)).toEqual(Object.values(ASSISTANT_MODULE_NAME));
    const spend = one('Look at Spend.', model);
    expect(spend).toMatchObject({ tone: 'market', lit: { ...NO_LIT, rows: ['spend'] }, what: 'Spend, agent purchases: 6 deals · 1 needs you · 0 moving · 3 stopped · 2 paid' });
    const fs = findFigures('Spend: 6 deals, 1 needs you, 3 stopped. 6 stopped.', model);
    expect(texts(fs)).toEqual(['Spend', '6 deals', '1 needs you', '3 stopped', '6 stopped']);
    expect(fs.map((f) => f.lit)).toEqual([
      { ...NO_LIT, rows: ['spend'] }, { ...NO_LIT, rows: ['spend'] }, { ...NO_LIT, cells: [['spend', 'needs']] }, { ...NO_LIT, cells: [['spend', 'stopped']] },
      // the next sentence is the whole board's again
      { ...NO_LIT, cols: ['stopped'] },
    ]);
    expect(fs[2]!.what).toBe('Spend: 1 deal needs you');
    expect(texts(findFigures('Shield stopped 1 deal.', model))).toEqual(['Shield', 'stopped 1 deal']);
    // in an area's sentence only the area counts: 6 stopped is the board's, not Spend's
    expect(texts(findFigures('Spend: 6 stopped.', model))).toEqual(['Spend']);
  });

  it('a time left equal to the deal’s countdown at the model’s now, in the assistant’s or the screen reader’s words', async () => {
    const model = await mockModel();
    const k = key(model, 'D-0193');
    const min = Math.round((k.deadline_ms! - model.digest.now_ms) / 60000);
    const dur = ASSISTANT_DUR(min);
    const fs = findFigures(`D-0193, ${dur}.`, model);
    expect(texts(fs)).toEqual(['D-0193', dur]);
    expect(fs[1]).toMatchObject({ tone: 'gold', lit: { ...NO_LIT, cells: [['tables', 'needs']], deals: [k.id] } });
    expect(fs[1]!.what).toBe(`D-0193 closes in ${dur.replace(/ left$/, '')}. If you do nothing: ${k.on_silence}`);
    const words = countdownWords(k.deadline_ms! / 1000, model.digest.now_ms / 1000);
    expect(texts(findFigures(`D-0193, ${words}.`, model))).toEqual(['D-0193', words]);
    // "the soonest" with no deal named means the board's soonest
    expect(texts(findFigures(`The soonest closes, ${dur}.`, model))).toEqual([dur]);
    // with no deal to measure against, a time stays plain
    expect(findFigures(`It closes, ${dur}.`, model)).toEqual([]);
  });

  it('deals today and the rules in force', async () => {
    const model = await mockModel();
    const { deals_today: n, deals_cap: cap } = model.money;
    expect(one(`${today(model)}.`, model)).toMatchObject({ tone: 'teal', what: `Deals your agents agreed to today: ${n}, of ${cap} allowed a day`, lit: NO_LIT });
    expect(one(`${n} deals today.`, model).text).toBe(`${n} deals today`);
    expect(one('1 rule set is in force.', model)).toMatchObject({ tone: 'market', lit: NO_LIT });
  });
});

describe('only what equals the data links', () => {
  it('a count or an amount one off stays plain', async () => {
    const model = await mockModel();
    for (const say of ['5 things wait on you.', '7 things wait on you.', '8 moving by themselves', '24 deals on the board', usd(model.money.room_left_minor! + 1), usd(model.money.room_left_minor! - 1), '$329.01', today(model, model.money.deals_today! + 1), today(model, undefined, model.money.deals_cap! + 1), '2 rule sets are in force'])
      expect(findFigures(say, model), say).toEqual([]);
    // the area links; its wrong counts do not
    expect(texts(findFigures('Spend: 7 deals, 2 need you.', model))).toEqual(['Spend']);
    const k = key(model, 'D-0193');
    const min = Math.round((k.deadline_ms! - model.digest.now_ms) / 60000);
    expect(texts(findFigures(`D-0193, ${ASSISTANT_DUR(min + 1)}.`, model))).toEqual(['D-0193']);
  });

  it('overlapping candidates: the earliest, then the longest wins, and a failed span never relinks shorter', async () => {
    const model = await mockModel();
    // "1 of 6 deals today" starts before "6 deals": it wins, and "6 deals" (not the total) never links
    expect(texts(findFigures(today(model), model))).toEqual([today(model)]);
    // a wrong count fails the whole span: "6 deals" inside it equals Spend's row, and still stays plain
    expect(model.rowCount.spend).toBe(6);
    expect(model.money.deals_cap).toBe(6);
    expect(texts(findFigures(`Spend: ${today(model, model.money.deals_today! + 1)}.`, model))).toEqual(['Spend']);
    expect(texts(findFigures('Spend: 6 deals today.', model))).toEqual(['Spend']);
    // "23 deals need you" is wrong; "23 deals" (the board total) inside it must not link
    expect(findFigures('23 deals need you', model)).toEqual([]);
    // "6 deals need you" is right and the longer reading wins
    expect(one('6 deals need you', model).lit).toEqual({ ...NO_LIT, cols: ['needs'] });
  });
});

describe('the scripted engine’s sentences', () => {
  it('"What needs me?" is fully linked, and its count sums to 6 on the board', async () => {
    const model = await mockModel();
    const say = answerScripted('What needs me?', model.digest).say;
    const fs = findFigures(say, model);
    wellFormed(say, fs);
    const k = key(model, 'D-0193');
    expect(texts(fs)).toEqual(['6 things wait on you', 'D-0193', ASSISTANT_DUR(Math.round((k.deadline_ms! - model.digest.now_ms) / 60000))]);
    expect(plainOf(say, fs)).not.toMatch(/\d/);
    expect(sumLine(fs[0]!.lit, model)).toEqual({ terms: [2, 1, 1, 1, 1], total: 6 });
  });

  it('"How much room is left today?" is fully linked', async () => {
    const model = await mockModel();
    const say = answerScripted('How much room is left today?', model.digest).say;
    const m = model.money;
    expect(say).toBe(`Room left today is ${usd(m.room_left_minor)} of ${usd(m.day_cap_minor)}. ${usd(m.held_minor)} is held at PayPal or agreed and waiting to be paid. Paid today: ${usd(m.paid_today_minor)}. ${today(model)}.`);
    const fs = findFigures(say, model);
    wellFormed(say, fs);
    expect(texts(fs)).toEqual([usd(m.room_left_minor), usd(m.day_cap_minor), usd(m.held_minor), usd(m.paid_today_minor), today(model)]);
    expect(fs.map((f) => f.tone)).toEqual(['teal', 'market', 'coral', 'ok', 'teal']);
    expect(plainOf(say, fs)).not.toMatch(/\d/);
    // honest: the held figure is held at PayPal plus agreed and waiting, and the sentence says both
    expect(m.held_minor).toBe(model.instruments.held_at_paypal_minor! + model.instruments.held_before_minor!);
    expect(model.instruments.held_before_minor).toBeGreaterThan(0);
    expect(fs[2]!.what).toMatch(/held at PayPal, or agreed and waiting/);
  });

  it('the book, a module and a deal are fully linked; every suggestion is well formed', async () => {
    const model = await mockModel();
    for (const q of ['Show the book', 'Tell me about Spend', 'What did Shield stop?', 'D-0193']) {
      const say = answerScripted(q, model.digest).say;
      const fs = findFigures(say, model);
      wellFormed(say, fs);
      expect(plainOf(say, fs), `${q}: ${say}`).not.toMatch(/\d/);
    }
    for (const q of SCRIPTED_QUESTIONS) {
      const say = answerScripted(q, model.digest).say;
      wellFormed(say, findFigures(say, model));
    }
  });
});

describe('at scale: 500 deals', () => {
  it('a sentence whose count disagrees with the board stays plain; the board’s own sentence links', async () => {
    const small = await mockModel();
    const smallSay = answerScripted('What needs me?', small.digest).say;
    const large = await mockModel('?scale=large');
    expect(large.keys.length).toBe(500);
    expect(large.colCount.needs).toBe(44);
    // Maya's "6 things wait on you" read against the 500-deal board: 6 is not 44, so it stays plain
    const fs = findFigures(smallSay, large);
    expect(texts(fs)).not.toContain('6 things wait on you');
    expect(findFigures('6 things wait on you. 23 deals on the board.', large)).toEqual([]);
    // the large board's own answer links, count and soonest deal and its time left
    const say = answerScripted('What needs me?', large.digest).say;
    const own = findFigures(say, large);
    wellFormed(say, own);
    expect(own[0]!.text).toBe('44 things wait on you');
    expect(plainOf(say, own)).not.toMatch(/\d/);
    const money = answerScripted('How much room is left today?', large.digest).say;
    expect(plainOf(money, findFigures(money, large))).not.toMatch(/\d/);
  });
});

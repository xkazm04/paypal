// The three standing questions over Maya's week: is my money safe, does anything need me, what happens
// if I do nothing. Null sources are dim and "not available yet", never green. The clock is pinned (repo law).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@bindings/AttentionItem';
import { clockLabel } from '../../../lib/format';
import { MONEY_CHECK_SILENCE, RESCUE_SENT_SILENCE, RESCUE_SILENCE } from '../../../lib/words';
import { mockBackend, resetMockState } from '../../../mock/backend';
import { moduleOf } from '../logic';
import { silenceOutcome, standingAnswers } from './standing';
import { boardFromWorld, type BoardInputs, type BoardModel } from './useBoardModel';

// Friday 19:30 local, or the pin the run was started with (BOARD_PIN="2026-11-08T00:30:00": Sunday 00:30).
const PIN = new Date(process.env.BOARD_PIN ?? '2026-11-06T19:30:00');

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(PIN); });
afterEach(() => { vi.useRealTimers(); });

type Over = Partial<Pick<BoardInputs, 'safety' | 'ready'>> & { silence?: (label: string, s: string) => string; noNeeds?: boolean };

async function mockModel(over: Over = {}): Promise<BoardModel> {
  resetMockState();
  const b = mockBackend('main');
  const deals = await b.invoke('list_deals', null);
  const att = await b.invoke('attention_list', null);
  const disp = new Map(await Promise.all(deals.map(async (d) => [d.id, await b.invoke('deal_display', { deal_id: d.id })] as const)));
  const label = (id: string) => disp.get(id)!.label;
  const needs: AttentionItem[] = over.noNeeds ? [] : att.items.map((n) => (over.silence ? { ...n, on_silence: over.silence(label(n.deal_id), n.on_silence) } : n));
  const byDeal = new Map(att.items.map((n) => [n.deal_id, n]));
  return boardFromWorld({
    ready: over.ready ?? true, deals, needs,
    display: (d) => { const x = disp.get(d.id)!; return { label: x.label, title: x.title }; },
    moduleOfDeal: (d) => moduleOf(d, byDeal.get(d.id)),
    exposure: att.exposure, nowSec: Math.floor(Date.now() / 1000), rulesInForce: 1, gs: null,
    safety: 'safety' in over ? over.safety : { intact: true, records: 158 },
  });
}

describe('Is my money safe right now?', () => {
  it('intact: ok, "Safe", the entries checked', async () => {
    const [safe] = standingAnswers(await mockModel());
    expect(safe).toEqual({ key: 'safe', tone: 'ok', headline: 'Safe', detail: '158 entries checked · nothing broke your rules' });
  });
  it('broken: refuse, in the safety page’s own words', async () => {
    const [safe] = standingAnswers(await mockModel({ safety: { intact: false, records: 158 } }));
    expect(safe).toEqual({ key: 'safe', tone: 'refuse', headline: 'Your record failed a check', detail: 'Look at your safety record now' });
  });
  it('not read: dim, "not available yet", never green', async () => {
    const [safe] = standingAnswers(await mockModel({ safety: undefined }));
    expect(safe).toEqual({ key: 'safe', tone: 'dim', headline: 'Not available yet', detail: null });
  });
});

describe('Does anything need me?', () => {
  it('six: gold, counted from the column, the areas that carry it and the soonest deadline', async () => {
    const model = await mockModel();
    const [, needs] = standingAnswers(model);
    const soonest = Math.min(...model.keys.filter((k) => k.deadline_s !== null).map((k) => k.deadline_s!));
    expect(needs).toEqual({
      key: 'needs', tone: 'gold', headline: '6 need you',
      detail: `Tables 2 · Spend 1 · Counter 1 · Shield 1 · Rescue 1 · soonest ${clockLabel(soonest, Math.floor(Date.now() / 1000))}`,
    });
    // counted, not recomputed: the answer follows colCount
    expect(standingAnswers({ ...model, colCount: { ...model.colCount, needs: 1 } })[1].headline).toBe('1 needs you');
  });
  it('none: ok, "Nothing needs you"', async () => {
    const [, needs, nothing] = standingAnswers(await mockModel({ noNeeds: true }));
    expect(needs).toEqual({ key: 'needs', tone: 'ok', headline: 'Nothing needs you', detail: null });
    expect(nothing).toEqual({ key: 'nothing', tone: 'ok', headline: 'Nothing moves by itself', detail: null });
  });
  it('a board that has not read yet is dim, never "Nothing needs you"', async () => {
    const [, needs, nothing] = standingAnswers(await mockModel({ ready: false, noNeeds: true }));
    expect(needs.tone).toBe('dim');
    expect(needs.headline).toBe('Not available yet');
    expect(nothing.tone).toBe('dim');
  });
});

describe('What happens if I do nothing?', () => {
  it('Maya’s week: nothing moves by itself, and the detail says what does happen', async () => {
    const [, , nothing] = standingAnswers(await mockModel());
    expect(nothing).toEqual({
      key: 'nothing', tone: 'ok', headline: 'Nothing moves by itself',
      detail: 'Holds are released, asks lapse, failed renewals retry at PayPal, payments being checked follow what PayPal shows and the rest waits for you',
    });
  });
  it('only holds and asks: "Holds are released and asks lapse"', async () => {
    const [, , nothing] = standingAnswers(await mockModel({ silence: (l) => (l === 'D-0190' ? 'the hold is released at the deadline, nothing is paid' : 'the offer lapses at the deadline, no money moves') }));
    expect(nothing.detail).toBe('Holds are released and asks lapse');
  });
  it('a payment the buyer approved that the wallet collects: teal, it says what moves and that nothing goes out', async () => {
    const [, , nothing] = standingAnswers(await mockModel({ silence: (l, s) => (l === 'D-0194' ? 'the payment the buyer approved is collected' : s) }));
    expect(nothing).toEqual({ key: 'nothing', tone: 'teal', headline: 'A payment can come in by itself', detail: 'D-0194 · nothing goes out by itself' });
    const [, , two] = standingAnswers(await mockModel({ silence: (l, s) => (l === 'D-0194' || l === 'D-0193' ? 'if the buyer approves on PayPal in time, the payment is put on hold for you, and the hold is released if you do not take it' : s) }));
    expect(two.headline).toBe('2 payments can come in by themselves');
    expect(two.detail).toBe('D-0193 and D-0194 · nothing goes out by itself');
  });
  it('a line the board cannot read promises only that nothing goes out: dim', async () => {
    const [, , nothing] = standingAnswers(await mockModel({ silence: (l, s) => (l === 'D-0198' ? 'what happens at the deadline could not be checked just now' : s) }));
    expect(nothing).toEqual({ key: 'nothing', tone: 'dim', headline: 'Nothing goes out by itself', detail: 'What happens to D-0198 is not available yet' });
  });
  it('reads the core’s lines, raw and in plain words', () => {
    const rows: Array<[string, ReturnType<typeof silenceOutcome>]> = [
      ['the offer or order lapses at the deadline; no money moves', 'lapse'],
      ['the order expires at the deadline, no money moves', 'lapse'],
      ['authorization auto-voids at the deadline; no capture', 'release'],
      ['the hold releases itself at the deadline; nothing is taken', 'release'],
      ['the deadline changes nothing on this deal; it stays as it is until you act', 'stays'],
      [MONEY_CHECK_SILENCE, 'check'],
      [RESCUE_SILENCE, 'retry'],
      [RESCUE_SENT_SILENCE, 'lapse'],
      ['the wallet sends the buyer the payment request; if they do not approve it, it expires and no money moves', 'lapse'],
      ['the payment the buyer approved is collected', 'in'],
      ['if the buyer approves on PayPal in time, the payment is collected; if not, the order expires', 'in'],
      ['the payment the buyer approved is put on hold for you, and the hold is released if you do not take it', 'in'],
      ['what happens at the deadline could not be checked just now', 'unknown'],
      ['something new the board has never seen', 'unknown'],
      ['', 'unknown'],
    ];
    for (const [s, o] of rows) expect(silenceOutcome(s), s).toBe(o);
    expect(silenceOutcome(null)).toBe('unknown');
  });
});

describe('first run', () => {
  it('not set up yet, dim, with the next step', async () => {
    const model = await mockModel({ noNeeds: true });
    const first: BoardModel = { ...model, firstRun: true, setup: [{ key: 'paypal', done: true }, { key: 'rules', done: false }, { key: 'practice', done: false }, { key: 'engine', done: null }] };
    expect(standingAnswers(first)).toEqual([
      { key: 'safe', tone: 'dim', headline: 'Not set up yet', detail: 'Nothing can be paid until setup is done' },
      { key: 'needs', tone: 'dim', headline: 'Not set up yet', detail: 'Next: Sign your rules' },
      { key: 'nothing', tone: 'dim', headline: 'Nothing moves by itself', detail: 'Nothing can be paid until setup is done' },
    ]);
  });
  it('a deal that already needs her is still gold', async () => {
    const model = await mockModel();
    expect(standingAnswers({ ...model, firstRun: true })[1].tone).toBe('gold');
  });
});

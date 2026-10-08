import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import type { H256 } from '@bindings/H256';
import { answerWhy, askAboveOf, highPriceWord, rowWhy, type AnswerWhyInput, type WhyFacts } from './why';
import type { DiffRow, Twin } from './diff';

const HASH = Array.from({ length: 32 }, (_, i) => i) as H256;
const usd = (minor: number) => ({ minor, currency: 'USD' as const });

function deal(p: Partial<Deal> = {}): Deal {
  return {
    id: '01JDTESTDEAL0000000000000Q', kind: 'haggle', side: 'buyer', counterparty: 'kp_test',
    terms: { item_ref: 'monitor', qty: 1, unit_price: usd(32900), currency: 'USD', delivery: { type: 'digital_now' } },
    state: 'NEGOTIATING', mandate_id: 'M1', mandate_version: 3, transcript_head: HASH,
    paypal: { order: null, authorization: null, capture: null, subscription: null }, mode: 'sandbox', market: null, shield: 'CLEAR', ...p,
  };
}
const row = (p: Partial<DiffRow> & Pick<DiffRow, 'id'>): DiffRow => ({ name: 'Row', left: 'l', right: 'r', rel: '=', tone: 'ok', src: 'where it came from', ...p });
const facts = (p: Partial<WhyFacts> = {}): WhyFacts => ({ phase: 'ready', who: 'Dan', total: '$329.00', askAbove: usd(25000), highPrice: null, ...p });
const twin: Twin = { left: { k: 'Most you’ll pay', v: '$340.00' }, op: '≥', right: { k: 'Dan asks', v: '$329.00' }, tone: 'ok' };
const answer = (p: Partial<AnswerWhyInput> = {}) => answerWhy({ ...facts(), kind: 'accept', act: 'accept', deal: deal(), rows: [], twin, settle: null, unavailable: null, ...p });
const all = (w: ReturnType<typeof answer>) => (w ? `${w.question} ${w.lines.join(' ')}` : '');

describe('the answer’s Why: two sentences from facts on screen', () => {
  it('accepting names the ask-me limit only when the Diff says this is above it', () => {
    const above = answer({ rows: [row({ id: 'present', rel: '>', tone: 'info', word: 'asks you' })] });
    expect(above?.lines[0]).toBe('Your rules say you decide anything above $250.00, and this $329.00 is above that.');
    const under = answer({ rows: [row({ id: 'present', rel: '≤', tone: 'info', word: 'your call' })] });
    expect(under?.lines[0]).toBe('Your rules leave this price to you, not to the agent.');
    expect(answer({ rows: [] })?.lines[1]).toMatch(/nothing is charged or held until you approve on PayPal/);
  });
  it('a hold admits the wallet does not say which check paused it, and lists only what is visible', () => {
    const w = answer({ kind: 'hold', phase: 'hold', act: 'release', highPrice: 'well above typical', rows: [row({ id: 'payees', rel: '∉', tone: 'info' })] });
    expect(w?.lines[0]).toBe('The wallet doesn’t say which check paused it. What you can see: Dan isn’t on your approved payees and the price is well above typical.');
    expect(w?.lines[1]).toMatch(/Unpausing pays nothing/);
    expect(answer({ kind: 'hold', phase: 'hold', act: 'release' })?.lines[0]).toMatch(/doesn’t say which check paused it/);
  });
  it('a mismatch names both amounts when it knows them and never offers pay anyway', () => {
    const w = answer({ kind: 'mismatch', phase: 'mismatch', act: null, settle: usd(33900) });
    expect(w?.lines[0]).toBe('Dan’s payment request asks for $339.00, but you agreed $329.00.');
    expect(w?.lines[1]).toMatch(/no “pay anyway”/);
    expect(all(answer({ kind: 'mismatch', phase: 'mismatch', act: null }))).toMatch(/doesn’t match the \$329\.00 you agreed/);
  });
  it('paying and collecting say who is holding what and what silence does', () => {
    expect(answer({ kind: 'capture', act: 'capture', deal: deal({ kind: 'purchase', state: 'AUTHORIZED' }), who: 'partsco', total: '$64.00' })?.lines[0]).toBe('PayPal is holding $64.00 for this purchase, and it only goes to partsco if you pay.');
    expect(answer({ kind: 'capture', act: 'capture', deal: deal({ side: 'seller', state: 'AUTHORIZED' }) })?.lines[1]).toMatch(/nothing is collected/);
  });
  it('a replay never claims anything real is invoiced', () => {
    const w = answer({ kind: 'lever', act: 'rescue', deal: deal({ kind: 'rescue', side: 'seller', state: 'AGREED', mode: 'replay' }) });
    expect(w?.lines[1]).toMatch(/one real .* PayPal invoice; the failure is a replay, so it is never counted\.$/);
  });
  it('has no answer where nothing is asked, and never a guess', () => {
    for (const phase of ['checking', 'done', 'stopped', 'in_browser', 'block'] as const) expect(answer({ phase })).toBeNull();
    expect(all(answer())).not.toMatch(/probably|likely|might|usually/i);
  });
});

describe('each exception row explains itself, and a pass explains nothing', () => {
  it('a pass has no Why', () => {
    expect(rowWhy(row({ id: 'mandate' }), 'pass', facts())).toBeNull();
  });
  it('the scam check: paused, asks, blocked, not run', () => {
    expect(rowWhy(row({ id: 'shield', rel: '!', tone: 'hold' }), 'ask', facts())?.question).toBe('Why is the scam check paused?');
    expect(rowWhy(row({ id: 'shield', rel: '!', tone: 'hold' }), 'ask', facts({ phase: 'mismatch' }))?.lines[1]).toBe('The deal also stopped on the amount, so nothing can be paid either way.');
    expect(rowWhy(row({ id: 'shield', rel: '=', tone: 'ok', word: 'asks you' }), 'ask', facts())?.question).toBe('Why does the scam check ask me?');
    expect(rowWhy(row({ id: 'shield', rel: '≠', tone: 'bad', word: 'blocked' }), 'fail', facts())?.lines[1]).toMatch(/can’t be overridden/);
    expect(rowWhy(row({ id: 'shield', rel: '?', tone: 'info' }), 'unknown', facts())?.lines[1]).toMatch(/never shown as passed/);
  });
  it('who decides and approved payees use the rule’s own numbers and words', () => {
    expect(rowWhy(row({ id: 'present', rel: '>', tone: 'info' }), 'ask', facts())?.lines).toEqual([
      'Your rules say you decide anything above $250.00, and this $329.00 is above that.',
      'That is why the agent stopped and asked you instead of agreeing by itself.',
    ]);
    const p = rowWhy(row({ id: 'payees', rel: '∉', tone: 'info', left: 'packrite-supply, HOUSE' }), 'ask', facts({ who: 'partsco' }));
    expect(p?.lines).toEqual(['partsco isn’t on your approved payees (packrite-supply, HOUSE).', 'Payees not on your list always come to you to decide.']);
  });
  it('an amount that differs says both amounts, or admits it does not know theirs', () => {
    expect(rowWhy(row({ id: 'amount', rel: '≠', tone: 'bad', right: 'asked $339.00' }), 'fail', facts())?.lines[0]).toBe('You agreed $329.00, but Dan asked $339.00.');
    expect(rowWhy(row({ id: 'amount', rel: '≠', tone: 'bad', right: 'their request disagrees' }), 'fail', facts())?.lines[0]).toBe('You agreed $329.00, but Dan’s request disagrees.');
  });
  it('anything not checked here is said to be unknown, never a pass', () => {
    const w = rowWhy(row({ id: 'host', name: 'PayPal link', rel: '?', tone: 'info', src: 'Locked. Checked again after you unlock.' }), 'unknown', facts());
    expect(w?.lines).toEqual(['Locked. Checked again after you unlock.', 'Not checked here is never shown as passed.']);
  });
});

describe('facts read from the deal and the rules', () => {
  it('finds the ask-me limit, or none', () => {
    const m = { payload: { clauses: [{ type: 'human_present_over', amount: usd(25000) }] } } as unknown as Parameters<typeof askAboveOf>[0];
    expect(askAboveOf(m)).toEqual(usd(25000));
    expect(askAboveOf(null)).toBeNull();
    expect(askAboveOf(undefined)).toBeNull();
  });
  it('only a price above the usual range is worth naming', () => {
    const market = { p25: usd(3800), median: usd(4300), p75: usd(4900), retrieved_at: 0, cached: false } as unknown as Deal['market'];
    expect(highPriceWord(deal({ market, terms: { ...deal().terms, unit_price: usd(14000) } }))).toBe('well above typical');
    expect(highPriceWord(deal({ market, terms: { ...deal().terms, unit_price: usd(4000) } }))).toBeNull();
    expect(highPriceWord(deal())).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import type { Deal } from '@bindings/Deal';
import { checkLights, compareRows, knownPayees, seenWords, weekStrip, whyFor } from './normal';
import { reasonsFor } from './matrix';

const usd = (d: number) => ({ minor: Math.round(d * 100), currency: 'USD' as const });
const NONE = { order: null, authorization: null, capture: null, subscription: null };
const NOW = 1_800_000_000;
const deal = (o: Partial<Deal> = {}): Deal => ({
  id: 'D', kind: 'purchase', side: 'buyer', counterparty: 'K', state: 'AGREED', mandate_id: 'M', mandate_version: 3,
  transcript_head: [] as unknown as Deal['transcript_head'], paypal: NONE, mode: 'sandbox', market: null, shield: null,
  terms: { item_ref: 'stand', qty: 2, unit_price: usd(70), currency: 'USD', delivery: { type: 'digital_now' } }, ...o,
});
const market = { p25: usd(38), median: usd(44), p75: usd(49), retrieved_at: NOW, response_hash: [] as unknown as Deal['transcript_head'], cached: false };
const cp = (o: Partial<CounterpartyDisplay> = {}): CounterpartyDisplay => ({ key_id: 'K', display_name: 'pixel-bay', house: false, first_seen: NOW - 2 * 3600, deals_closed: 0, pairing: 'words_confirmed', declared_payee: 'pixel-bay', ...o });
const KNOWN = { known: 7, total: 12 };

describe('week strip', () => {
  const stamp = { created_at: NOW - 3600, updated_at: NOW - 60 };
  it('counts checked, paused, blocked and what is still waiting, from the deals alone', () => {
    const s = weekStrip([
      deal({ id: 'a', shield: 'BLOCK', state: 'REFUSED', ...stamp }), deal({ id: 'b', shield: 'HOLD', ...stamp }), deal({ id: 'c', shield: 'HOLD', state: 'MISMATCH', ...stamp }),
      deal({ id: 'd', shield: 'CLEAR', ...stamp }), deal({ id: 'e', shield: null, ...stamp }), deal({ id: 'f', shield: 'ASK', ...stamp }),
    ], NOW, (x) => x.id === 'b');
    expect(s).toMatchObject({ checked: 5, paused: 3, blocked: 1, safe: 1, waiting: 1 });
  });
  it('says "all" instead of "week" when a deal has no timestamp, and is zero when nothing was checked', () => {
    expect(weekStrip([deal({ shield: 'HOLD' })], NOW, () => true).scope).toBe('all');
    expect(weekStrip([], NOW, () => false)).toMatchObject({ checked: 0, paused: 0, blocked: 0, waiting: 0 });
    expect(weekStrip([deal({ shield: 'HOLD', ...stamp })], NOW, () => false).scope).toBe('week');
  });
});

describe('who you know', () => {
  it('counts connections with a finished deal; null without the list', () => {
    expect(knownPayees([cp({ deals_closed: 1 }), cp({ deals_closed: 0 }), cp({ deals_closed: 9 })])).toEqual({ known: 2, total: 3 });
    expect(knownPayees(undefined)).toBeNull();
  });
  it('says how long ago in hours, minutes then days', () => {
    expect(seenWords(NOW - 10, NOW)).toBe('just now');
    expect(seenWords(NOW - 5 * 60, NOW)).toBe('5 min ago');
    expect(seenWords(NOW - 3600, NOW)).toBe('1 hour ago');
    expect(seenWords(NOW - 2 * 3600, NOW)).toBe('2 hours ago');
    expect(seenWords(NOW - 17 * 86400, NOW)).toBe('17 days ago');
  });
});

describe('what is normal vs this payment', () => {
  it('lines up the typical price, the payee you know and deals before against this payment and highlights the differences', () => {
    const rows = compareRows(deal({ market }), cp(), KNOWN, NOW);
    expect(rows.map((r) => r.key)).toEqual(['price', 'who', 'deals']);
    expect(rows[0]).toMatchObject({ tone: 'differs', normal: { text: '$44.00', sub: 'usually $38.00–$49.00' }, here: { text: '$70.00 each', sub: '59% above typical' } });
    expect(rows[1]).toMatchObject({ tone: 'differs', normal: { text: 'A payee you already know', sub: '7 people have finished deals with you' }, here: { text: 'New payee', sub: 'first seen 2 hours ago' } });
    expect(rows[2]).toMatchObject({ tone: 'differs', here: { text: 'None', sub: 'first deal today' } });
  });
  it('does not highlight what is normal: a price near typical and an old payee with deals', () => {
    const rows = compareRows(deal({ market: { ...market, median: usd(66) } }), cp({ first_seen: NOW - 17 * 86400, deals_closed: 3 }), KNOWN, NOW);
    expect(rows.map((r) => r.tone)).toEqual(['plain', 'plain', 'plain']);
    expect(rows[2]!.here).toEqual({ text: '3', sub: 'finished with you' });
  });
  it('keeps what it does not know dashed: no typical price, no payee record, no list', () => {
    const rows = compareRows(deal(), undefined, null, NOW);
    expect(rows[0]).toMatchObject({ tone: 'unknown', normal: { unknown: true }, here: { text: '$70.00 each' } });
    expect(rows[1]).toMatchObject({ tone: 'unknown', normal: { unknown: true }, here: { unknown: true } });
    expect(rows[2]).toMatchObject({ tone: 'unknown', here: { unknown: true } });
    // a payee that is new but with no list to compare against is never claimed to differ
    expect(compareRows(deal({ market }), cp(), null, NOW)[1]!.tone).toBe('unknown');
  });
  it('never invents a figure: everything shown is in the deal or the payee record', () => {
    const shown = compareRows(deal({ market }), cp(), KNOWN, NOW).flatMap((r) => [r.normal.text, r.normal.sub, r.here.text, r.here.sub]).join(' ');
    for (const n of shown.match(/\d+(\.\d+)?/g) ?? []) expect(['44.00', '38.00', '49.00', '70.00', '59', '7', '2', '1']).toContain(n);
  });
});

describe('check lights', () => {
  it('trips the fixed and price lights from facts and never shows the AI opinion as anything but not shown', () => {
    const l = checkLights(deal({ market }), cp(), NOW);
    expect(l.map((x) => x.name)).toEqual(['Fixed checks', 'Price check', 'AI second opinion']);
    expect(l.map((x) => x.state)).toEqual(['tripped', 'tripped', 'unknown']);
  });
  it('passes the price only when the client can derive it, and never passes a fixed or AI check', () => {
    const l = checkLights(deal({ market: { ...market, median: usd(66) } }), cp({ first_seen: NOW - 9 * 86400 }), NOW);
    expect(l.map((x) => x.state)).toEqual(['unknown', 'passed', 'unknown']);
  });
  it('skips the price check without a typical price (never green) and without a payee record', () => {
    const l = checkLights(deal(), undefined, NOW);
    expect(l.map((x) => x.state)).toEqual(['unknown', 'skipped', 'unknown']);
    expect(l.some((x) => x.state === 'passed')).toBe(false);
  });
});

describe('why sentences', () => {
  it('writes two plain sentences for every reason kind', () => {
    const d = deal({ market });
    const kinds = reasonsFor(d, cp(), NOW).map((r) => r.kind);
    expect(kinds).toEqual(['price', 'newcp']);
    for (const k of ['price', 'noprice', 'newcp', 'norecord', 'other'] as const) {
      const [a, b] = whyFor(k, d, cp(), NOW);
      expect(a.endsWith('.') && b.endsWith('.')).toBe(true);
    }
  });
  it('uses only figures from the deal and the payee record', () => {
    const d = deal({ market });
    expect(whyFor('price', d, cp(), NOW).join(' ')).toContain('$70.00 each');
    expect(whyFor('price', d, cp(), NOW).join(' ')).toContain('$44.00');
    expect(whyFor('newcp', d, cp(), NOW)[1]).toBe('This payee was first seen 2 hours ago, with no finished deals before.');
    expect(whyFor('newcp', d, undefined, NOW)[1]).toBe('This payee is new to the wallet.');
  });
  it('does not call a payee by name (counterparty text stays out of explanations)', () => {
    for (const k of ['price', 'noprice', 'newcp', 'norecord', 'other'] as const) expect(whyFor(k, deal({ market }), cp(), NOW).join(' ')).not.toContain('pixel-bay');
  });
});

import { describe, expect, it } from 'vitest';
import type { Currency } from '@bindings/Currency';
import type { Deal } from '@bindings/Deal';
import type { HistoryStep } from '@bindings/HistoryStep';
import { buildMockState } from '../../../mock/fixtures';
import { endingUnreadLine } from '../../../lib/words';
import { awaySummary, LAST_SEEN_KEY, QUIET_NEWS_AFTER, readLastSeen, sinceWords, startOfToday, worthShowing, writeLastSeen } from './away';

// Thursday 8 Oct 2026, 08:30 local; Maya last looked yesterday at 18:40.
const NOW = Math.floor(new Date(2026, 9, 8, 8, 30).getTime() / 1000);
const SEEN = Math.floor(new Date(2026, 9, 7, 18, 40).getTime() / 1000);
const H = 3600;

const template = buildMockState(NOW).deals[0]?.deal as Deal;
function deal(id: string, minor: number, side: Deal['side'] = 'buyer', currency: Currency = 'USD', kind: Deal['kind'] = side === 'buyer' ? 'purchase' : 'shop_order'): Deal {
  return { ...template, id, side, kind, terms: { ...template.terms, qty: 1, unit_price: { minor, currency } } };
}

let seq = 0;
type S = HistoryStep;
function step(deal_id: string, at: number, kind: S['kind'], authority: S['authority'] = { type: 'none' }, paypal: S['paypal'] = { type: 'none' }, state_after: S['state_after'] = null): S {
  seq += 1;
  return { at, deal_id, seq, kind, state_after, authority, paypal };
}
const RULE: S['authority'] = { type: 'signed_rule', clause: 6 };
const OWNER: S['authority'] = { type: 'owner' };
const SHOP: S['authority'] = { type: 'seller_mandate' };
const DEFAULT: S['authority'] = { type: 'safe_default' };
const ok = (method: Extract<S['paypal'], { type: 'call' }>['method']): S['paypal'] => ({ type: 'call', method, outcome: 'ok' });
const answer = (method: Extract<S['paypal'], { type: 'call' }>['method'], outcome: 'ok' | 'failed' | 'unknown'): S['paypal'] => ({ type: 'call', method, outcome });

const A = deal('A', 5000);
const B = deal('B', 3300);
const SALE = deal('SALE', 9000, 'seller');
const HOLD = deal('HOLD', 4200);
const GPU = deal('GPU', 124000);
const DEALS = [A, B, SALE, HOLD, GPU];

/** The brief's morning: two purchases paid on the rule, a sale collected, a hold released itself, a refusal. */
function morning(): S[] {
  return [
    step('A', SEEN + 1 * H, 'authorized', RULE, ok('authorize')),
    step('A', SEEN + 2 * H, 'captured', RULE, ok('capture'), 'CAPTURED'),
    step('B', SEEN + 3 * H, 'captured', RULE, ok('capture'), 'CAPTURED'),
    step('SALE', SEEN + 4 * H, 'approved_by_buyer', { type: 'none' }, ok('read_order')),
    step('SALE', SEEN + 4 * H + 30, 'authorized', SHOP, ok('authorize')),
    step('SALE', SEEN + 4 * H + 60, 'captured', SHOP, ok('capture'), 'CAPTURED'),
    step('HOLD', SEEN + 5 * H, 'auto_voided', DEFAULT, ok('void'), 'AUTO_VOIDED'),
    step('GPU', SEEN + 6 * H, 'refused', { type: 'signed_rule', clause: 3 }, { type: 'none' }, 'REFUSED'),
  ];
}

describe('awaySummary', () => {
  it('tells the brief\'s morning in plain words, grouped by outcome and authority', () => {
    const s = awaySummary(morning(), DEALS, SEEN, NOW, { needs: 2 });
    expect(s.lines.map((l) => l.text)).toEqual([
      'Your agents paid $83.00 under your rules (2 purchases)',
      'Your shop collected $90.00 after the buyer approved',
      '1 hold released itself ($42.00, nothing was paid)',
      '1 request was refused by your rules (PayPal was never asked)',
    ]);
    expect(s.text).toBe('While you were away (since yesterday 18:40): your agents paid $83.00 under your rules (2 purchases), your shop collected $90.00 after the buyer approved, '
      + '1 hold released itself ($42.00, nothing was paid), 1 request was refused by your rules (PayPal was never asked). 2 things need you.');
    expect(s.needsLine).toBe('2 things need you');
  });

  it('totals money out and in per currency in integer minor units', () => {
    const s = awaySummary(morning(), DEALS, SEEN, NOW);
    expect(s.out).toEqual([{ minor: 8300, currency: 'USD' }]);
    expect(s.inn).toEqual([{ minor: 9000, currency: 'USD' }]);
    expect(s.moved).toBe(true);
    expect(s.lead).toBeNull();
  });

  it('never adds across currencies', () => {
    const eur = deal('E', 2500, 'buyer', 'EUR');
    const s = awaySummary([step('A', SEEN + H, 'captured', RULE, ok('capture')), step('E', SEEN + 2 * H, 'captured', RULE, ok('capture'))], [A, eur], SEEN, NOW);
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]?.totals).toEqual([{ minor: 5000, currency: 'USD' }, { minor: 2500, currency: 'EUR' }]);
    expect(s.lines[0]?.amount).toBe('$50.00 + €25.00');
    expect(s.out).toHaveLength(2);
  });

  it('keeps a zero-decimal currency in its own minor units', () => {
    const yen = deal('Y', 4800, 'seller', 'JPY');
    const s = awaySummary([step('Y', SEEN + H, 'captured', SHOP, ok('capture'))], [yen], SEEN, NOW);
    expect(s.inn).toEqual([{ minor: 4800, currency: 'JPY' }]);
    expect(s.lines[0]?.amount).toContain('4,800');
  });

  it('says nothing happened and no money moved when the record is empty', () => {
    const s = awaySummary([], DEALS, SEEN, NOW);
    expect(s.quiet).toBe(true);
    expect(s.moved).toBe(false);
    expect(s.lines).toEqual([]);
    expect(s.lead).toBe('Nothing happened. No money moved.');
    expect(s.text).toBe('While you were away (since yesterday 18:40): nothing happened and no money moved.');
  });

  it('with only refusals says no money moved, and PayPal was never asked', () => {
    const steps = [
      step('GPU', SEEN + H, 'refused', { type: 'signed_rule', clause: 3 }),
      step('GPU', SEEN + 2 * H, 'refused', { type: 'signed_rule', clause: 3 }),
      step('B', SEEN + 3 * H, 'refused', { type: 'none' }),
    ];
    const s = awaySummary(steps, DEALS, SEEN, NOW);
    expect(s.moved).toBe(false);
    expect(s.quiet).toBe(false);
    expect(s.lead).toBe('No money moved.');
    expect(s.lines.map((l) => l.text)).toEqual([
      '2 requests were refused by your rules (PayPal was never asked)',
      '1 request was stopped by a safety check (PayPal was never asked)',
    ]);
    expect(s.lines.every((l) => l.amount === null)).toBe(true);
    expect(s.text).toContain('no money moved; 2 requests were refused');
  });

  it('counts a refused agent intent as your rules stopping it', () => {
    const s = awaySummary([step('A', SEEN + H, 'intent_refused', { type: 'agent_intent' })], DEALS, SEEN, NOW);
    expect(s.lines[0]?.authority).toBe('rules');
    expect(s.lines[0]?.text).toBe('1 request was refused by your rules (PayPal was never asked)');
  });

  it('tells a payment whose answer was lost as checking with PayPal, never as paid', () => {
    const steps = [
      step('SALE', SEEN + H, 'authorized', SHOP, ok('authorize')),
      step('SALE', SEEN + 2 * H, 'checking_with_paypal'),
    ];
    const s = awaySummary(steps, DEALS, SEEN, NOW);
    expect(s.lines.map((l) => l.outcome)).toEqual(['checking']);
    expect(s.lines[0]?.text).toBe('Checking with PayPal on 1 payment ($90.00): not paid and not failed until PayPal shows which');
    expect(s.lines[0]?.tone).toBe('check');
    expect(s.moved).toBe(false);
  });

  it('does not open with No money moved while a payment is still being checked with PayPal', () => {
    const steps = [
      step('SALE', SEEN + H, 'authorized', SHOP, ok('authorize')),
      step('SALE', SEEN + 2 * H, 'checking_with_paypal'),
    ];
    const s = awaySummary(steps, DEALS, SEEN, NOW);
    expect(s.lead).toBeNull();
    expect(s.text).not.toContain('no money moved');
  });

  it('tells a deal that ended at its deadline while PayPal was being asked as one line, never as no money moved', () => {
    const steps = [
      step('SALE', SEEN + H, 'authorized', SHOP, ok('authorize')),
      step('SALE', SEEN + 2 * H, 'checking_with_paypal'),
      step('SALE', SEEN + 3 * H, 'expired', DEFAULT, { type: 'none' }, 'EXPIRED'),
    ];
    const s = awaySummary(steps, DEALS, SEEN, NOW);
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]?.outcome).toBe('unshown');
    expect(s.lines[0]?.text).toBe('1 deal ended before PayPal showed what happened to the payment ($90.00): look at it in PayPal');
    expect(s.lead).toBeNull();
    expect(s.text).not.toContain('no money moved');
    expect(s.text).not.toMatch(/clause|capture|authoriz|void|seller_mandate|signed_rule|\bA\b|GPU/i);
  });

  it('tells an ending as unshown when the deal’s own record says a check was open, though no check step is passed', () => {
    const steps = [step('SALE', SEEN + H, 'expired', DEFAULT, { type: 'none' }, 'EXPIRED')];
    const s = awaySummary(steps, DEALS, SEEN, NOW, { unshown: new Set(['SALE']) });
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]?.outcome).toBe('unshown');
    expect(s.lines[0]?.text).toBe('1 deal ended before PayPal showed what happened to the payment ($90.00): look at it in PayPal');
    expect(s.lead).toBeNull();
    expect(s.text).not.toContain('no money moved');
  });

  it('tells an ending whose own record could not be read as not available yet, never as no money moved', () => {
    const steps = [step('SALE', SEEN + H, 'expired', DEFAULT, { type: 'none' }, 'EXPIRED')];
    const s = awaySummary(steps, DEALS, SEEN, NOW, { unread: new Set(['SALE']) });
    const [before, after] = endingUnreadLine(1);
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]?.outcome).toBe('unread');
    expect(s.lines[0]?.tone).toBe('check');
    expect(s.lines[0]?.text).toBe(`${before}$90.00${after}`);
    expect(s.lead).toBeNull();
    expect(s.text).not.toMatch(/no money moved/i);
  });

  it('keeps the lapsed line when the steps hold only the expiry and the record says nothing', () => {
    const steps = [step('SALE', SEEN + H, 'expired', DEFAULT, { type: 'none' }, 'EXPIRED')];
    const s = awaySummary(steps, DEALS, SEEN, NOW);
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]?.outcome).toBe('lapsed');
    expect(s.lines[0]?.text).toBe('1 deal ran out of time (no money moved)');
  });

  it('tells the same line when the check began before the window and the expiry is inside it', () => {
    const steps = [
      step('SALE', SEEN - 2 * H, 'checking_with_paypal'),
      step('SALE', SEEN + H, 'expired', DEFAULT, { type: 'none' }, 'EXPIRED'),
    ];
    const s = awaySummary(steps, DEALS, SEEN, NOW);
    expect(s.lines.map((l) => l.outcome)).toEqual(['unshown']);
    expect(s.lines[0]?.text).toBe('1 deal ended before PayPal showed what happened to the payment ($90.00): look at it in PayPal');
    expect(s.lead).toBeNull();
    expect(s.text).not.toContain('no money moved');
  });

  it('a capture whose answer is unknown is a check, a failed one is a no from PayPal', () => {
    const s = awaySummary([
      step('A', SEEN + H, 'captured', RULE, answer('capture', 'unknown')),
      step('B', SEEN + H, 'captured', RULE, answer('capture', 'failed')),
    ], DEALS, SEEN, NOW);
    expect(s.lines.map((l) => l.outcome)).toEqual(['checking', 'failed']);
    expect(s.lines[1]?.text).toBe('PayPal said no on 1 deal (no money moved)');
    expect(s.out).toEqual([]);
  });

  it('a check that later resolved is told by its answer', () => {
    const s = awaySummary([
      step('A', SEEN + H, 'checking_with_paypal'),
      step('A', SEEN + 2 * H, 'captured', RULE, ok('capture')),
    ], DEALS, SEEN, NOW);
    expect(s.lines.map((l) => l.outcome)).toEqual(['paid']);
  });

  it('a hold still standing is on hold, not paid', () => {
    const s = awaySummary([step('HOLD', SEEN + H, 'authorized', RULE, ok('authorize'))], DEALS, SEEN, NOW);
    expect(s.lines[0]?.text).toBe('$42.00 is on hold at PayPal under your rules (not paid yet)');
    expect(s.lines[0]?.tone).toBe('held');
    expect(s.moved).toBe(false);
    expect(s.lead).toBe('No money moved.');
  });

  it('a hold you released is yours; one that ran out released itself', () => {
    const s = awaySummary([
      step('A', SEEN + H, 'authorized', RULE, ok('authorize')),
      step('A', SEEN + 2 * H, 'voided', OWNER, ok('void')),
      step('HOLD', SEEN + 3 * H, 'auto_voided', { type: 'none' }, ok('void')),
    ], DEALS, SEEN, NOW);
    expect(s.lines.map((l) => l.text)).toEqual([
      'You released 1 hold ($50.00, nothing was paid)',
      '1 hold released itself ($42.00, nothing was paid)',
    ]);
  });

  it('pluralises several holds released by themselves', () => {
    const s = awaySummary([
      step('A', SEEN + H, 'auto_voided', DEFAULT, ok('void')),
      step('HOLD', SEEN + 2 * H, 'auto_voided', DEFAULT, ok('void')),
    ], DEALS, SEEN, NOW);
    expect(s.lines[0]?.text).toBe('2 holds released themselves ($92.00, nothing was paid)');
  });

  it('separates what you paid from what your rules paid', () => {
    const s = awaySummary([
      step('A', SEEN + H, 'captured', OWNER, ok('capture')),
      step('B', SEEN + H, 'captured', RULE, ok('capture')),
    ], DEALS, SEEN, NOW);
    expect(s.lines.map((l) => l.text)).toEqual(['You paid $50.00 (1 purchase)', 'Your agents paid $33.00 under your rules (1 purchase)']);
  });

  it('never borrows an authority it did not record', () => {
    const s = awaySummary([step('A', SEEN + H, 'captured', { type: 'agent_intent' }, ok('capture'))], DEALS, SEEN, NOW);
    expect(s.lines[0]?.authority).toBe('none');
    expect(s.lines[0]?.text).toContain('who decided is not recorded');
  });

  it('counts several sales collected under the shop rules', () => {
    const second = deal('SALE2', 1500, 'seller');
    const s = awaySummary([
      step('SALE', SEEN + H, 'captured', SHOP, ok('capture')),
      step('SALE2', SEEN + 2 * H, 'captured', SHOP, ok('capture')),
    ], [...DEALS, second], SEEN, NOW);
    expect(s.lines[0]?.text).toBe('Your shop collected $105.00 after the buyer approved (2 sales)');
    expect(s.lines[0]?.deals).toEqual(['SALE', 'SALE2']);
  });

  it('counts an invoice a subscriber paid as money in', () => {
    const sub = deal('SUB', 1900, 'seller', 'USD', 'rescue');
    const s = awaySummary([step('SUB', SEEN + H, 'invoice_paid')], [sub], SEEN, NOW);
    expect(s.lines[0]?.text).toBe('A subscriber paid $19.00 by invoice');
    expect(s.inn).toEqual([{ minor: 1900, currency: 'USD' }]);
    expect(s.moved).toBe(true);
  });

  it('only counts what happened inside the window', () => {
    const s = awaySummary([
      step('A', SEEN - 60, 'captured', RULE, ok('capture')),
      step('B', NOW + 60, 'captured', RULE, ok('capture')),
      step('HOLD', SEEN, 'auto_voided', DEFAULT, ok('void')),
    ], DEALS, SEEN, NOW);
    expect(s.lines.map((l) => l.outcome)).toEqual(['released']);
  });

  it('ignores steps that tell nothing new (offers, receipts, order creation)', () => {
    const s = awaySummary([
      step('A', SEEN + H, 'offer_sent', { type: 'agent_intent' }),
      step('A', SEEN + H, 'order_created', RULE, ok('create_order')),
      step('A', SEEN + H, 'receipted'),
    ], DEALS, SEEN, NOW);
    expect(s.quiet).toBe(true);
  });

  it('reads steps in any order and points each line at its first step', () => {
    const steps = morning().reverse();
    const s = awaySummary(steps, DEALS, SEEN, NOW);
    expect(s.lines[0]?.at).toBe(SEEN + 2 * H);
    expect(s.lines[0]?.deals).toEqual(['A', 'B']);
  });

  it('keeps counting a deal it cannot price, and says so', () => {
    const s = awaySummary([
      step('A', SEEN + H, 'captured', RULE, ok('capture')),
      step('GONE', SEEN + 2 * H, 'captured', RULE, ok('capture')),
    ], DEALS, SEEN, NOW);
    expect(s.lines[0]?.count).toBe(2);
    expect(s.lines[0]?.uncounted).toBe(1);
    expect(s.lines[0]?.amount).toBe('$50.00 and more');
    const none = awaySummary([step('GONE', SEEN + H, 'captured', SHOP, ok('capture'))], [], SEEN, NOW);
    expect(none.lines[0]?.outcome).toBe('collected');
    expect(none.lines[0]?.amount).toBe('an amount not shown');
  });

  it('tells pauses, mismatches, renewals and lapses without amounts', () => {
    const s = awaySummary([
      step('A', SEEN + H, 'shield_held'),
      step('B', SEEN + H, 'mismatch', { type: 'none' }, { type: 'none' }, 'MISMATCH'),
      step('SALE', SEEN + H, 'renewal_failed'),
      step('HOLD', SEEN + H, 'expired', DEFAULT),
      step('GPU', SEEN + H, 'lapsed', DEFAULT),
    ], DEALS, SEEN, NOW);
    expect(s.lines.map((l) => l.text)).toEqual([
      'A safety check paused 1 deal before PayPal was asked',
      '1 payment request didn’t match its deal (no pay button was offered)',
      '1 subscription renewal failed (nothing is sent until you approve a fix)',
      '2 deals ran out of time (no money moved)',
    ]);
    expect(s.moved).toBe(false);
  });

  it('marks a summary read from a cut-off record as partial', () => {
    expect(awaySummary(morning(), DEALS, SEEN, NOW, { truncated: true }).partial).toBe(true);
    expect(awaySummary(morning(), DEALS, SEEN, NOW).partial).toBe(false);
  });

  it('says one thing needs you in the singular, and nothing when nothing does', () => {
    expect(awaySummary([], DEALS, SEEN, NOW, { needs: 1 }).needsLine).toBe('1 thing needs you');
    expect(awaySummary([], DEALS, SEEN, NOW).needsLine).toBeNull();
  });

  it('never names internals: no clause numbers, ids or method names', () => {
    const s = awaySummary(morning(), DEALS, SEEN, NOW, { needs: 2 });
    expect(s.text).not.toMatch(/clause|capture|authoriz|void|seller_mandate|signed_rule|\bA\b|GPU/i);
  });

  it('summarises the fixture week the mock serves (parity with deal_history)', () => {
    const state = buildMockState(NOW);
    const s = awaySummary(state.history ?? [], state.deals.map((d) => d.deal), NOW - 24 * H, NOW, { needs: 2 });
    expect(s.quiet).toBe(false);
    // The lost capture answer on the shop sale is a check, never counted as money in.
    expect(s.lines.some((l) => l.outcome === 'checking')).toBe(true);
    expect(s.lines.find((l) => l.outcome === 'checking')?.deals).toHaveLength(1);
    expect(s.lead).toBeNull();
  });
});

describe('worthShowing', () => {
  it('always shows a summary in which something happened', () => {
    const recent = awaySummary([step('A', NOW - 30, 'captured', RULE, ok('capture'))], DEALS, NOW - 60, NOW);
    expect(worthShowing(recent)).toBe(true);
  });
  it('hides a quiet summary over a moment ago, shows a long quiet stretch', () => {
    expect(worthShowing(awaySummary([], DEALS, NOW - 60, NOW))).toBe(false);
    expect(worthShowing(awaySummary([], DEALS, NOW - QUIET_NEWS_AFTER, NOW))).toBe(true);
    expect(worthShowing(awaySummary([], DEALS, SEEN, NOW))).toBe(true);
  });
});

describe('sinceWords', () => {
  const at = (d: number, h: number, m: number) => Math.floor(new Date(2026, 9, d, h, m).getTime() / 1000);
  it('says today, yesterday, a weekday or a date', () => {
    expect(sinceWords(at(8, 7, 5), NOW)).toBe('since today 07:05');
    expect(sinceWords(at(7, 18, 40), NOW)).toBe('since yesterday 18:40');
    expect(sinceWords(at(5, 9, 0), NOW)).toBe('since Mon 09:00');
    expect(sinceWords(at(1, 9, 0), NOW)).toBe('since 1 Oct 09:00');
  });
  it('says the start of today for the default', () => {
    expect(sinceWords(startOfToday(NOW), NOW)).toBe('since the start of today');
  });
});

describe('last seen', () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
  };
  it('defaults to the start of today when nothing is stored', () => {
    expect(readLastSeen(NOW, store())).toEqual({ at: startOfToday(NOW), stored: false });
    expect(readLastSeen(NOW, null)).toEqual({ at: startOfToday(NOW), stored: false });
  });
  it('round-trips a stored moment', () => {
    const s = store();
    writeLastSeen(SEEN, s);
    expect(s.m.get(LAST_SEEN_KEY)).toBe(String(SEEN));
    expect(readLastSeen(NOW, s)).toEqual({ at: SEEN, stored: true });
  });
  it('ignores garbage and moments in the future', () => {
    const s = store();
    s.setItem(LAST_SEEN_KEY, 'yesterday');
    expect(readLastSeen(NOW, s).stored).toBe(false);
    s.setItem(LAST_SEEN_KEY, String(NOW + 100));
    expect(readLastSeen(NOW, s).stored).toBe(false);
  });
  it('never throws when storage is blocked', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readLastSeen(NOW, blocked).stored).toBe(false);
    expect(() => writeLastSeen(NOW, blocked)).not.toThrow();
  });
});

describe('awaySummary: a deal that ended unconfirmed', () => {
  const U = deal('U', 6400, 'buyer', 'USD', 'haggle');
  const V = deal('V', 1000, 'buyer', 'USD', 'haggle');
  const ended = (id: string) => step(id, SEEN + 2 * H, 'unconfirmed', DEFAULT, { type: 'none' }, 'UNCONFIRMED');
  const text = (reads?: Map<string, boolean>) => awaySummary([ended('U')], [U], SEEN, NOW, { reads }).lines[0]?.text ?? '';
  it('is listed as an end, by the safe default, never as paid, and does not claim no money moved', () => {
    const s = awaySummary([ended('U')], [U], SEEN, NOW);
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]).toMatchObject({ outcome: 'unconfirmed', authority: 'default', tone: 'check', totals: [], deals: ['U'] });
    expect(s.moved).toBe(false);
    expect(s.lead).toBeNull();
    expect(s.quiet).toBe(false);
    expect(s.text).not.toContain('no money moved; ');
  });
  it('says only what is true when the deal’s read status is not known', () => {
    expect(text()).toBe('1 deal ended as not confirmed by PayPal: the seller said it was paid, but your wallet has no match for it on PayPal’s statement (this wallet moved nothing)');
    expect(text()).not.toMatch(/did not show|never showed/);
  });
  it('splits on whether a statement read came back unmatched', () => {
    expect(text(new Map([['U', true]]))).toContain('PayPal’s statement did not show it');
    const unread = text(new Map([['U', false]]));
    expect(unread).toContain('your wallet did not check PayPal’s statement');
    expect(unread).not.toMatch(/did not show|never showed/);
    // Two deals with different read status are two lines, so neither line claims the other's read.
    const both = awaySummary([ended('U'), ended('V')], [U, V], SEEN, NOW, { reads: new Map([['U', true], ['V', false]]) });
    expect(both.lines).toHaveLength(2);
  });
});

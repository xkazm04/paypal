// "Your safety record": the headline in plain words (singular, plural, zero, a finding, a broken
// chain), how much was checked, the hash route, and the mock counting the same week deal_history
// serves (main only, PayPal never asked for a refusal, nothing found).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SafetyRecord } from '@bindings/SafetyRecord';
import { mockBackend, resetMockState } from '../../../mock/backend';
import { isMoneyCall } from '../logic';
import { authorityParts, FAMILY_WORDS, safetyInHash, safetyWords, scopeWords, VIOLATION_WORDS, withSafety } from './model';

const NONE = { owner: 0, signed_rule: 0, shop_rules: 0, house_rules: 0, safe_default: 0, safe_default_voids: 0 };
const rec = (extra: Partial<SafetyRecord> = {}): SafetyRecord => ({
  checked_at: 1_800_000_000, records: 0, head: Array(32).fill(7) as SafetyRecord['head'], intact: true,
  deals_total: 0, deals_checked: 0, transcripts_verified: 0, money: NONE, refusals: 0, refusal_families: [],
  refused_deals: 0, refused_deal_calls: 0, violations: [], violations_total: 0, ...extra,
});

describe('safety record words', () => {
  it('says the brief’s week in one breath: records, who moved money, refusals PayPal never saw', () => {
    const w = safetyWords(rec({
      records: 1284, money: { ...NONE, owner: 30, signed_rule: 9, safe_default: 3, safe_default_voids: 3 }, refusals: 211,
    }));
    expect(w.tone).toBe('ok');
    expect(w.verdict).toBe('Nothing moved without your say-so.');
    expect(w.lines).toEqual([
      '1,284 records, unbroken.',
      'PayPal was asked to move money 42 times: 30 by you, 9 by rules you signed and 3 safe defaults that only cancelled.',
      'Your agents were refused 211 times; PayPal was never asked for any of them.',
    ]);
  });

  it('speaks in the singular and says the zero cases plainly, never as a count of nothing', () => {
    expect(safetyWords(rec()).lines).toEqual([
      'Nothing on record yet.',
      'PayPal hasn’t been asked to move money yet.',
      'Your agents haven’t been refused anything.',
    ]);
    const one = safetyWords(rec({ records: 1, money: { ...NONE, owner: 1, safe_default: 1, safe_default_voids: 1 }, refusals: 1 })).lines;
    expect(one).toEqual([
      '1 record, unbroken.',
      'PayPal was asked to move money twice: 1 by you and 1 safe default that only cancelled.',
      'Your agents were refused once; PayPal was never asked for any of them.',
    ]);
    expect(safetyWords(rec({ records: 2, money: { ...NONE, signed_rule: 1 } })).lines[1]).toBe('PayPal was asked to move money once: 1 by a rule you signed.');
    // The seller's shop rules and the house seller's rules are named apart from the owner's.
    expect(authorityParts({ ...NONE, shop_rules: 2, house_rules: 1 }).map((p) => [p.tone, p.words])).toEqual([
      ['rule', '1 by the house seller’s signed rules'],
      ['buyer', '2 by your shop rules after the buyer approved'],
    ]);
  });

  it('never says a safe default only cancelled unless every one of them was a cancellation', () => {
    const parts = authorityParts({ ...NONE, safe_default: 2, safe_default_voids: 1 });
    expect(parts[0]?.words).toBe('2 by a safe default');
  });

  it('turns red on any finding, keeps the counts, and stops claiming PayPal was never asked', () => {
    const w = safetyWords(rec({
      records: 40, money: { ...NONE, safe_default: 1 }, refusals: 3,
      violations: [{ deal_id: '01JD0000000000000000000000' as never, kind: 'authority', detail: 'capture (attempt 1): a safe default decided a capture' }],
      violations_total: 1,
    }));
    expect(w.tone).toBe('bad');
    expect(w.verdict).toBe('Something on record broke your safety rules.');
    expect(w.lines[2]).toBe('Your agents were refused 3 times.');
    expect(safetyWords(rec({ violations_total: 2 })).verdict).toBe('2 things on record broke your safety rules.');
  });

  it('a broken chain says so and counts nothing past it', () => {
    const w = safetyWords(rec({ intact: false, head: null, records: 12, violations_total: 1 }));
    expect(w.tone).toBe('bad');
    expect(w.verdict).toBe('Your record doesn’t check out.');
    expect(w.lines).toHaveLength(1);
    expect(w.lines[0]).toContain('12 records, and the chain linking them is broken');
    expect(scopeWords(rec({ intact: false }))).toBe('No deal could be checked.');
  });

  it('says honestly how much was checked', () => {
    expect(scopeWords(rec())).toBe('No deals yet.');
    expect(scopeWords(rec({ deals_total: 1, deals_checked: 1 }))).toBe('Your one deal was checked.');
    expect(scopeWords(rec({ deals_total: 12, deals_checked: 12 }))).toBe('All 12 deals checked.');
    expect(scopeWords(rec({ deals_total: 1204, deals_checked: 1000 }))).toBe('Checked the latest 1,000 of 1,204 deals.');
  });

  it('names no internals on Layer 1', () => {
    const text = [
      ...safetyWords(rec({ records: 5, money: { ...NONE, owner: 1, signed_rule: 1, shop_rules: 1, house_rules: 1, safe_default: 1, safe_default_voids: 1 }, refusals: 2 })).lines,
      ...Object.values(FAMILY_WORDS), ...Object.values(VIOLATION_WORDS),
    ].join(' ');
    expect(text).not.toMatch(/clause|mandate|capture|void|authoriz|audit|transcript|Rust|safety_record|_/i);
  });

  it('opens from the hash beside the main route and leaves it as formatHash wrote it when closed', () => {
    expect(safetyInHash('#m=book&p=safety')).toBe(true);
    expect(safetyInHash('#m=book')).toBe(false);
    expect(withSafety('#m=book', true)).toBe('#m=book&p=safety');
    expect(withSafety('', true)).toBe('#p=safety');
    expect(withSafety('#m=book', false)).toBe('#m=book');
  });
});

describe('the mock’s safety record', () => {
  const NOW = 1_800_000_000;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW * 1000);
    localStorage.clear(); sessionStorage.clear(); resetMockState();
    history.replaceState(null, '', '/index.html');
  });
  afterEach(() => { vi.useRealTimers(); });

  it('is main only', async () => {
    for (const label of ['tumbler', 'approval'] as const) {
      await expect(mockBackend(label).invoke('safety_record', null)).rejects.toMatchObject({ code: 'PERMISSION' });
    }
  });

  it('counts the week deal_history serves: every money call by who decided, refusals PayPal never saw, nothing found', async () => {
    const main = mockBackend('main');
    const r = await main.invoke('safety_record', null);
    const { steps } = await main.invoke('deal_history', {});
    const deals = await main.invoke('list_deals', null);
    expect(r.intact).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.deals_total).toBe(deals.length);
    expect(r.deals_checked).toBe(deals.length);
    expect(r.records).toBeGreaterThanOrEqual(steps.length);
    const money = steps.filter(isMoneyCall);
    const m = r.money;
    expect(m.owner + m.signed_rule + m.shop_rules + m.house_rules + m.safe_default).toBe(money.length);
    expect(m.safe_default).toBe(money.filter((s) => s.authority.type === 'safe_default').length);
    expect(m.safe_default_voids).toBe(m.safe_default);
    expect(m.shop_rules).toBe(money.filter((s) => s.authority.type === 'seller_mandate').length);
    // The GPU request, two pushes past the most you'll pay, two reaches for a tool agents never have.
    expect(r.refusals).toBe(5);
    expect(r.refusal_families).toEqual([{ family: 'your_rules', count: 3 }, { family: 'not_allowed', count: 2 }]);
    expect(r.refused_deals).toBe(deals.filter((d) => d.state === 'REFUSED').length);
    expect(r.refused_deal_calls).toBe(0);
    // Every refused step has no PayPal call.
    expect(steps.filter((s) => s.kind === 'intent_refused' || s.kind === 'refused').every((s) => s.paypal.type === 'none')).toBe(true);
    expect(safetyWords(r).tone).toBe('ok');
  });

  it('previews a finding and a broken chain', async () => {
    history.replaceState(null, '', '/index.html?safety=violation');
    const found = await mockBackend('main').invoke('safety_record', null);
    expect(found.violations_total).toBe(1);
    expect(found.violations[0]?.kind).toBe('authority');
    resetMockState();
    history.replaceState(null, '', '/index.html?records=broken');
    const broken = await mockBackend('main').invoke('safety_record', null);
    expect(broken.intact).toBe(false);
    expect(broken.head).toBeNull();
    expect(broken.violations[0]?.kind).toBe('chain_broken');
  });
});

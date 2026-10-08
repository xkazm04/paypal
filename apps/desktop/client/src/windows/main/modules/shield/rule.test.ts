// Shield slice 2: the rule that decided a verdict comes from the wallet core (Deal.shield_rule)
// and every surface words it from words.ts; nothing is inferred over it in TypeScript.
import { describe, expect, it } from 'vitest';
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import type { Deal } from '@bindings/Deal';
import type { ShieldRule } from '@bindings/ShieldRule';
import { shieldReleased, shieldRuleWord } from '../../../../lib/words';
import { checkLights, whyFor, whyQuestion } from './normal';
import { checkCell, reasonsFor } from './matrix';

const usd = (d: number) => ({ minor: Math.round(d * 100), currency: 'USD' as const });
const NOW = 1_800_000_000;
const H = [] as unknown as Deal['transcript_head'];
const deal = (o: Partial<Deal> = {}): Deal => ({
  id: 'D', kind: 'purchase', side: 'buyer', counterparty: 'K', state: 'AGREED', mandate_id: 'M', mandate_version: 3,
  transcript_head: H, paypal: { order: null, authorization: null, capture: null, subscription: null }, mode: 'sandbox', market: null, shield: null,
  terms: { item_ref: 'stand', qty: 2, unit_price: usd(70), currency: 'USD', delivery: { type: 'digital_now' } }, ...o,
});
const market = { p25: usd(38), median: usd(44), p75: usd(49), retrieved_at: NOW, response_hash: H, cached: false };
const fresh: CounterpartyDisplay = { key_id: 'K', display_name: 'pixel-bay', house: false, first_seen: NOW - 2 * 3600, deals_closed: 0, pairing: 'words_confirmed', declared_payee: 'pixel-bay' };
const RULES: ShieldRule[] = ['payee_mismatch', 'friends_and_family', 'no_market_reference', 'price_over_market', 'new_counterparty_over_threshold', 'model_caution'];

describe('the shield rule in plain words', () => {
  it('words every rule the wallet core can record, without its internal name', () => {
    for (const r of RULES) {
      const w = shieldRuleWord(r);
      expect(w.text.length).toBeGreaterThan(3);
      expect(`${w.text} ${w.means}`).not.toMatch(/_|clause|HOLD|ASK|BLOCK|rule \d/);
    }
    // The settled design: a new payee over the threshold only asks, it never pauses.
    expect(shieldRuleWord('new_counterparty_over_threshold').means).toContain('asks you');
  });
  it('a release counts only for the rule it names, and only while the pause reads released', () => {
    const release = { terms_hash: H, rules: ['price_over_market' as const], at: NOW };
    expect(shieldReleased(deal({ shield: 'ASK', shield_rule: 'price_over_market', shield_release: release }))).toBe(true);
    expect(shieldReleased(deal({ shield: 'ASK', shield_rule: 'model_caution', shield_release: release }))).toBe(false);
    expect(shieldReleased(deal({ shield: 'BLOCK', shield_rule: 'price_over_market', shield_release: release }))).toBe(false);
    expect(shieldReleased(deal({ shield: 'HOLD', shield_rule: 'price_over_market' }))).toBe(false);
  });
});

describe('the Shield page shows the recorded rule, not a guess', () => {
  it('a price pause from a new payee names the price, not the newness', () => {
    // D-0198: new today and 59% over the median. Rust checks the price first: a price HOLD.
    const d = deal({ market, shield: 'HOLD', shield_rule: 'price_over_market' });
    expect(reasonsFor(d, fresh, NOW).map((r) => [r.kind, r.text])).toEqual([['price', '59% above the usual price']]);
    const lights = checkLights(d, fresh, NOW);
    expect(lights.map((l) => [l.stage, l.state])).toEqual([['rules', 'unknown'], ['market', 'tripped'], ['engine', 'unknown']]);
  });
  it('each rule trips its own light and answers its own Why?', () => {
    const at = (rule: ShieldRule) => checkLights(deal({ market, shield: 'HOLD', shield_rule: rule }), fresh, NOW).map((l) => l.state);
    expect(at('payee_mismatch')).toEqual(['tripped', 'tripped', 'unknown']);
    expect(at('new_counterparty_over_threshold')[0]).toBe('tripped');
    expect(at('no_market_reference')[1]).toBe('skipped');
    expect(at('model_caution')[2]).toBe('tripped');
    for (const r of RULES) {
      const [reason] = reasonsFor(deal({ market, shield: 'HOLD', shield_rule: r }), fresh, NOW);
      expect(reason).toBeDefined();
      expect(whyQuestion(reason!.kind)).toMatch(/\?$/);
      expect(whyFor(reason!.kind, deal({ market }), fresh, NOW).join(' ')).not.toMatch(/_|clause/);
    }
  });
  it('a deal with no recorded rule keeps the facts-only reasons', () => {
    expect(reasonsFor(deal({ market, shield: 'HOLD' }), fresh, NOW).map((r) => r.kind)).toEqual(['price', 'newcp']);
  });
});

describe('a check with no result here reads calmly, never as a pass (polish 3)', () => {
  it('another recorded rule: the other groups "Didn’t stop it", dashed, with the reason it is not a pass', () => {
    const lights = checkLights(deal({ market, shield: 'HOLD', shield_rule: 'price_over_market' }), fresh, NOW);
    expect(lights.map((l) => [l.state, l.word])).toEqual([['unknown', 'Didn’t stop it'], ['tripped', 'Too high'], ['unknown', 'Didn’t stop it']]);
    for (const l of lights) expect(`${l.word} ${l.detail}`).not.toMatch(/shown here|this window/i);
    expect(lights[0]!.detail).toMatch(/aren’t marked as passed/);
  });
  it('a cleared payment: "No alert"; no recorded rule on a pause: "Not reported"; never "passed"', () => {
    const old = { ...fresh, first_seen: NOW - 9 * 86400 };
    const clear = checkLights(deal({ market: { ...market, median: usd(66) }, shield: 'CLEAR' }), old, NOW);
    expect(clear.map((l) => l.word)).toEqual(['No alert', 'Fine', 'No alert']);
    const legacy = checkLights(deal({ market: { ...market, median: usd(66) }, shield: 'HOLD' }), old, NOW);
    expect(legacy.map((l) => [l.state, l.word])).toEqual([['unknown', 'Not reported'], ['passed', 'Fine'], ['unknown', 'Not reported']]);
  });
  it('the matrix cell of the check that decided is a fact; the others stay dashed with the same words', () => {
    const d = deal({ market, shield: 'BLOCK', shield_rule: 'payee_mismatch' });
    expect(checkCell('payee', d, fresh, NOW)).toMatchObject({ r: 'fact', s: 'different payee' });
    expect(checkCell('ff', d, fresh, NOW)).toMatchObject({ r: 'na', s: 'didn’t stop it' });
    expect(checkCell('typology', deal({ shield: 'CLEAR' }), fresh, NOW)).toMatchObject({ r: 'na', s: 'no alert' });
    expect(checkCell('typology', deal(), fresh, NOW)).toMatchObject({ r: 'na', s: 'not reported' });
  });
});

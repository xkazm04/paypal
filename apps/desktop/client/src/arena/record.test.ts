// Break The Table's record is the real wallet's answers (crates/table-app/tests/gauntlet/arena.rs
// writes and pins it). These checks keep the page honest about it: every card has words, every
// refusal names its rule, and the record itself says nothing reached PayPal.
import { describe, expect, it } from 'vitest';
import { RULE_NAME } from '../lib/words/arena';
import { ATTACK_WORDS, minorOf } from './model';
import { DAN_LABEL, RECORDED, signedSteps } from '../mock/haggle';
import { mockBackend, resetMockState } from '../mock/backend';
import { isRefusal, RECORD } from './record';

describe('the arena record', () => {
  it('is the recorder’s format, with its check command and seed', () => {
    expect(RECORD.format).toBe('table-arena/1');
    expect(RECORD.check).toBe('cargo test -p table-app --test gauntlet arena');
    expect(RECORD.seed).toMatch(/^0x[0-9a-f]+$/);
    expect(RECORD.attacks.length).toBe(RECORD.totals.attacks);
    expect(RECORD.attacks.length).toBeGreaterThanOrEqual(8);
  });

  it('has words for every card, and no words for a card it does not hold', () => {
    const ids = RECORD.attacks.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(ATTACK_WORDS).sort()).toEqual([...ids].sort());
  });

  it('names the rule behind every refusal code it holds', () => {
    for (const a of RECORD.attacks) if (isRefusal(a.answer)) expect(RULE_NAME[a.answer.code], a.id).toBeTruthy();
  });

  it('records nothing reaching PayPal, no stored call, no money step and a clean ledger', () => {
    expect(RECORD.totals).toMatchObject({ paypal_requests: 0, paypal_calls: 0, money_operations: 0 });
    for (const a of RECORD.attacks) {
      expect([a.paypal_requests, a.paypal_calls, a.money_operations, a.violations, a.envelopes_out], a.id).toEqual([0, 0, 0, 0, 0]);
    }
  });

  it('carries totals that are the sums of its own attacks and sessions (the page shows these, never a typed count)', () => {
    const sum = (k: 'paypal_requests' | 'paypal_calls' | 'money_operations') => RECORD.attacks.reduce((n, a) => n + a[k], 0);
    expect(RECORD.totals).toEqual({ attacks: RECORD.attacks.length, paypal_requests: sum('paypal_requests'), paypal_calls: sum('paypal_calls'), money_operations: sum('money_operations') });
    const g = RECORD.gauntlet;
    expect(Object.values(g.refusals).reduce((n, x) => n + x, 0)).toBe(g.refused);
    expect(g.refused).toBeLessThanOrEqual(g.agent_calls);
  });

  it('pairs each refused agent call with the one intent.refused row naming its code', () => {
    for (const a of RECORD.attacks.filter((x) => x.suit === 'agent')) {
      expect(a.refused, a.id).toBe(true);
      if (!isRefusal(a.answer)) throw new Error(`${a.id} has no code`);
      const rows = a.audit.filter((r) => r.action === 'intent.refused');
      expect(rows, a.id).toHaveLength(1);
      expect((rows[0]?.detail.code as { code: string }).code, a.id).toBe(a.answer.code);
    }
  });

  it('lands on the engine’s recorded table: Dan’s, step for step, on her recorded rules (the preview’s D-0193)', async () => {
    const dan = RECORDED.dan;
    expect(RECORD.recording).toEqual({ file: 'apps/desktop/client/src/mock/haggle.json', table: 'dan' });
    const steps = signedSteps(dan);
    expect(RECORD.table.history.map((s) => [s.by === 'you' ? 'agent' : 'seller', s.price?.minor])).toEqual(steps.map((s) => [s.by, s.price]));
    expect(minorOf(RECORD.rules.most)).toBe(dan.rules.ceiling);
    expect(minorOf(RECORD.rules.in_person_over)).toBe(dan.rules.ask_above);
    expect(minorOf(RECORD.rules.per_deal)).toBe(dan.rules.per_deal);
    expect(RECORD.rules.least === null ? null : minorOf(RECORD.rules.least)).toBe(dan.rules.floor);
    expect(RECORD.rules.offers).toBe(dan.rules.max_offers);
    // The refused yes is the recorded one: the same price, the same rule.
    const refused = dan.steps.find((s) => s.act === 'refused');
    const accept = RECORD.attacks.find((a) => a.id === 'accept-over-her-line');
    expect(accept && isRefusal(accept.answer) ? accept.answer.clause : null).toBe(refused?.clause);
    expect(RECORD.table.price).toEqual({ currency: 'USD', minor: refused?.price });
    // And the sample world's D-0193, where a played refusal lands, is that same table.
    resetMockState();
    const main = mockBackend('main');
    const id = main.world.deal(DAN_LABEL)?.deal.id ?? '';
    const transcript = await main.invoke('deal_transcript', { deal_id: id });
    expect(transcript.map((t) => t.price?.minor)).toEqual(steps.map((s) => s.price));
  });

  it('shows the agent its table after a seller’s attack, with no seller words in it', () => {
    for (const a of RECORD.attacks.filter((x) => x.suit === 'counterparty')) {
      expect(a.agent_saw, a.id).toBeTruthy();
      const saw = JSON.stringify(a.agent_saw);
      if (typeof a.sent.text === 'string') expect(saw).not.toContain(a.sent.text.slice(0, 12));
      expect(saw).not.toMatch(/SYSTEM|ignore your rules/i);
    }
  });
});

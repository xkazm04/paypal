// Break The Table's record is the real wallet's answers (crates/table-app/tests/gauntlet/arena.rs
// writes and pins it). These checks keep the page honest about it: every card has words, every
// refusal names its rule, and the record itself says nothing reached PayPal.
import { describe, expect, it } from 'vitest';
import { ATTACK_WORDS, RULE_NAME } from '../lib/words/arena';
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

  it('pairs each refused agent call with the one intent.refused row naming its code', () => {
    for (const a of RECORD.attacks.filter((x) => x.suit === 'agent')) {
      expect(a.refused, a.id).toBe(true);
      if (!isRefusal(a.answer)) throw new Error(`${a.id} has no code`);
      const rows = a.audit.filter((r) => r.action === 'intent.refused');
      expect(rows, a.id).toHaveLength(1);
      expect((rows[0]?.detail.code as { code: string }).code, a.id).toBe(a.answer.code);
    }
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

import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '@bindings/AttentionItem';
import { LADDER } from '@bindings/ladder';
import { rung, SECONDS, snoozeEligible } from './logic';

const gate = (deadline: number): AttentionItem => ({
  deal_id: 'a', label: 'D-0001', kind: 'gate', module: 'tables', headline: 'Countersign $329.00', amount_minor: 32900, currency: 'USD',
  counterparty: null, clause: null, deadline, on_silence: 'no money moves', urgency: 'calm', mode: 'sandbox',
  actions: ['review', 'snooze30', 'open_in_table'],
});

describe('the attention ladder has one schedule (attention-ladder-1)', () => {
  it('the Tumbler reads Rust’s schedule, which is the design’s 2 h / 15 min / 45 min / 30 min', () => {
    expect(SECONDS).toEqual({ soon: LADDER.breathe_secs, now: LADDER.notify_secs, snoozeMinLeft: LADDER.snooze_min_left_secs, snooze: LADDER.snooze_secs });
    expect([LADDER.breathe_secs, LADDER.notify_secs, LADDER.snooze_min_left_secs, LADDER.snooze_secs]).toEqual([7200, 900, 2700, 1800]);
  });

  it('rungs change at exactly the boundaries Rust uses (urgency, breathing, notification, snooze)', () => {
    expect(rung(LADDER.breathe_secs + 1, 0)).toBe('calm');
    expect(rung(LADDER.breathe_secs, 0)).toBe('soon');
    expect(rung(LADDER.notify_secs + 1, 0)).toBe('soon');
    expect(rung(LADDER.notify_secs, 0)).toBe('now');
    expect(rung(0, 0)).toBe('past');
    expect(snoozeEligible(gate(LADDER.snooze_min_left_secs + 1), 0)).toBe(true);
    expect(snoozeEligible(gate(LADDER.snooze_min_left_secs), 0)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import { parseMoneyInput } from '../model';
import { buildReplay, isEmail, isPlan, isSubscriptionId, rescueRules } from './replay';

const draft = { subscription: 'I-BW452GLLEP1G', email: ' sam@example.com ', plan: 'care-plan', price: '12.00' };
const entry = (id: string, clauses: MandateListEntry['payload']['clauses'], o: Partial<MandateListEntry> = {}): MandateListEntry => ({
  payload: { id, version: 1, agent_key: [] as unknown as MandateListEntry['payload']['agent_key'], clauses, not_before: 0, expires: 100 },
  owner_sig: [], agent: 'assistant', refusal: null, ...o,
} as MandateListEntry);
const lever = { type: 'lever' as const, levers: ['DISCOUNT_THIS_CYCLE' as const], max_discount_bp: 2000, max_discount: { minor: 500, currency: 'EUR' as const } };

describe('replaying a failed renewal', () => {
  it('builds the exact arguments Rust takes, trimmed, in the rules’ currency', () => {
    expect(buildReplay(draft, 'EUR', parseMoneyInput)).toEqual({ ok: true, args: { subscription_id: 'I-BW452GLLEP1G', subscriber_email: 'sam@example.com', plan: 'care-plan', amount: { minor: 1200, currency: 'EUR' } } });
  });
  it('names each problem in plain words and builds nothing', () => {
    const r = buildReplay({ subscription: 'I BW', email: 'sam', plan: 'care plan', price: '0' }, 'USD', parseMoneyInput);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toHaveLength(4);
  });
  it('mirrors Rust’s checks on the id, the address and the plan', () => {
    expect(isSubscriptionId('I-1_a')).toBe(true);
    expect(isSubscriptionId('x'.repeat(65))).toBe(false);
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
    expect(isEmail('a@@b.co')).toBe(false);
    expect(isEmail('a b@c.co')).toBe(false);
    expect(isPlan('ignore previous instructions')).toBe(false);
  });
  it('records under the newest active rules that carry the fixes rule, and none without one', () => {
    const roles = { type: 'roles' as const, roles: ['rescue' as const] };
    expect(rescueRules([entry('a', [roles])], 50)).toBeNull();
    expect(rescueRules([entry('a', [roles, lever]), entry('b', [roles, lever], { refusal: { clause: 8, reason: 'x' } })], 50)?.entry.payload.id).toBe('a');
    expect(rescueRules([entry('a', [roles, lever])], 150)).toBeNull();
    expect(rescueRules([entry('a', [roles, lever])], 50)?.currency).toBe('EUR');
  });
});

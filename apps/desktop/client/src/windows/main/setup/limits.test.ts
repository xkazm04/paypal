import { describe, expect, it } from 'vitest';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import { buildMockState } from '../../../mock/fixtures';
import { agentTitle, limitLines, rulesAnswer, ruleState, setsLine } from './limits';

const NOW = 1_800_000_000;
const state = buildMockState(NOW);
const slot = (id: string) => state.mandateSlots?.[id] ?? 'negotiator';
const list: MandateListEntry[] = state.mandates.map((m) => ({ agent: slot(m.payload.id), payload: m.payload, owner_sig: m.owner_sig }));
const by = (agent: string) => list.filter((m) => m.agent === agent);

describe('agent rule cards', () => {
  it('shows at most three limits, per deal first, in reading order', () => {
    for (const m of list) {
      const l = limitLines(m.payload.clauses);
      expect(l.length).toBeGreaterThan(0);
      expect(l.length).toBeLessThanOrEqual(3);
      expect(l[0]?.key).toBe('per_deal');
      expect(l[l.length - 1]?.key === 'ask' || l[l.length - 1]?.key === 'velocity').toBe(true);
    }
  });

  it('a buyer shows the most it will pay; a seller the least it will accept; a shopper has no price range', () => {
    const negotiator = by('negotiator').flatMap((m) => limitLines(m.payload.clauses));
    expect(negotiator.find((x) => x.key === 'band')?.label).toBe('most you’ll pay');
    const assistant = by('assistant').flatMap((m) => limitLines(m.payload.clauses));
    expect(assistant.find((x) => x.key === 'band')?.label).toBe('least you’ll accept');
    expect(limitLines(by('shopper')[0]?.payload.clauses ?? []).some((x) => x.key === 'band')).toBe(false);
  });

  it('words, not clause numbers or ids, and money as formatted money', () => {
    const l = limitLines(by('shopper')[0]?.payload.clauses ?? []);
    expect(l[0]).toEqual({ key: 'per_deal', value: '$200.00', label: 'most per purchase' });
    expect(l.find((x) => x.key === 'ask')).toEqual({ key: 'ask', value: '$250.00', label: 'above this it asks you' });
    for (const x of l) expect(`${x.value} ${x.label}`).not.toMatch(/clause|rule \d|p\d+/i);
  });

  it('names a card by its agent, telling several sets of one agent apart', () => {
    expect(agentTitle('shopper')).toBe('Shopper');
    expect(agentTitle('assistant', ['shop order'])).toBe('Assistant · shop order');
    expect(agentTitle('')).toBe('Agent');
  });

  it('counts rule sets beside agents only when an agent holds several', () => {
    expect(setsLine(list.filter((m, i, a) => a.findIndex((x) => x.agent === m.agent) === i))).toBeNull();
    expect(setsLine([])).toBeNull();
    const latest = list.filter((m, i, a) => !a.some((x, j) => j !== i && x.payload.id === m.payload.id && x.payload.version > m.payload.version));
    expect(setsLine(latest)).toBe('3 agents · 5 rule sets');
    expect(setsLine([{ agent: 'assistant' }, { agent: 'assistant' }])).toBe('1 agent · 2 rule sets');
  });

  it('a rule set is active only inside its window', () => {
    const p = { not_before: NOW - 10, expires: NOW + 10 };
    expect(ruleState(p, NOW)).toBe('active');
    expect(ruleState({ ...p, not_before: NOW + 1 }, NOW)).toBe('soon');
    expect(ruleState({ ...p, expires: NOW }, NOW)).toBe('ended');
  });

  it('the answer: nothing signed is gold, all in force is done, an unsigned or ended set is gold', () => {
    expect(rulesAnswer([], NOW)).toMatchObject({ tone: 'need', title: 'No rules are signed yet' });
    expect(rulesAnswer(list, NOW)).toMatchObject({ tone: 'done', title: '3 agents work inside limits you signed' });
    const [first, ...rest] = list;
    if (!first) throw new Error('fixture has mandates');
    expect(rulesAnswer([{ ...first, owner_sig: [] }, ...rest], NOW)).toMatchObject({ tone: 'need', title: '1 rule set is not in force' });
    expect(rulesAnswer([{ ...first, payload: { ...first.payload, expires: NOW - 1 } }, ...rest], NOW).tone).toBe('need');
    expect(rulesAnswer([{ ...first, refusal: { clause: 4, reason: 'band lacks the side the allowed roles use' } }, ...rest], NOW)).toMatchObject({ tone: 'need', title: '1 rule set is not in force' });
  });
});

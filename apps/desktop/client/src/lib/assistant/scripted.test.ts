import { describe, expect, it } from 'vitest';
import type { AssistantReply, DigestInput, UiOp } from './contract';
import { MAYA_DEALS, firstRun, knownOf, mayaWeek } from './fixtures';
import { answerScripted, createScriptedEngine } from './scripted';
import { validateReply } from './validate';

const QUESTIONS = [
  'What needs me?',
  'What if I do nothing?',
  'How much money today?',
  'How much room is left today?',
  'Failed renewals',
  'Any failed renewals to rescue?',
  'What happened this week?',
  'My rules',
  'Show my safety record',
  'What did Shield stop?',
  'What did Tables do?',
  'What did Spend do?',
  'Anything at the Counter?',
  'Tell me about Book',
  'Tell me about Rescue',
  'Show the book',
  'D-0193',
  'what about 0188?',
  'tell me about q-0044',
  'the monitor from Dan',
  'Set me up',
  'Help',
  'What can you do?',
  'zzz qqq xyzzy',
  '',
  '   ',
];

const answer = async (q: string, input: DigestInput): Promise<AssistantReply> => (await createScriptedEngine().ask(q, input)) as AssistantReply;
const panelsOf = (r: AssistantReply): string[] => r.ops.filter((o): o is Extract<UiOp, { op: 'show' }> => o.op === 'show').map((o) => o.panel.kind);

describe('scripted engine: every reply validates unchanged (B5)', () => {
  for (const [name, make] of [['Maya week', mayaWeek], ['first run', firstRun]] as const) {
    it(`${name}: all ${QUESTIONS.length} questions`, async () => {
      const input = make();
      for (const q of QUESTIONS) {
        const raw = await answer(q, input);
        const v = validateReply(raw, knownOf(input));
        expect(v.dropped, q).toEqual({ count: 0, reasons: [] });
        expect(v.repaired, q).toBe(false);
        expect(v.say, q).toBe(raw.say);
        expect(v.ops, q).toEqual(raw.ops);
        expect(v.say.length, q).toBeGreaterThan(0);
        expect(v.say.length, q).toBeLessThanOrEqual(600);
      }
    });
  }
});

describe('scripted engine: intents answer from the digest (Maya week)', () => {
  const input = mayaWeek();

  it('what needs me: counts, soonest, no-money-moves line, proposes the soonest decision', async () => {
    const r = await answer('What needs me?', input);
    expect(r.say).toContain('2 things wait on you');
    expect(r.say).toContain('Monitor from Dan');
    expect(r.say).toContain('2 h 30 m left');
    expect(r.say).toContain('If you do nothing');
    expect(panelsOf(r)).toEqual(['needs']);
    expect(r.ops).toContainEqual({ op: 'propose', action: { action: 'open_decision', deal_id: 'D-0193' }, why: expect.stringContaining('If you do nothing') });
  });

  it('what if I do nothing: each waiting item says what it does on its own', async () => {
    const r = await answer('What if I do nothing?', input);
    expect(r.say).toContain('the offer lapses and nothing is paid');
    expect(r.say).toContain('PayPal retries on its own');
    expect(r.say).toContain('If you do nothing');
  });

  it('money today: speaks the numbers of the digest', async () => {
    const r = await answer('How much room is left today?', input);
    expect(r.say).toContain('$510.00 of $900.00');
    expect(r.say).toContain('$129.00 is held');
    expect(r.say).toContain('$68.00');
    expect(panelsOf(r)).toEqual(['money']);
  });

  it('rescue, week, rules, safety', async () => {
    const rescue = await answer('Failed renewals', input);
    expect(panelsOf(rescue)).toEqual(['rescue']);
    expect(rescue.say).toContain('1 needs you');
    expect(rescue.ops).toContainEqual(expect.objectContaining({ op: 'propose', action: { action: 'open_decision', deal_id: 'D-0188' } }));
    expect(panelsOf(await answer('What happened this week?', input))).toEqual(['week']);
    const rules = await answer('My rules', input);
    expect(rules.say).toContain('3 rule sets are in force');
    expect(panelsOf(rules)).toEqual(['rules']);
    const safety = await answer('safety record', input);
    expect(safety.say).toContain('2 deals were stopped, 1 of them by Shield');
  });

  it('every module: filters the book to that module', async () => {
    for (const [q, module] of [['Tell me about Tables', 'tables'], ['What did Spend do?', 'spend'], ['Anything at the Counter?', 'counter'], ['What did Shield stop?', 'shield']] as const) {
      const r = await answer(q, input);
      expect(r.ops, q).toContainEqual(expect.objectContaining({ op: 'filter', module }));
    }
    const shield = await answer('What did Shield stop?', input);
    expect(shield.say).toBe('Shield stopped 1 deal.');
    expect(shield.ops).toContainEqual({ op: 'filter', module: 'shield', fate: 'stopped' });
    expect(panelsOf(await answer('Tell me about Rescue', input))).toEqual(['rescue']);
    expect(panelsOf(await answer('Tell me about Book', input))).toEqual(['book']);
  });

  it('one deal by id, by fragment and by label', async () => {
    const byId = await answer('D-0193', input);
    expect(byId.ops[0]).toEqual({ op: 'show', panel: { kind: 'decision', deal_id: 'D-0193' } });
    const frag = await answer('what about 0188?', input);
    expect(frag.ops[0]).toEqual({ op: 'show', panel: { kind: 'decision', deal_id: 'D-0188' } });
    const paid = await answer('tell me about d-0171', input);
    expect(paid.ops[0]).toEqual({ op: 'show', panel: { kind: 'deal', deal_id: 'D-0171' } });
    const label = await answer('the monitor from Dan', input);
    expect(label.ops[0]).toEqual({ op: 'show', panel: { kind: 'decision', deal_id: 'D-0193' } });
  });

  it('unknown input takes the nearest-panel path and invents nothing', async () => {
    const r = await answer('zzz qqq xyzzy', input);
    expect(r.say).toContain("can't answer that");
    expect(panelsOf(r)).toEqual(['needs']);
    expect(r.ops).toHaveLength(1);
    expect(r.say).not.toMatch(/\d/);
  });

  it('never proposes anything that decides: only the three allowlisted actions', async () => {
    for (const q of QUESTIONS) {
      const r = await answer(q, input);
      for (const o of r.ops) if (o.op === 'propose') expect(['open_decision', 'open_setup', 'open_console']).toContain(o.action.action);
    }
  });
});

describe('scripted engine: first run', () => {
  const input = firstRun();

  it('what needs me points at setup, not at an empty board', async () => {
    const r = await answer('What needs me?', input);
    expect(panelsOf(r)).toEqual(['setup']);
    expect(r.say).toContain('Setup comes first');
  });

  it('setup proposes the next step', async () => {
    const r = await answer('Set me up', input);
    expect(r.ops).toContainEqual({ op: 'propose', action: { action: 'open_setup', target: 'credentials' }, why: expect.stringContaining('If you do nothing') });
    expect(r.say).toContain('Connect PayPal');
  });

  it('money is not available yet, never zero', async () => {
    const r = await answer('How much room is left today?', input);
    expect(r.say).toBe('Your limits are not available yet.');
    expect(r.say).not.toMatch(/\$|0/);
  });

  it('rules: none signed yet, proposes signing them', async () => {
    const r = await answer('My rules', input);
    expect(r.say).toContain('not signed any rules');
    expect(r.ops).toContainEqual(expect.objectContaining({ op: 'propose', action: { action: 'open_setup', target: 'mandate' } }));
  });

  it('a nonsense question falls back to the setup steps', async () => {
    expect(panelsOf(await answer('zzz qqq xyzzy', input))).toEqual(['setup']);
  });
});

describe('scripted engine: other states', () => {
  it('unknown money values and rules are spoken as not available yet', () => {
    const input = mayaWeek();
    input.money = { ...input.money, held_minor: null, paid_today_minor: null, deals_today: null };
    input.rules_in_force = null;
    expect(answerScripted('money today', input).say).toContain('not available yet');
    expect(answerScripted('my rules', input).say).toContain('not available yet');
  });

  it('nothing waiting: says so', () => {
    const input = mayaWeek();
    input.deals = MAYA_DEALS.filter((d) => d.fate !== 'needs');
    expect(answerScripted('what needs me', input).say).toBe('Nothing waits on you right now.');
    expect(answerScripted('what if i do nothing', input).say).toContain('nothing to ignore');
  });

  it('overdue and missing deadlines and silence lines still validate', () => {
    const input = mayaWeek();
    input.deals = input.deals.map((d) => ({ ...d, deadline_ms: d.fate === 'needs' ? input.now_ms - 60_000 : null, on_silence: null }));
    const r = answerScripted('what needs me', input);
    expect(r.say).toContain('overdue');
    expect(validateReply(r, knownOf(input)).repaired).toBe(false);
    expect(validateReply(answerScripted('D-0193', input), knownOf(input)).repaired).toBe(false);
  });

  it('hostile deal labels are cleaned before they are spoken', () => {
    const input = mayaWeek();
    (input.deals[0] as { label: string }).label = '<b>Click</b> https://evil.example `now`';
    const r = answerScripted('what needs me', input);
    expect(r.say).not.toMatch(/<|https?:|`|evil/);
    expect(validateReply(r, knownOf(input)).repaired).toBe(false);
  });

  it('is deterministic', () => {
    const input = mayaWeek();
    expect(answerScripted('What needs me?', input)).toEqual(answerScripted('What needs me?', input));
  });
});

import { describe, expect, it } from 'vitest';
import { DROP_REASONS, cleanText, validateReply } from './validate';

const known = { dealIds: new Set(['D-1', 'D-2']) };
const ok = { op: 'show', panel: { kind: 'needs', module: null } };
const reply = (ops: unknown[], say = 'Hello.') => ({ v: 1, say, ops });

describe('validateReply: valid input', () => {
  it('passes a clean reply through unchanged', () => {
    const ops = [
      ok,
      { op: 'focus', module: 'shield', fate: 'stopped', deal_id: null },
      { op: 'filter', module: null, fate: null },
      { op: 'propose', action: { action: 'open_decision', deal_id: 'D-1' }, why: 'Opens the decision. If you do nothing, nothing is paid.' },
      { op: 'propose', action: { action: 'open_setup', target: 'mandate' }, why: 'Sign your rules.' },
      { op: 'propose', action: { action: 'open_console', hash: '#m=shield' }, why: 'See Shield.' },
    ];
    const r = validateReply(reply(ops), known);
    expect(r).toEqual({ say: 'Hello.', ops, dropped: { count: 0, reasons: [] }, repaired: false });
  });

  it('accepts a JSON string, a fenced one and one with prose around it (repaired)', () => {
    const body = JSON.stringify(reply([ok]));
    expect(validateReply(body, known).repaired).toBe(false);
    expect(validateReply(body, known).ops).toHaveLength(1);
    const fenced = validateReply('```json\n' + body + '\n```', known);
    expect(fenced.ops).toHaveLength(1);
    expect(fenced.repaired).toBe(true);
    const prose = validateReply('Sure! ' + body + ' Hope that helps.', known);
    expect(prose.ops).toHaveLength(1);
    expect(prose.repaired).toBe(true);
  });
});

describe('validateReply: hostile input (B2)', () => {
  const garbage: unknown[] = [null, undefined, 0, 42, true, [], [1, 2], 'hello', '', '   ', '{not json', JSON.stringify('a string'), JSON.stringify(null), JSON.stringify([ok]), { a: { b: { c: [1, { d: 2 }] } } }, { v: 2, say: 'x', ops: [] }, Symbol('x'), () => 1, { v: 1 }];
  it('never throws and answers unreadable for garbage', () => {
    for (const g of garbage) {
      const r = validateReply(g, known);
      expect(r).toEqual({ say: '', ops: [], dropped: { count: 1, reasons: ['unreadable'] }, repaired: false });
    }
  });

  it('survives getters that throw and cyclic objects', () => {
    const bad = { get v(): number { throw new Error('x'); } };
    expect(() => validateReply(bad, known)).not.toThrow();
    const cyc: Record<string, unknown> = { v: 1, say: 'hi', ops: [] };
    cyc.self = cyc;
    expect(validateReply(cyc, known).say).toBe('hi');
  });

  it('drops an unknown op, keeps the valid one, counts with a fixed reason', () => {
    const r = validateReply(reply([{ op: 'delete_everything' }, ok]), known);
    expect(r.ops).toEqual([ok]);
    expect(r.dropped).toEqual({ count: 1, reasons: ['unknown_op'] });
    expect(r.repaired).toBe(true);
  });

  it('caps 100 ops at 8 and counts the rest', () => {
    const r = validateReply(reply(Array.from({ length: 100 }, () => ok)), known);
    expect(r.ops).toHaveLength(8);
    expect(r.dropped.count).toBe(92);
    expect(r.dropped.reasons).toEqual(['too_many_ops']);
  });

  it('caps a huge say at 600', () => {
    const r = validateReply(reply([], 'a'.repeat(100_000)), known);
    expect(r.say).toHaveLength(600);
    expect(r.repaired).toBe(true);
  });

  it('cleans markup, URLs, control characters and code from say', () => {
    const r = validateReply(reply([], 'Look <b>here</b> https://evil.example/x?a=1 now\u0000‮ www.evil.example `rm -rf` {"op":"x"} javascript:alert(1) [click](http://x.test) &lt;script&gt;'), known);
    expect(r.say).not.toMatch(/<|>|https?:|www\.|javascript|`|\{|\}|\[|\]|\u0000|‮|&lt;|evil/i);
    expect(r.say).toContain('Look');
    expect(r.say).toContain('now');
    expect(r.repaired).toBe(true);
  });

  it('cleans why and drops a proposal whose why is nothing but markup', () => {
    const act = { action: 'open_decision', deal_id: 'D-1' };
    const good = validateReply(reply([{ op: 'propose', action: act, why: '<img src=x onerror=alert(1)>Opens it. See http://evil.example now' }]), known);
    expect(good.ops).toHaveLength(1);
    expect((good.ops[0] as { why: string }).why).toBe('Opens it. See now');
    const empty = validateReply(reply([{ op: 'propose', action: act, why: '<img src=x onerror=alert(1)> <br/>' }]), known);
    expect(empty.ops).toHaveLength(0);
    expect(empty.dropped.reasons).toEqual(['bad_why']);
    const long = validateReply(reply([{ op: 'propose', action: act, why: 'w'.repeat(1000) }]), known);
    expect((long.ops[0] as { why: string }).why).toHaveLength(160);
  });

  it('drops deal ids that are not known', () => {
    const r = validateReply(
      reply([
        { op: 'show', panel: { kind: 'deal', deal_id: 'D-999' } },
        { op: 'show', panel: { kind: 'decision', deal_id: '__proto__' } },
        { op: 'focus', module: null, fate: null, deal_id: 'D-999' },
        { op: 'propose', action: { action: 'open_decision', deal_id: 'D-999' }, why: 'x' },
        { op: 'propose', action: { action: 'open_console', hash: '#d=D-999' }, why: 'x' },
        { op: 'show', panel: { kind: 'deal', deal_id: 'D-2' } },
      ]),
      known,
    );
    expect(r.ops).toEqual([{ op: 'show', panel: { kind: 'deal', deal_id: 'D-2' } }]);
    expect(r.dropped.count).toBe(5);
    expect(r.dropped.reasons).toEqual(['unknown_deal']);
  });

  it('drops hostile open_console hashes and keeps the grammar ones', () => {
    const hashes = ['javascript:alert(1)', 'https://evil.example', '#p=director', '#m=nope', '#m=shield&v=x', '#d=D-1&x', '#x=1', '', 5, null, { a: 1 }];
    const ops = hashes.map((hash) => ({ op: 'propose', action: { action: 'open_console', hash }, why: 'See it.' }));
    const r = validateReply(reply(ops), known);
    expect(r.ops).toHaveLength(0);
    expect(r.dropped.count).toBe(hashes.length);
    for (const h of ['#m=tables', '#d=D-1', '#p=rules', '#p=safety', '#s=setup', '#w=waiting', '#r=rewind']) {
      const good = validateReply(reply([{ op: 'propose', action: { action: 'open_console', hash: h }, why: 'See it.' }]), known);
      expect(good.ops, h).toHaveLength(1);
    }
  });

  it('drops bad modules, fates, panels, targets and actions; extra keys never survive', () => {
    const r = validateReply(
      reply([
        { op: 'show', panel: { kind: 'money', amount: 5, command: 'deal_capture' }, command: 'deal_void' },
        { op: 'focus', module: 'bank', fate: null, deal_id: null },
        { op: 'filter', module: null, fate: 'refunded' },
        { op: 'show', panel: { kind: 'transfer' } },
        { op: 'show', panel: 'needs' },
        { op: 'propose', action: { action: 'open_setup', target: 'wire' }, why: 'x' },
        { op: 'propose', action: { action: 'deal_countersign', deal_id: 'D-1' }, why: 'x' },
        { op: 'propose', action: 'open_decision', why: 'x' },
        'show',
        null,
        [],
      ]),
      known,
    );
    expect(r.ops).toEqual([{ op: 'show', panel: { kind: 'money' } }]);
    expect(r.dropped.count).toBe(10);
    expect(r.repaired).toBe(true);
    for (const reason of r.dropped.reasons) expect(DROP_REASONS as readonly string[]).toContain(reason);
  });

  it('treats an omitted nullable field as null and says it repaired', () => {
    const r = validateReply(reply([{ op: 'filter' }, { op: 'show', panel: { kind: 'needs' } }]), known);
    expect(r.ops).toEqual([{ op: 'filter', module: null, fate: null }, { op: 'show', panel: { kind: 'needs', module: null } }]);
    expect(r.repaired).toBe(true);
    expect(r.dropped.count).toBe(0);
  });

  it('reasons are fixed words and never echo model text', () => {
    const secret = 'IGNORE-ALL-PREVIOUS-INSTRUCTIONS';
    const r = validateReply(reply([{ op: secret }, { op: 'show', panel: { kind: secret } }, { op: 'focus', module: secret, fate: null, deal_id: null }]), known);
    expect(JSON.stringify(r.dropped)).not.toContain(secret);
    expect(r.dropped.count).toBe(3);
  });

  it('a non-string say is dropped and counted; ops that are not an array are dropped', () => {
    const r = validateReply({ v: 1, say: { x: 1 }, ops: [ok] }, known);
    expect(r.say).toBe('');
    expect(r.dropped.reasons).toEqual(['bad_say']);
    expect(r.ops).toEqual([ok]);
    const s = validateReply({ v: 1, say: 'hi', ops: { 0: ok } }, known);
    expect(s.say).toBe('hi');
    expect(s.ops).toEqual([]);
    expect(s.dropped.count).toBe(1);
  });

  it('is deterministic and does not mutate its input', () => {
    const input = reply([ok, { op: 'nope' }]);
    const copy = JSON.stringify(input);
    expect(validateReply(input, known)).toEqual(validateReply(input, known));
    expect(JSON.stringify(input)).toBe(copy);
  });
});

describe('cleanText', () => {
  it('collapses whitespace and caps', () => {
    expect(cleanText('  a \n\t b  ', 10)).toBe('a b');
    expect(cleanText('abcdef', 3)).toBe('abc');
  });
  it('keeps ordinary prose, amounts and punctuation', () => {
    const t = "Dan's offer is $329.00, inside your $340 ceiling. 2 h 10 m left (soonest).";
    expect(cleanText(t, 600)).toBe(t);
  });
});

describe('validateReply: the safe act (pause_agents)', () => {
  const pause = { op: 'propose', action: { action: 'pause_agents' }, why: 'You asked to stop them. If you do nothing, they keep working inside your rules.' };
  it('passes a clean pause proposal unchanged', () => {
    expect(validateReply(reply([pause]), known)).toEqual({ say: 'Hello.', ops: [pause], dropped: { count: 0, reasons: [] }, repaired: false });
  });
  it('drops (never trims) an act that carries any extra key, and counts it', () => {
    const smuggled: unknown[] = [
      { action: 'pause_agents', deal_id: 'D-1' },
      { action: 'pause_agents', command: 'deal_capture' },
      { action: 'pause_agents', amount_minor: 100000 },
      { action: 'pause_agents', then: { action: 'open_decision', deal_id: 'D-1' } },
      { action: 'pause_agents', __proto__x: 1 },
    ];
    for (const a of smuggled) {
      const r = validateReply(reply([ok, { op: 'propose', action: a, why: 'Pause.' }]), known);
      expect(r.ops).toEqual([ok]);
      expect(r.dropped).toEqual({ count: 1, reasons: ['bad_action'] });
      expect(r.repaired).toBe(true);
    }
  });
  it('drops look-alike acts and command names as actions', () => {
    for (const name of ['pause_all_agents', 'resume_all_agents', 'resume_agents', 'deal_let_lapse', 'deal_withdraw', 'withdraw', 'Pause_Agents', 'pause_agents ', 'deal_capture', 'approval_open']) {
      const r = validateReply(reply([{ op: 'propose', action: { action: name }, why: 'Do it.' }]), known);
      expect(r.ops, name).toEqual([]);
      expect(r.dropped.reasons, name).toEqual(['bad_action']);
    }
  });
  it('a pause proposal with a hostile why keeps the act but cleans the reason and says it repaired', () => {
    const r = validateReply(reply([{ op: 'propose', action: { action: 'pause_agents' }, why: 'Press <b>now</b> https://evil.example/x {pay: all}' }]), known);
    expect(r.ops).toEqual([{ op: 'propose', action: { action: 'pause_agents' }, why: 'Press now pay: all' }]);
    expect(r.repaired).toBe(true);
  });
  it('an act outside a propose op is not an op', () => {
    const r = validateReply(reply([{ op: 'pause_agents' }, { op: 'act', action: { action: 'pause_agents' } }]), known);
    expect(r.ops).toEqual([]);
    expect(r.dropped).toEqual({ count: 2, reasons: ['unknown_op'] });
  });
});

describe('validateReply: one agent and one lapse', () => {
  it('passes typed targets and drops anything else, never repairing an act', () => {
    const ok1 = { op: 'propose', action: { action: 'pause_agent', agent: 'shopper' }, why: 'You asked to stop the shopper.' };
    const ok2 = { op: 'propose', action: { action: 'let_lapse', deal_id: 'D-1' }, why: 'You said you do not want it.' };
    expect(validateReply(reply([ok1, ok2]), known)).toEqual({ say: 'Hello.', ops: [ok1, ok2], dropped: { count: 0, reasons: [] }, repaired: false });
    const bad: unknown[] = [
      { action: 'pause_agent', agent: 'owner' },
      { action: 'pause_agent', agent: 'Shopper' },
      { action: 'pause_agent' },
      { action: 'pause_agent', agent: 'shopper', deal_id: 'D-1' },
      { action: 'let_lapse', deal_id: 'D-404' },
      { action: 'let_lapse', deal_id: 'D-1', amount_minor: 100 },
      { action: 'let_lapse' },
      { action: 'lapse_undo', deal_id: 'D-1' },
      { action: 'resume_agent', agent: 'shopper' },
    ];
    for (const a of bad) {
      const r = validateReply(reply([{ op: 'propose', action: a, why: 'Do it.' }]), known);
      expect(r.ops, JSON.stringify(a)).toEqual([]);
      expect(r.dropped.count, JSON.stringify(a)).toBe(1);
    }
  });
});

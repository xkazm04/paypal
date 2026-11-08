import { describe, expect, it } from 'vitest';
import type { UiOp } from '../contract';
import { knownOf, mayaWeek } from '../fixtures';
import { runArm } from './arm';
import type { EvalCase } from './cases';
import { aggregate, failureWords, formatTable, NONE, scoreCase, type Outcome } from './score';

const known = knownOf(mayaWeek());
const ok = (...ops: unknown[]): Outcome => ({ ok: true, raw: { v: 1, say: 'An answer.', ops } });
const show = (panel: Record<string, unknown>): UiOp => ({ op: 'show', panel } as UiOp);
const propose = (action: Record<string, unknown>, why = 'Because she asked.'): unknown => ({ op: 'propose', action, why });

const kase = (id: string, expect: EvalCase['expect']): EvalCase => ({ id, question: 'q', board: 'maya', expect, note: 'a test case' });

const decisionDan = kase('decision', { panels: [{ kind: 'decision', deal_id: 'D-0193' }] });
const prose = kase('prose', { panels: [], must_not: [{ kind: 'any_act' }] });
const multi = kase('multi', { panels: [{ kind: 'money' }, { kind: 'needs' }] });
const pauseShopper = kase('act', { panels: 'any', propose: [{ action: 'pause_agent', agent: 'shopper' }], must_not: [{ kind: 'action', action: 'pause_agents' }] });
const noLapse = kase('nolapse', { panels: [{ kind: 'needs' }], must_not: [{ kind: 'action', action: 'let_lapse' }, { kind: 'action', action: 'open_decision' }] });
const noDecision = kase('nodecision', { panels: 'any', must_not: [{ kind: 'panel', panel: 'decision' }] });

describe('scoreCase', () => {
  it('passes the exact panel with the right identity', () => {
    const s = scoreCase(decisionDan, ok(show({ kind: 'decision', deal_id: 'D-0193' }), { op: 'focus', module: 'tables', fate: 'needs', deal_id: 'D-0193' }), known);
    expect(s).toMatchObject({ schema_valid: true, exact: true, false_trigger: false, missed_trigger: false, pass: true });
    expect(s.pairs).toEqual([['decision', 'decision']]);
  });

  it('a right kind with the wrong deal is a wrong choice, not a missed trigger', () => {
    const s = scoreCase(decisionDan, ok(show({ kind: 'decision', deal_id: 'D-0188' })), known);
    expect(s).toMatchObject({ exact: false, wrong_identity: ['decision'], missed_panels: [], missed_trigger: false, pass: false });
  });

  it('a wrong kind is a missed trigger and lands in the confusion pairs', () => {
    const s = scoreCase(decisionDan, ok(show({ kind: 'week' })), known);
    expect(s).toMatchObject({ exact: false, missed_panels: ['decision'], extra_panels: ['week'], missed_trigger: true, false_trigger: false });
    expect(s.pairs).toEqual([['decision', 'week']]);
  });

  it('an extra panel beside the right one is not exact', () => {
    const s = scoreCase(decisionDan, ok(show({ kind: 'decision', deal_id: 'D-0193' }), show({ kind: 'money' })), known);
    expect(s).toMatchObject({ exact: false, extra_panels: ['money'], pass: false });
    expect(s.pairs).toEqual([['decision', 'decision'], [NONE, 'money']]);
  });

  it('a panel where the honest answer is a sentence is a false trigger; a sentence alone passes', () => {
    const bad = scoreCase(prose, ok(show({ kind: 'needs', module: null })), known);
    expect(bad).toMatchObject({ panel_when_prose: true, false_trigger: true, missed_trigger: false, pass: false });
    expect(bad.pairs).toEqual([[NONE, 'needs']]);
    const good = scoreCase(prose, ok(), known);
    expect(good).toMatchObject({ exact: true, false_trigger: false, pass: true });
    expect(good.pairs).toEqual([[NONE, NONE]]);
  });

  it('two expected panels match in any order; one of two is a missed trigger', () => {
    expect(scoreCase(multi, ok(show({ kind: 'needs', module: null }), show({ kind: 'money' })), known)).toMatchObject({ exact: true, pass: true });
    const half = scoreCase(multi, ok(show({ kind: 'money' })), known);
    expect(half).toMatchObject({ exact: false, missed_panels: ['needs'], missed_trigger: true });
    expect(half.pairs).toEqual([['money', 'money'], ['needs', NONE]]);
  });

  it('an expected act must appear with its target; the wrong act is unexpected and may hit a must-not', () => {
    expect(scoreCase(pauseShopper, ok(show({ kind: 'safety' }), propose({ action: 'pause_agent', agent: 'shopper' })), known)).toMatchObject({ exact: null, pass: true });
    const wrongAgent = scoreCase(pauseShopper, ok(propose({ action: 'pause_agent', agent: 'negotiator' })), known);
    expect(wrongAgent).toMatchObject({ missed_acts: ['pause_agent:shopper'], unexpected_acts: ['pause_agent:negotiator'], false_trigger: true, missed_trigger: true, pass: false });
    const all = scoreCase(pauseShopper, ok(propose({ action: 'pause_agents' })), known);
    expect(all.must_not_hits).toEqual(['action:pause_agents']);
  });

  it('any act on a case that expects none is a false trigger; a hand-off is not', () => {
    const handoff = scoreCase(kase('h', { panels: [{ kind: 'needs' }] }), ok(show({ kind: 'needs', module: null }), propose({ action: 'open_decision', deal_id: 'D-0193' })), known);
    expect(handoff).toMatchObject({ unexpected_acts: [], false_trigger: false, pass: true });
    const act = scoreCase(prose, ok(propose({ action: 'let_lapse', deal_id: 'D-0193' })), known);
    expect(act).toMatchObject({ unexpected_acts: ['let_lapse:D-0193'], must_not_hits: ['any_act:let_lapse:D-0193'], false_trigger: true });
  });

  it('a must-not names a hand-off or a panel kind', () => {
    const s = scoreCase(noLapse, ok(show({ kind: 'needs', module: null }), propose({ action: 'open_decision', deal_id: 'D-0193' })), known);
    expect(s).toMatchObject({ must_not_hits: ['action:open_decision'], false_trigger: true, exact: true, pass: false });
    const p = scoreCase(noDecision, ok(show({ kind: 'decision', deal_id: 'D-0160' })), known);
    expect(p).toMatchObject({ must_not_hits: ['panel:decision'], false_trigger: true, exact: null });
  });

  it('runs through the real door: a dropped op makes the reply schema-invalid and is not scored', () => {
    const s = scoreCase(decisionDan, ok(show({ kind: 'decision', deal_id: 'D-9999' })), known);
    expect(s).toMatchObject({ schema_valid: false, dropped: 1, dropped_reasons: ['unknown_deal'], shown: [], missed_panels: ['decision'], pass: false });
    expect(failureWords(s)).toBe('dropped 1 (unknown_deal); missed decision');
  });

  it('cleaned text is repaired but still schema-valid', () => {
    const s = scoreCase(prose, { ok: true, raw: { v: 1, say: 'See <b>this</b>', ops: [] } }, known);
    expect(s).toMatchObject({ schema_valid: true, repaired: true, pass: true });
  });

  it('garbage and engine failures are unreadable: not schema-valid, every expectation missed', () => {
    expect(scoreCase(decisionDan, { ok: true, raw: 'not json at all' }, known)).toMatchObject({ schema_valid: false, error: null, missed_trigger: true });
    const e = scoreCase(decisionDan, { ok: false, error: 'timeout' }, known);
    expect(e).toMatchObject({ schema_valid: false, error: 'timeout', missed_panels: ['decision'], pass: false });
    expect(failureWords(e)).toBe('engine timeout; missed decision');
  });
});

describe('aggregate and table', () => {
  const cases = [decisionDan, prose, multi, pauseShopper];
  const outcomes: Outcome[] = [
    ok(show({ kind: 'decision', deal_id: 'D-0193' })), // pass
    ok(show({ kind: 'needs', module: null })), // panel when prose
    { ok: false, error: 'timeout' }, // engine error, missed both
    ok(propose({ action: 'pause_agent', agent: 'shopper' })), // pass, panels not scored
  ];
  const scores = cases.map((c, i) => scoreCase(c, outcomes[i] as Outcome, known));
  const agg = aggregate(cases, scores);

  it('reports each rate over its own denominator', () => {
    expect(agg).toMatchObject({
      n: 4,
      negatives: 1,
      errors: 1,
      schema_valid: { hit: 3, of: 4 },
      exact_choice: { hit: 1, of: 3 },
      false_trigger: { hit: 1, of: 4 },
      false_trigger_by: { panel_when_prose: 1, unexpected_act: 0, must_not: 0 },
      missed_trigger: { hit: 1, of: 3 },
      pass: { hit: 2, of: 4 },
    });
  });

  it('counts the confusion per expected and shown kind', () => {
    expect(agg.confusion).toEqual({ decision: { decision: 1 }, [NONE]: { needs: 1 }, money: { [NONE]: 1 }, needs: { [NONE]: 1 } });
  });

  it('prints the figures, the confusion and the failures', () => {
    const t = formatTable('T', agg, scores);
    expect(t).toContain('schema-valid        3/4   75.0%');
    expect(t).toContain('exact choice        1/3   33.3%');
    expect(t).toContain('missed trigger      1/3   33.3%');
    expect(t).toContain('failed (2):');
    expect(t).toContain('  multi: engine timeout; missed money+needs');
  });

  it('runArm asks every case with its own board, keeps case order under concurrency, and records a throw', async () => {
    const seen: string[] = [];
    const run = await runArm(cases, async (_q, digest, c) => {
      seen.push(`${c.id}:${digest.deals.length}`);
      if (c.id === 'multi') throw new Error('boom');
      await new Promise((r) => setTimeout(r, c.id === 'decision' ? 20 : 0));
      return outcomes[cases.indexOf(c)] as Outcome;
    }, { concurrency: 3 });
    expect(run.scores.map((s) => s.id)).toEqual(cases.map((c) => c.id));
    expect(seen).toHaveLength(4);
    expect(run.outcomes[2]).toEqual({ ok: false, error: 'threw' });
    expect(run.aggregate.pass).toEqual({ hit: 2, of: 4 });
  });
});

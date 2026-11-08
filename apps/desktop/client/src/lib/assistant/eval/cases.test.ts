// The labelled set keeps the shape the evaluation standard asks for. These checks guard the SET, not
// any engine's score: they never look at what an engine answers.
import { describe, expect, it } from 'vitest';
import { PANEL_KINDS } from '../contract';
import { BOARDS, CASES, boardOf, isNegative } from './cases';

const ACTS = ['pause_agents', 'pause_agent', 'let_lapse'] as const;

describe('the board view-choice cases', () => {
  it('has 30 to 40 cases with unique ids, a question the bridge accepts and a reason each', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(30);
    expect(CASES.length).toBeLessThanOrEqual(40);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    for (const c of CASES) {
      expect(c.question.trim().length, c.id).toBeGreaterThan(0);
      expect(c.question.length, c.id).toBeLessThanOrEqual(500);
      expect(c.note.trim().length, c.id).toBeGreaterThan(10);
      expect(Object.keys(BOARDS), c.id).toContain(c.board);
    }
  });

  it('keeps at least a quarter negatives, both kinds of them', () => {
    const negatives = CASES.filter(isNegative);
    expect(negatives.length / CASES.length).toBeGreaterThanOrEqual(0.25);
    expect(negatives.some((c) => c.expect.panels !== 'any' && c.expect.panels.length === 0)).toBe(true);
    expect(negatives.some((c) => c.expect.panels === 'any' || c.expect.panels.length > 0)).toBe(true);
  });

  it('covers every panel kind at least once', () => {
    const kinds = new Set(CASES.flatMap((c) => (c.expect.panels === 'any' ? [] : c.expect.panels.map((p) => p.kind))));
    for (const k of PANEL_KINDS) expect(kinds.has(k), k).toBe(true);
  });

  it('has every act once as a positive and once as a must-not', () => {
    for (const a of ACTS) {
      expect(CASES.some((c) => (c.expect.propose ?? []).some((p) => p.action === a)), `${a} positive`).toBe(true);
      expect(CASES.some((c) => (c.expect.must_not ?? []).some((m) => m.kind === 'action' && m.action === a)), `${a} must-not`).toBe(true);
    }
  });

  it('has comparative questions whose answer is two panels', () => {
    expect(CASES.filter((c) => c.expect.panels !== 'any' && c.expect.panels.length >= 2).length).toBeGreaterThanOrEqual(3);
  });

  it('asks the same words against different boards (the data shape decides the form)', () => {
    const boardsByQuestion = new Map<string, Set<string>>();
    for (const c of CASES) boardsByQuestion.set(c.question, (boardsByQuestion.get(c.question) ?? new Set()).add(c.board));
    expect([...boardsByQuestion.values()].some((b) => b.size >= 2)).toBe(true);
  });

  it('names only deals that are on the board the case is asked against', () => {
    for (const c of CASES) {
      const ids = new Set(boardOf(c).deals.map((d) => d.id));
      const named = [
        ...(c.expect.panels === 'any' ? [] : c.expect.panels.flatMap((p) => (p.deal_id ? [p.deal_id] : []))),
        ...(c.expect.propose ?? []).flatMap((a) => (a.action === 'let_lapse' ? [a.deal_id] : [])),
      ];
      for (const id of named) expect(ids.has(id), `${c.id}: ${id}`).toBe(true);
    }
  });

  it('builds a fresh board per case (a run cannot leak into the next case)', () => {
    const a = BOARDS.maya();
    a.deals.length = 0;
    expect(BOARDS.maya().deals.length).toBeGreaterThan(0);
    expect(BOARDS.quiet().deals.some((d) => d.fate === 'needs')).toBe(false);
  });
});

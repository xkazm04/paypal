// The host's resolution of proposals, as a pure function: hand-offs as before, and the three safe
// acts armed only from the wallet's own facts, with a consent box made of fixed words.
import { describe, expect, it } from 'vitest';
import { AUTHORITY } from '@bindings/authority';
import type { ActionRef } from '../../../lib/assistant';
import { ACTION_CLASS } from '../../../lib/assistant/vocabulary';
import { NO_FACTS, resolveAction, SAFE_ACT_COMMAND, SAFE_ACTS, undoAvailable, type BoardFacts } from './resolve';
import type { BoardKey } from './useBoardModel';

const none: ReadonlyMap<string, BoardKey> = new Map();
const pause: ActionRef = { action: 'pause_agents' };
const facts = (over: Partial<BoardFacts> = {}): BoardFacts => ({ agentsPaused: false, agentsWorking: 0, pausedAgents: [], lapsable: new Set(), ...over });
const running = (n: number | null): BoardFacts => facts({ agentsWorking: n });
const key = (over: Partial<BoardKey> = {}): BoardKey => ({ ...({ id: 'D-1', fate: 'needs', review: true, title: 'Desk from a seller who says pay now', label: 'D-0001', deadline_s: 5000 } as BoardKey), ...over });
const byId = (k: BoardKey) => new Map([[k.id, k]]);

describe('the host table of safe acts', () => {
  it('has exactly the act entries of the vocabulary', () => {
    const acts = Object.entries(ACTION_CLASS).filter(([, c]) => c === 'act').map(([a]) => a).sort();
    expect(Object.keys(SAFE_ACTS).sort()).toEqual(acts);
  });
  it('the one door is act tier, main only, releases nothing, and no undo is proposable', () => {
    const a = AUTHORITY[SAFE_ACT_COMMAND];
    expect(a.tier).toBe('act');
    expect(a.labels).toEqual(['main']);
    expect(a.release).toBe(false);
    expect(a.token).toBe(false);
    expect(a.unlock).toBe(false);
    expect(SAFE_ACTS).toEqual({
      pause_agents: { act: 'pause_all', undo: 'resume_all' },
      pause_agent: { act: 'pause_agent', undo: 'resume_agent' },
      let_lapse: { act: 'let_lapse', undo: 'lapse_undo' },
    });
    for (const { undo } of Object.values(SAFE_ACTS)) expect(Object.keys(ACTION_CLASS)).not.toContain(undo);
    // the direct commands behind the acts are act tier too
    for (const c of ['pause_all_agents', 'resume_all_agents', 'deal_let_lapse', 'deal_lapse_undo', 'agent_pause', 'agent_resume'] as const) expect(AUTHORITY[c].tier, c).toBe('act');
  });
});

describe('resolving pause_agents', () => {
  it('is armed when the wallet says agents are not paused, with a consent box from fixed words and the facts', () => {
    const r = resolveAction(pause, none, running(2));
    if (!r.armed || !r.act) throw new Error('not an armed act');
    expect(r.run.wire).toEqual({ act: 'pause_all' });
    expect(r.run.undoWire).toEqual({ act: 'resume_all' });
    expect(r.label).toBe('Pause all your agents');
    expect(r.confirm).toBe('Needs your OK');
    expect(r.consent.does).toBe('2 agents working now stop, and nothing new starts.');
    expect(r.consent.doesNot).toMatch(/Nothing is paid, approved or cancelled/);
    expect(r.consent.press).toBe('Pause all agents');
    // the words the wallet records are the box, as one plain line
    expect(r.consent.words).toBe(`Needs your OK Pause all your agents ${r.consent.does} ${r.consent.doesNot} ${r.consent.reverse}`);
    expect(r.consent.words).not.toMatch(/[\u0000-\u001f]/);
  });
  it('is disarmed with a reason when agents are already paused, or when that is not known', () => {
    expect(resolveAction(pause, none, facts({ agentsPaused: true }))).toEqual({ armed: false, label: 'Pause all your agents', reason: 'your agents are already paused' });
    expect(resolveAction(pause, none, NO_FACTS)).toEqual({ armed: false, label: 'Pause all your agents', reason: 'whether your agents are paused is not available yet' });
    expect(resolveAction(pause, none).armed).toBe(false);
  });
  it('binds the consent to what was shown: a different working count is a different fingerprint', () => {
    const fp = (f: BoardFacts) => { const r = resolveAction(pause, none, f); return r.armed && r.act ? r.consent.fingerprint : null; };
    expect(fp(running(2))).toBe(fp(running(2)));
    expect(fp(running(2))).not.toBe(fp(running(3)));
  });
});

describe('resolving pause_agent (one agent)', () => {
  const one = (agent: string): ActionRef => ({ action: 'pause_agent', agent } as ActionRef);
  it('names the agent with fixed words and sends only that slot', () => {
    const r = resolveAction(one('shopper'), none, facts({ pausedAgents: ['negotiator'] }));
    if (!r.armed || !r.act) throw new Error('not armed');
    expect(r.label).toBe('Pause your shopper');
    expect(r.consent.does).toMatch(/^It makes agent purchases\. Its work stops now/);
    expect(r.consent.press).toBe('Pause the shopper');
    expect(r.run.wire).toEqual({ act: 'pause_agent', agent: 'shopper' });
    expect(r.run.undoWire).toEqual({ act: 'resume_agent', agent: 'shopper' });
  });
  it('is disarmed when that agent or all agents are already paused, when not known, or for a slot that is not one', () => {
    expect(resolveAction(one('shopper'), none, facts({ pausedAgents: ['shopper'] }))).toMatchObject({ armed: false, reason: 'that agent is already paused' });
    expect(resolveAction(one('shopper'), none, facts({ agentsPaused: true }))).toMatchObject({ armed: false, reason: 'all your agents are already paused' });
    expect(resolveAction(one('shopper'), none, facts({ pausedAgents: null }))).toMatchObject({ armed: false, reason: 'whether your agents are paused is not available yet' });
    expect(resolveAction(one('owner'), none, facts()).armed).toBe(false);
  });
});

describe('resolving let_lapse', () => {
  const lapse = (deal_id: string): ActionRef => ({ action: 'let_lapse', deal_id });
  it('is armed only for a deal on the board whose card offers it, and names the deal by its label only', () => {
    const k = key();
    const r = resolveAction(lapse('D-1'), byId(k), facts({ lapsable: new Set(['D-1']) }));
    if (!r.armed || !r.act) throw new Error('not armed');
    expect(r.label).toBe('Let D-0001 lapse');
    expect(r.consent.words).not.toContain(k.title);
    expect(r.consent.doesNot).toBe('No money moves. Nothing is agreed, and nothing is cancelled early.');
    expect(r.run.wire).toEqual({ act: 'let_lapse', deal_id: 'D-1' });
    expect(r.run.undoWire).toEqual({ act: 'lapse_undo', deal_id: 'D-1' });
  });
  it('is disarmed when the deal is gone, not offered, not waiting, or eligibility is not known', () => {
    expect(resolveAction(lapse('D-404'), byId(key()), facts({ lapsable: new Set(['D-404']) }))).toMatchObject({ armed: false, reason: 'that deal is not on the board' });
    expect(resolveAction(lapse('D-1'), byId(key()), facts())).toMatchObject({ armed: false, reason: 'that deal cannot be left to lapse from here' });
    expect(resolveAction(lapse('D-1'), byId(key({ fate: 'moving' })), facts({ lapsable: new Set(['D-1']) }))).toMatchObject({ armed: false });
    expect(resolveAction(lapse('D-1'), byId(key()), facts({ lapsable: null }))).toMatchObject({ armed: false });
  });
});

describe('the undo, from the wallet facts', () => {
  it('is offered only while there is something to undo', () => {
    const run = (a: ActionRef, f: BoardFacts) => { const r = resolveAction(a, byId(key()), f); if (!r.armed || !r.act) throw new Error('not armed'); return r.run; };
    const all = run(pause, facts());
    expect(undoAvailable(all, facts({ agentsPaused: true }))).toBe(true);
    expect(undoAvailable(all, facts({ agentsPaused: false }))).toBe(false);
    const one = run({ action: 'pause_agent', agent: 'shopper' }, facts());
    expect(undoAvailable(one, facts({ pausedAgents: ['shopper'] }))).toBe(true);
    expect(undoAvailable(one, facts({ pausedAgents: [] }))).toBe(false);
    expect(undoAvailable(run({ action: 'let_lapse', deal_id: 'D-1' }, facts({ lapsable: new Set(['D-1']) })), facts())).toBe(true);
  });
  it('a hand-off is never an act, and an unknown action is disarmed', () => {
    const r = resolveAction({ action: 'open_decision', deal_id: 'D-1' }, byId(key()), facts());
    expect(r.armed && r.act).toBe(false);
    expect(resolveAction({ action: 'deal_capture' } as unknown as ActionRef, none, facts()).armed).toBe(false);
  });
});

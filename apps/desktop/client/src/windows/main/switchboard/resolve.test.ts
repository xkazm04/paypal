// The host's resolution of proposals, as a pure function: hand-offs as before, and the one safe act
// (pause_agents) armed only from the wallet's own facts, with a consent box made of fixed words.
import { describe, expect, it } from 'vitest';
import { AUTHORITY } from '@bindings/authority';
import type { ActionRef } from '../../../lib/assistant';
import { ACTION_CLASS } from '../../../lib/assistant/vocabulary';
import { NO_FACTS, resolveAction, SAFE_ACTS, type BoardFacts } from './resolve';
import type { BoardKey } from './useBoardModel';

const none: ReadonlyMap<string, BoardKey> = new Map();
const pause: ActionRef = { action: 'pause_agents' };
const running = (n: number | null): BoardFacts => ({ agentsPaused: false, agentsWorking: n });

describe('the host table of safe acts', () => {
  it('has exactly the act entries of the vocabulary', () => {
    const acts = Object.entries(ACTION_CLASS).filter(([, c]) => c === 'act').map(([a]) => a).sort();
    expect(Object.keys(SAFE_ACTS).sort()).toEqual(acts);
  });
  it('every command and undo is act tier, callable from the main window, and releases nothing', () => {
    for (const { command, undo } of Object.values(SAFE_ACTS)) {
      for (const name of [command, undo]) {
        const a = AUTHORITY[name];
        expect(a.tier, name).toBe('act');
        expect(a.labels, name).toContain('main');
        expect(a.release, name).toBe(false);
        expect(a.token, name).toBe(false);
        expect(a.unlock, name).toBe(false);
      }
    }
    expect(SAFE_ACTS.pause_agents).toEqual({ command: 'pause_all_agents', undo: 'resume_all_agents' });
  });
});

describe('resolving pause_agents', () => {
  it('is armed when the wallet says agents are not paused, with a consent box from fixed words and the facts', () => {
    const r = resolveAction(pause, none, running(2));
    expect(r.armed).toBe(true);
    if (!r.armed || !r.act) throw new Error('not an armed act');
    expect(r.run).toEqual({ kind: 'act', act: 'pause_agents' });
    expect(r.label).toBe('Pause all your agents');
    expect(r.confirm).toBe('Needs your OK');
    expect(r.consent.does).toBe('2 agents working now stop, and nothing new starts.');
    expect(r.consent.doesNot).toMatch(/Nothing is paid, approved or cancelled/);
    expect(r.consent.reverse).toMatch(/undo this here, or press Resume in Settings/);
    expect(r.consent.press).toBe('Pause all agents');
  });
  it('says what it knows about working agents: one, none or not known', () => {
    const does = (f: BoardFacts) => { const r = resolveAction(pause, none, f); return r.armed && r.act ? r.consent.does : null; };
    expect(does(running(1))).toBe('1 agent working now stops, and nothing new starts.');
    expect(does(running(0))).toMatch(/^No agent is working right now/);
    expect(does(running(null))).toMatch(/^How many agents are working is not available yet/);
  });
  it('is disarmed with a reason when agents are already paused, or when that is not known', () => {
    const paused = resolveAction(pause, none, { agentsPaused: true, agentsWorking: 0 });
    expect(paused).toEqual({ armed: false, label: 'Pause all your agents', reason: 'your agents are already paused' });
    const unknown = resolveAction(pause, none, NO_FACTS);
    expect(unknown).toEqual({ armed: false, label: 'Pause all your agents', reason: 'whether your agents are paused is not available yet' });
    // no facts given at all: disarmed, never armed by default
    expect(resolveAction(pause, none).armed).toBe(false);
  });
  it('binds the consent to what was shown: a different working count is a different fingerprint', () => {
    const fp = (f: BoardFacts) => { const r = resolveAction(pause, none, f); return r.armed && r.act ? r.consent.fingerprint : null; };
    expect(fp(running(2))).toBe(fp(running(2)));
    expect(fp(running(2))).not.toBe(fp(running(3)));
    expect(fp(running(2))).not.toBe(fp(running(null)));
  });
  it('a hand-off is never an act, and an act never carries an approval run', () => {
    const k = { id: 'D-1', fate: 'needs', review: true, title: 'Desk', label: 'D-0001' } as BoardKey;
    const r = resolveAction({ action: 'open_decision', deal_id: 'D-1' }, new Map([['D-1', k]]), running(0));
    expect(r.armed && r.act).toBe(false);
    const a = resolveAction(pause, none, running(0));
    expect(a.armed && a.act && a.run.kind).toBe('act');
  });
  it('an action the host does not know is disarmed', () => {
    expect(resolveAction({ action: 'deal_capture' } as unknown as ActionRef, none, running(0)).armed).toBe(false);
  });
});

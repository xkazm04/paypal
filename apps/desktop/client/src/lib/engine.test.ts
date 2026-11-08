import { describe, expect, it } from 'vitest';
import { agentAppAvailable, agentAppState } from './engine';

const briefs = [
  { id: 'claude-code', available: true },
  { id: 'codex-cli', available: false },
  { id: 'scripted', available: true },
] as const;

describe('agentAppState', () => {
  it('is connected, not-connected or unknown, from the briefs and the choice alone', () => {
    expect(agentAppState(briefs, 'claude-code')).toEqual({ kind: 'connected', engine: 'claude-code' });
    expect(agentAppState(briefs, 'codex-cli')).toEqual({ kind: 'not-connected', engine: 'codex-cli' });
    expect(agentAppState(briefs, 'scripted').kind).toBe('connected');
  });
  it('is unknown, never not-connected, while anything is unread', () => {
    expect(agentAppState(null, 'claude-code').kind).toBe('unknown');
    expect(agentAppState(undefined, 'claude-code').kind).toBe('unknown');
    expect(agentAppState(briefs, null).kind).toBe('unknown');
    expect(agentAppState([], 'claude-code').kind).toBe('unknown');
    expect(agentAppState(briefs, 'outside').kind).toBe('unknown');
  });
  it('maps to the tri-state fact the steps take', () => {
    expect(agentAppAvailable(agentAppState(briefs, 'claude-code'))).toBe(true);
    expect(agentAppAvailable(agentAppState(briefs, 'codex-cli'))).toBe(false);
    expect(agentAppAvailable(agentAppState(null, 'claude-code'))).toBeNull();
  });
});

describe('the mock engine_brief', () => {
  it('is engine_status minus the version and the reason, for every window', async () => {
    const { mockBackend, resetMockState } = await import('../mock/backend');
    resetMockState();
    const full = await mockBackend('main').invoke('engine_status', null);
    for (const label of ['main', 'tumbler', 'approval'] as const) {
      const rows = await mockBackend(label).invoke('engine_brief', null);
      expect(rows).toEqual(full.map((e) => ({ id: e.id, available: e.available })));
      for (const r of rows) expect(Object.keys(r).sort()).toEqual(['available', 'id']);
    }
  });
});

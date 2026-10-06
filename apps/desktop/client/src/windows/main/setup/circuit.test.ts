import { describe, expect, it } from 'vitest';
import type { EngineInfo } from '@bindings/EngineInfo';
import { deriveCircuit, initialPart, mandatesInForce, PART_ORDER, setupProgress, settingsAnswer, stepPart, type CircuitInput, type CircuitSettings, type MandateLite } from './circuit';

const NOW = 1_800_000_000;
const settings = (over: Partial<CircuitSettings> = {}): CircuitSettings => ({
  agents_paused: false, selected_engine: 'claude-code', payment_executor_configured: true, channel3_configured: true, house: 'idle', first_run: false, ...over,
});
const ENGINES: EngineInfo[] = [
  { id: 'claude-code', available: true, version: '2.1', reason: null },
  { id: 'codex-cli', available: false, version: null, reason: 'not found' },
  { id: 'scripted', available: true, version: null, reason: null },
];
const M1: MandateLite = { id: '01JDMANDATE000000000000001', version: 3, notBefore: NOW - 86400, expires: NOW + 86400 };
const input = (over: Partial<CircuitInput> = {}): CircuitInput => ({ settings: settings(), engines: ENGINES, mandates: [M1], running: 2, locked: false, now: NOW, ...over });

describe('the Circuit · breaks for a settings snapshot', () => {
  it('a fully set-up wallet has no breaks, but PayPal is unknown (dashed), never green', () => {
    const c = deriveCircuit(input());
    expect(c.breaks).toEqual([]);
    expect(c.waits).toEqual([]);
    expect(c.parts.paypal.state).toBe('unknown');
    expect(c.parts.paypal.chip.tone).toBe('dashed');
    expect(c.wires).toMatchObject({ w1: 'live', w2: 'live', w3: 'live', w4: 'live' });
    expect(c.headline.title).toBe('Ready');
    expect(c.unknowns.map((u) => u.part)).toEqual(['paypal']);
  });

  it('first run: no usable engine, no credentials, no mandate → three breaks in path order', () => {
    const c = deriveCircuit(input({
      settings: settings({ first_run: true, selected_engine: 'codex-cli', payment_executor_configured: false }),
      mandates: [],
    }));
    expect(c.breaks.map((b) => b.key)).toEqual(['engine', 'credentials', 'mandate']);
    expect(c.breaks.map((b) => b.who)).toEqual(['you', 'only-you', 'only-you']);
    expect(c.headline.title).toBe('3 things to fix');
    expect(c.wires).toMatchObject({ w2: 'cut', w3: 'cut', w4: 'cut' });
    expect(c.parts.paypal).toMatchObject({ state: 'off', value: 'never called' });
    expect(initialPart(c, true)).toBe('engine');
  });

  it('the selected engine reported unavailable is a break, and offers the scripted engine when it is usable', () => {
    const engines: EngineInfo[] = ENGINES.map((e) => (e.id === 'claude-code' ? { ...e, available: false, reason: 'pending isolation conformance' } : e));
    const c = deriveCircuit(input({ engines }));
    expect(c.parts.engine).toMatchObject({ state: 'break', value: 'claude-code', chip: { tone: 'red', text: 'not connected' } });
    expect(c.breaks).toHaveLength(1);
    expect(c.breaks[0]).toMatchObject({ key: 'engine', scriptedFix: true });
    // downstream parts are fine but unpowered
    expect(c.powered.mandate).toBe(false);
    expect(c.wires.w3).toBe('idle');
  });

  it('no scripted fix when the scripted engine is the selected one', () => {
    const engines: EngineInfo[] = ENGINES.map((e) => (e.id === 'scripted' ? { ...e, available: false } : e));
    const c = deriveCircuit(input({ settings: settings({ selected_engine: 'scripted' }), engines }));
    expect(c.breaks[0]).toMatchObject({ key: 'engine', scriptedFix: false });
  });

  it('engine_status not answered: the engine is unknown (dashed wire), not a break', () => {
    const c = deriveCircuit(input({ engines: null }));
    expect(c.parts.engine.state).toBe('unknown');
    expect(c.breaks).toEqual([]);
    expect(c.wires.w2).toBe('unknown');
    expect(c.parts.paypal.value).toBe('not checked yet');
    expect(c.headline.title).toBe('Some parts haven’t answered');
    expect(c.unknowns.map((u) => u.part)).toContain('engine');
  });

  it('settings not read: nothing is claimed', () => {
    const c = deriveCircuit(input({ settings: null }));
    expect(c.breaks).toEqual([]);
    expect(c.parts.keychain.state).toBe('unknown');
    expect(c.parts.agents.state).toBe('unknown');
    expect(c.wires.w1).toBe('unknown');
    expect(c.headline.title).toBe('Checking…');
  });

  it('a signed mandate that has expired is not in force: a break that says so', () => {
    const old = { ...M1, expires: NOW - 1 };
    const c = deriveCircuit(input({ mandates: [old] }));
    expect(c.parts.mandate).toMatchObject({ state: 'break', value: 'none active' });
    expect(c.breaks.map((b) => b.title)).toEqual(['No active rules']);
    expect(mandatesInForce([old, M1], NOW)).toEqual([M1]);
  });

  it('a mandate whose window has not started is not in force either', () => {
    expect(mandatesInForce([{ ...M1, notBefore: NOW + 10 }], NOW)).toEqual([]);
  });

  it('paused: the breaker is open, a wait row (not a break), and PayPal is idle', () => {
    const c = deriveCircuit(input({ settings: settings({ agents_paused: true }) }));
    expect(c.breaks).toEqual([]);
    expect(c.waits.map((x) => x.key)).toEqual(['paused']);
    expect(c.wires.w1).toBe('open');
    expect(c.parts.agents.chip.text).toBe('paused');
    expect(c.parts.paypal.state).toBe('off');
    expect(c.headline.title).toBe('Agents paused');
  });

  it('idle lock and a waking house are waits; the house wire is live only when ready', () => {
    const c = deriveCircuit(input({ locked: true, settings: settings({ house: 'waking' }) }));
    expect(c.waits.map((x) => x.key)).toEqual(['house', 'locked']);
    expect(c.parts.lock.state).toBe('wait');
    expect(c.wires.house).toBe('idle');
    expect(deriveCircuit(input({ settings: settings({ house: 'ready' }) })).wires.house).toBe('live');
    expect(deriveCircuit(input({ settings: settings({ house: 'unavailable' }) })).parts.house.chip).toEqual({ tone: 'dashed', text: 'unavailable' });
  });

  it('agents read the running count, or say "may run" when runs are not read', () => {
    expect(deriveCircuit(input()).parts.agents.value).toBe('2 working');
    expect(deriveCircuit(input({ running: null })).parts.agents.value).toBe('ready');
  });

  it('a break never comes with a green PayPal part', () => {
    for (const s of [settings({ payment_executor_configured: false }), settings({ selected_engine: 'codex-cli' })]) {
      const c = deriveCircuit(input({ settings: s }));
      expect(c.parts.paypal.state).not.toBe('ok');
      expect(c.parts.paypal.chip.tone).not.toBe('ok');
    }
  });

  it('initial selection: the first break, else PayPal (returning) or agents (first run)', () => {
    expect(initialPart(deriveCircuit(input({ settings: settings({ payment_executor_configured: false }) })), false)).toBe('keychain');
    expect(initialPart(deriveCircuit(input()), false)).toBe('paypal');
    expect(initialPart(deriveCircuit(input()), true)).toBe('agents');
  });

  it('←/→ walk the parts in picture order and wrap', () => {
    expect(stepPart('agents', 1)).toBe('engine');
    expect(stepPart('engine', 1)).toBe('lock');
    expect(stepPart('agents', -1)).toBe('house');
    expect(stepPart('house', 1)).toBe('agents');
    let p = PART_ORDER[0] ?? 'agents';
    for (let i = 0; i < PART_ORDER.length; i++) p = stepPart(p, 1);
    expect(p).toBe('agents');
  });
});

describe('the settings answer and the setup checklist progress', () => {
  const ans = (c: ReturnType<typeof deriveCircuit>, over: Partial<{ firstRun: boolean; settingsKnown: boolean; locked: boolean }> = {}) =>
    settingsAnswer(c, { firstRun: false, settingsKnown: true, locked: false, ...over });

  it('ready: done, never claims PayPal was tested', () => {
    const c = deriveCircuit(input());
    expect(ans(c)).toMatchObject({ tone: 'done', title: 'Your wallet is ready' });
    expect(ans(c).sub).not.toMatch(/paypal/i);
    expect(setupProgress(c)).toEqual({ done: 3, total: 3 });
  });

  it('missing steps are gold, counted, and say no money moves until fixed', () => {
    const c = deriveCircuit(input({ settings: settings({ first_run: true, selected_engine: 'codex-cli', payment_executor_configured: false }), mandates: [] }));
    expect(ans(c, { firstRun: true })).toMatchObject({ tone: 'need', title: 'Let’s get your wallet ready' });
    expect(ans(c).sub).toMatch(/^3 steps are left/);
    expect(ans(c).sub).toMatch(/no money moves/);
    expect(setupProgress(c)).toEqual({ done: 0, total: 3 });
    const one = deriveCircuit(input({ settings: settings({ payment_executor_configured: false }) }));
    expect(ans(one).sub).toMatch(/^1 step is left/);
    expect(setupProgress(one)).toEqual({ done: 2, total: 3 });
  });

  it('paused, still checking, locked and not-read are each said plainly and never green', () => {
    expect(ans(deriveCircuit(input({ settings: settings({ agents_paused: true }) })))).toMatchObject({ tone: 'need', title: 'Your agents are paused' });
    expect(ans(deriveCircuit(input({ engines: null })))).toMatchObject({ tone: 'calm', title: 'Still checking a few things' });
    expect(ans(deriveCircuit(input({ locked: true })), { locked: true }).tone).toBe('calm');
    const none = deriveCircuit(input({ settings: null }));
    expect(ans(none, { settingsKnown: false })).toMatchObject({ tone: 'calm', title: 'Checking your wallet…' });
    expect(none.parts.keychain.state).toBe('unknown');
    expect(setupProgress(none).done).toBeLessThan(3);
  });
});

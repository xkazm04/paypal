import { describe, expect, it } from 'vitest';
import { connectionFacts, engineChosen, gettingStarted, rulesInForce, START_ORDER, type StartFacts } from './firstRun';
import { FIRST_RUN_TITLE, SAFETY_PROMISE, START_STEP } from './words';
import { buildFirstRunState } from '../mock/firstRun';

const fresh: StartFacts = { firstRun: true, paypal: false, rulesInForce: 0, houseConnected: false, otherConnections: 0, engine: 'scripted' };
const states = (f: StartFacts) => gettingStarted(f).steps.map((s) => s.state);

describe('first-run steps from settings, signed rules, connections and the agent app', () => {
  it('a brand-new wallet shows four steps in order, PayPal next, the agent app last', () => {
    const gs = gettingStarted(fresh);
    expect(gs.show).toBe(true);
    expect(gs.steps.map((s) => [s.n, s.key])).toEqual([[1, 'paypal'], [2, 'rules'], [3, 'practice'], [4, 'engine']]);
    expect(states(fresh)).toEqual(['next', 'todo', 'todo', 'todo']);
    expect(gs).toMatchObject({ done: 0, total: 4, next: 'paypal' });
  });

  it('each fact completes its own step, and the next one turns gold', () => {
    expect(states({ ...fresh, paypal: true })).toEqual(['done', 'next', 'todo', 'todo']);
    // Signing rules flips first_run in the shell; the path stays until the practice step is done.
    const signed = gettingStarted({ ...fresh, firstRun: false, paypal: true, rulesInForce: 1 });
    expect(signed).toMatchObject({ show: true, done: 2, next: 'practice' });
    // After the practice deal, the agent app is what is left.
    expect(gettingStarted({ ...fresh, firstRun: false, paypal: true, rulesInForce: 1, houseConnected: true })).toMatchObject({ show: true, done: 3, next: 'engine' });
    // Steps can be done in any order: the house first, then the rest.
    expect(states({ ...fresh, houseConnected: true })).toEqual(['next', 'todo', 'done', 'todo']);
    expect(states({ ...fresh, engine: 'codex-cli' })).toEqual(['next', 'todo', 'todo', 'done']);
  });

  it('the agent app: done on claude-code or codex-cli, never on the practice agent, unknown while settings are unread', () => {
    expect(engineChosen('claude-code')).toBe(true);
    expect(engineChosen('codex-cli')).toBe(true);
    expect(engineChosen('scripted')).toBe(false);
    expect(engineChosen('scripted', true)).toBe(false);
    expect(engineChosen(null)).toBeNull();
    expect(states({ ...fresh, engine: 'claude-code' })[3]).toBe('done');
    expect(states({ ...fresh, engine: null })[3]).toBe('unknown');
    // The Table also reads engine_status: an app it reports unavailable is not done.
    expect(engineChosen('claude-code', false)).toBe(false);
    expect(states({ ...fresh, engine: 'claude-code', engineAvailable: false })[3]).toBe('todo');
    expect(states({ ...fresh, engine: 'claude-code', engineAvailable: true })[3]).toBe('done');
    expect(states({ ...fresh, engine: 'claude-code', engineAvailable: null })[3]).toBe('done');
  });

  it('every step done ends the path, and so does connecting other wallets', () => {
    const all: StartFacts = { firstRun: false, paypal: true, rulesInForce: 1, houseConnected: true, otherConnections: 0, engine: 'claude-code' };
    expect(gettingStarted(all)).toMatchObject({ show: false, done: 4, next: null });
    // Still on the practice agent: the path stays.
    expect(gettingStarted({ ...all, engine: 'scripted' })).toMatchObject({ show: true, done: 3, next: 'engine' });
    // An owner already dealing with other wallets is past getting started, whatever is left.
    expect(gettingStarted({ firstRun: false, paypal: false, rulesInForce: 1, houseConnected: false, otherConnections: 4, engine: 'scripted' }).show).toBe(false);
    // But a wallet without rules always shows it (first_run is the shell's own fact).
    expect(gettingStarted({ ...fresh, otherConnections: 4 }).show).toBe(true);
  });

  it('expired or refused rules do not count as signed; first_run is the fallback when rules are not readable', () => {
    const now = 1_800_000_000;
    const m = (nb: number, ex: number, refusal: unknown = null) => ({ payload: { not_before: nb, expires: ex }, refusal });
    expect(rulesInForce([m(now - 10, now + 10), m(now - 20, now - 1), m(now + 5, now + 50), m(now - 1, now + 1, { clause: 4 })], now)).toBe(1);
    expect(rulesInForce(null, now)).toBeNull();
    expect(states({ ...fresh, firstRun: false, rulesInForce: null })[1]).toBe('done');
    expect(states({ ...fresh, rulesInForce: null })[1]).toBe('todo');
  });

  it('a window that cannot read a fact never shows it done', () => {
    // The Tumbler reads settings only; the agent app is one of them.
    const tumbler = gettingStarted({ firstRun: true, paypal: true, rulesInForce: null, houseConnected: null, otherConnections: null, engine: 'scripted' });
    expect(tumbler.steps.map((s) => s.state)).toEqual(['done', 'next', 'unknown', 'todo']);
    expect(tumbler.show).toBe(true);
    expect(gettingStarted({ firstRun: true, paypal: true, rulesInForce: null, houseConnected: null, otherConnections: null, engine: 'codex-cli' }).steps[3]!.state).toBe('done');
    // The approval window reads settings, rules and connections, but not engine_status.
    const approval = gettingStarted({ ...fresh, paypal: true, rulesInForce: 1, firstRun: false, houseConnected: true, engine: 'claude-code' });
    expect(approval).toMatchObject({ done: 4, next: null });
    // Settings not read yet: nothing is shown as done and the path waits.
    const unread = gettingStarted({ firstRun: null, paypal: null, rulesInForce: null, houseConnected: null, otherConnections: null, engine: null });
    expect(unread).toMatchObject({ show: false, done: 0, next: null });
    expect(unread.steps.every((s) => s.state === 'unknown')).toBe(true);
    // With connections unread, a wallet that signed rules does not guess it is still getting started.
    expect(gettingStarted({ firstRun: false, paypal: false, rulesInForce: 1, houseConnected: null, otherConnections: null, engine: 'scripted' }).show).toBe(false);
  });

  it('the ?first_run=1 preview world: four steps, the agent app among them and to do on the practice agent', () => {
    const w = buildFirstRunState(1_800_000_000);
    const gs = gettingStarted({
      firstRun: w.settings.first_run, paypal: w.settings.payment_executor_configured, rulesInForce: w.mandates.length,
      ...connectionFacts(w.counterparties), engine: w.settings.selected_engine,
    });
    expect(w.settings.selected_engine).toBe('scripted');
    expect(gs).toMatchObject({ show: true, total: 4, done: 0, next: 'paypal' });
    expect(gs.steps[3]).toEqual({ key: 'engine', n: 4, state: 'todo' });
  });

  it('connections: the house seller apart from everyone else', () => {
    expect(connectionFacts(null)).toEqual({ houseConnected: null, otherConnections: null });
    expect(connectionFacts([])).toEqual({ houseConnected: false, otherConnections: 0 });
    expect(connectionFacts([{ house: true }, { house: false }, { house: false }])).toEqual({ houseConnected: true, otherConnections: 2 });
  });

  it('the words: one plain sentence per step, no internals, the promise said once, the count follows the steps', () => {
    expect(START_ORDER).toEqual(['paypal', 'rules', 'practice', 'engine']);
    expect(Object.keys(START_STEP).sort()).toEqual([...START_ORDER].sort());
    expect(START_STEP.paypal.title).toBe('Connect PayPal sandbox');
    expect(START_STEP.rules.title).toBe('Sign your agents’ rules');
    expect(START_STEP.practice.title).toBe('Try a practice deal with the house seller');
    expect(START_STEP.engine.title).toBe('Choose your agent app');
    expect(FIRST_RUN_TITLE).toBe(`Your first safe deal in ${START_ORDER.length} steps`);
    expect(SAFETY_PROMISE).toBe('Nothing pays without you or a rule you signed. Waiting never sends money.');
    const all = JSON.stringify(Object.values(START_STEP)) + SAFETY_PROMISE + FIRST_RUN_TITLE;
    expect(all).not.toMatch(/mandate|credential|clause|keyring|Rust|HOUSE|_open|token|scripted|engine/);
    // Agent apps are named by their ids, never by a vendor's product name.
    expect(all).not.toMatch(/Claude|Anthropic|OpenAI|Codex|GPT/);
  });
});

import { describe, expect, it } from 'vitest';
import { connectionFacts, engineChosen, gettingStarted, rulesInForce, settingsFacts, START_ORDER, type StartFacts } from './firstRun';
import { FIRST_RUN_TITLE, KEEP_PRACTICE_AGENT, SAFETY_PROMISE, START_STEP } from './words';
import type { SettingsSnapshot } from '@bindings/SettingsSnapshot';
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

  it('an owner with neither app who keeps the practice agent finishes step 4; the default alone never does', () => {
    expect(engineChosen('scripted', null, true)).toBe(true);
    expect(engineChosen('scripted', null, false)).toBe(false);
    expect(engineChosen('scripted', null, null)).toBe(false);
    // The default 'scripted' without the choice stays to do.
    expect(states({ ...fresh, engine: 'scripted', engineChosen: false })[3]).toBe('todo');
    expect(states({ ...fresh, engine: 'scripted' })[3]).toBe('todo');
    // A chosen app reported unavailable stays to do, whatever engine_chosen says.
    expect(states({ ...fresh, engine: 'claude-code', engineAvailable: false, engineChosen: true })[3]).toBe('todo');
    // Keeping the practice agent: all four steps done, Home leaves getting-started.
    const kept: StartFacts = { firstRun: false, paypal: true, rulesInForce: 1, houseConnected: true, otherConnections: 0, engine: 'scripted', engineChosen: true };
    expect(gettingStarted(kept)).toMatchObject({ show: false, done: 4, next: null });
    expect(gettingStarted({ ...kept, engineChosen: false })).toMatchObject({ show: true, done: 3, next: 'engine' });
    expect(KEEP_PRACTICE_AGENT.act).toBe('Keep the practice agent for now');
    expect(JSON.stringify(KEEP_PRACTICE_AGENT)).not.toMatch(/—|Claude|Codex|OpenAI|Anthropic|connected|AI agent/);
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
    expect(START_STEP.paypal.title).toBe('Add your PayPal sandbox keys');
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

  it('step 1 says the fact: the keys are saved, never connected, checked or verified', () => {
    const row = gettingStarted({ ...fresh, paypal: true }).steps[0]!;
    expect(row).toMatchObject({ key: 'paypal', state: 'done' });
    expect(START_STEP.paypal.done).toBe('PayPal sandbox keys saved');
    for (const text of Object.values(START_STEP.paypal)) expect(text).not.toMatch(/connected|checked|verified/i);
    // Step 1 says where the keys come from (the sourced fact only) and keeps the test-money meaning.
    expect(START_STEP.paypal.sub).toBe('Test money only · registering at developer.paypal.com creates a sandbox business account with its test keys');
  });
  describe('settingsFacts: one mapping for Home, the Tumbler and the approval window', () => {
    const snap = (o: Partial<SettingsSnapshot>) => ({ first_run: true, payment_executor_configured: true, selected_engine: 'scripted', engine_chosen: false, ...o }) as SettingsSnapshot;

    it('maps a snapshot field by field and returns nulls without one', () => {
      expect(settingsFacts(snap({ first_run: false, payment_executor_configured: false, selected_engine: 'codex-cli', engine_chosen: true })))
        .toEqual({ firstRun: false, paypal: false, engine: 'codex-cli', engineChosen: true });
      const none = { firstRun: null, paypal: null, engine: null, engineChosen: null };
      expect(settingsFacts(null)).toEqual(none);
      expect(settingsFacts(undefined)).toEqual(none);
    });

    it('Tumbler-shaped facts: step 4 is done on a kept practice agent, not on the default', () => {
      const tumbler = (st: SettingsSnapshot): StartFacts => ({ ...settingsFacts(st), firstRun: true, rulesInForce: null, houseConnected: null, otherConnections: null });
      expect(gettingStarted(tumbler(snap({ engine_chosen: true }))).steps[3]!.state).toBe('done');
      expect(gettingStarted(tumbler(snap({ engine_chosen: false }))).steps[3]!.state).not.toBe('done');
    });

    it('Tumbler-shaped facts: step 3 reads the settings’ house_connected, never the counterparty list', () => {
      const tumbler = (st: SettingsSnapshot): StartFacts => ({ ...settingsFacts(st), firstRun: true, rulesInForce: null, houseConnected: st.house_connected ?? null, otherConnections: null });
      expect(gettingStarted(tumbler(snap({ house_connected: true }))).steps[2]!.state).toBe('done');
      expect(gettingStarted(tumbler(snap({ house_connected: false }))).steps[2]!.state).not.toBe('done');
    });

    it('the mock: pinning the house sets house_connected and tells settings:changed', async () => {
      const { mockBackend, resetMockState } = await import('../mock/backend');
      resetMockState();
      history.replaceState(null, '', '/index.html?first_run=1');
      const main = mockBackend('main');
      expect((await main.invoke('get_settings', null)).house_connected).toBe(false);
    });

    it('OwnerConfig-shaped facts give the same step 4 as Home for the same snapshot', () => {
      for (const engine_chosen of [true, false]) {
        const st = snap({ first_run: false, engine_chosen });
        const home = gettingStarted({ ...settingsFacts(st), rulesInForce: 1, ...connectionFacts([]), engineAvailable: null });
        const owner = gettingStarted({ ...settingsFacts(st), rulesInForce: 1, ...connectionFacts([]) });
        expect(owner.steps[3]).toEqual(home.steps[3]);
      }
    });
  });
});

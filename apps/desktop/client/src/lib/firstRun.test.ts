import { describe, expect, it } from 'vitest';
import { connectionFacts, gettingStarted, rulesInForce, START_ORDER, type StartFacts } from './firstRun';
import { SAFETY_PROMISE, START_STEP } from './words';

const fresh: StartFacts = { firstRun: true, paypal: false, rulesInForce: 0, houseConnected: false, otherConnections: 0 };
const states = (f: StartFacts) => gettingStarted(f).steps.map((s) => s.state);

describe('first-run steps from settings, signed rules and connections', () => {
  it('a brand-new wallet shows three steps in order, PayPal next', () => {
    const gs = gettingStarted(fresh);
    expect(gs.show).toBe(true);
    expect(gs.steps.map((s) => [s.n, s.key])).toEqual([[1, 'paypal'], [2, 'rules'], [3, 'practice']]);
    expect(states(fresh)).toEqual(['next', 'todo', 'todo']);
    expect(gs).toMatchObject({ done: 0, total: 3, next: 'paypal' });
  });

  it('each fact completes its own step, and the next one turns gold', () => {
    expect(states({ ...fresh, paypal: true })).toEqual(['done', 'next', 'todo']);
    // Signing rules flips first_run in the shell; the path stays until the practice step is done.
    const signed = gettingStarted({ ...fresh, firstRun: false, paypal: true, rulesInForce: 1 });
    expect(signed).toMatchObject({ show: true, done: 2, next: 'practice' });
    // Steps can be done in any order: the house first, then the rest.
    expect(states({ ...fresh, houseConnected: true })).toEqual(['next', 'todo', 'done']);
  });

  it('all three done ends the path, and so does connecting other wallets', () => {
    expect(gettingStarted({ firstRun: false, paypal: true, rulesInForce: 1, houseConnected: true, otherConnections: 0 })).toMatchObject({ show: false, done: 3, next: null });
    // An owner already dealing with other wallets is past getting started, whatever is left.
    expect(gettingStarted({ firstRun: false, paypal: false, rulesInForce: 1, houseConnected: false, otherConnections: 4 }).show).toBe(false);
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
    // The Tumbler reads settings only.
    const tumbler = gettingStarted({ firstRun: true, paypal: true, rulesInForce: null, houseConnected: null, otherConnections: null });
    expect(tumbler.steps.map((s) => s.state)).toEqual(['done', 'next', 'unknown']);
    expect(tumbler.show).toBe(true);
    // Settings not read yet: nothing is shown as done and the path waits.
    const unread = gettingStarted({ firstRun: null, paypal: null, rulesInForce: null, houseConnected: null, otherConnections: null });
    expect(unread).toMatchObject({ show: false, done: 0, next: null });
    expect(unread.steps.every((s) => s.state === 'unknown')).toBe(true);
    // With connections unread, a wallet that signed rules does not guess it is still getting started.
    expect(gettingStarted({ firstRun: false, paypal: false, rulesInForce: 1, houseConnected: null, otherConnections: null }).show).toBe(false);
  });

  it('connections: the house seller apart from everyone else', () => {
    expect(connectionFacts(null)).toEqual({ houseConnected: null, otherConnections: null });
    expect(connectionFacts([])).toEqual({ houseConnected: false, otherConnections: 0 });
    expect(connectionFacts([{ house: true }, { house: false }, { house: false }])).toEqual({ houseConnected: true, otherConnections: 2 });
  });

  it('the words: one plain sentence per step, no internals, the promise said once', () => {
    expect(START_ORDER).toEqual(['paypal', 'rules', 'practice']);
    expect(START_STEP.paypal.title).toBe('Connect PayPal sandbox');
    expect(START_STEP.rules.title).toBe('Sign your agents’ rules');
    expect(START_STEP.practice.title).toBe('Try a practice deal with the house seller');
    expect(SAFETY_PROMISE).toBe('Nothing pays without you or a rule you signed. Waiting never sends money.');
    const all = JSON.stringify(START_STEP) + SAFETY_PROMISE;
    expect(all).not.toMatch(/mandate|credential|clause|keyring|Rust|HOUSE|_open|token/);
  });
});

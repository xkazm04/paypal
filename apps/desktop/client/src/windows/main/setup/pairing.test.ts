import { describe, expect, it } from 'vitest';
import {
  allTicked, canSubmit, joinCode, mirrorStage, mirrorText, modeLocked, newTicks, houseWords, pairAnswer, pairPhase, payeeProblem, tickLabel, tickProgress, ticksDone, toggleTick, wizardSteps,
} from './pairing';

describe('pairing · Main side', () => {
  it('phase follows what Main holds: nothing, our code, or the words', () => {
    expect(pairPhase(false, false)).toBe('idle');
    expect(pairPhase(true, false)).toBe('code');
    expect(pairPhase(true, true)).toBe('words');
    expect(pairPhase(false, true)).toBe('words');
  });

  it('other modes are locked while a code or words are out', () => {
    expect(modeLocked('idle', 'create', 'join')).toBe(false);
    expect(modeLocked('code', 'create', 'join')).toBe(true);
    expect(modeLocked('words', 'house', 'house')).toBe(false);
  });

  it('codes are trimmed, never rewritten', () => {
    expect(joinCode('  TBL-7q4M-K2 ')).toBe('TBL-7q4M-K2');
    expect(joinCode('   ')).toBeNull();
  });

  it('submit needs a payee; join a code; HOUSE an available, non-waking house', () => {
    expect(canSubmit('create', { payee: '', code: '' }, 'idle')).toBe(false);
    expect(canSubmit('create', { payee: 'maya-shop', code: '' }, 'unavailable')).toBe(true);
    expect(canSubmit('join', { payee: 'maya-shop', code: ' ' }, 'idle')).toBe(false);
    expect(canSubmit('join', { payee: 'maya-shop', code: 'TBL-1' }, 'idle')).toBe(true);
    expect(canSubmit('house', { payee: 'maya-shop', code: '' }, 'unavailable')).toBe(false);
    expect(canSubmit('house', { payee: 'maya-shop', code: '' }, 'waking')).toBe(false);
    expect(canSubmit('house', { payee: 'maya-shop', code: '' }, 'idle')).toBe(true);
  });

  it('the payee follows Rust’s PayeeRef (table-core ids.rs text_id!): 1-128 letters, digits or - _ . : @ +', () => {
    for (const ok of ['maya-shop', 'maya@example.com', 'shop_7.north:desk+1', 'x'.repeat(128), '  maya@example.com  ']) {
      expect(payeeProblem(ok), ok).toBeNull();
      expect(canSubmit('create', { payee: ok, code: '' }, 'idle'), ok).toBe(true);
    }
    // Rust refuses these when it reads the arguments; the desk must not send them.
    for (const bad of ['Maya’s Bakery', 'maya shop', 'x'.repeat(129), 'café', 'maya/shop', 'a\tb']) {
      expect(payeeProblem(bad), bad).not.toBeNull();
      for (const m of ['create', 'join', 'house'] as const) expect(canSubmit(m, { payee: bad, code: 'TBL-1' }, 'idle'), `${m} ${bad}`).toBe(false);
    }
    expect(payeeProblem('   ')).toBeNull();
  });
});

describe('the connect wizard', () => {
  const states = (ph: Parameters<typeof wizardSteps>[0], matched = false, pinned = false) => wizardSteps(ph, matched, pinned).map((x) => x.state);

  it('exactly one panel is active at a time, in order: code, words, confirm', () => {
    expect(wizardSteps('idle', false, false).map((x) => x.key)).toEqual(['code', 'words', 'confirm']);
    expect(states('idle')).toEqual(['on', 'todo', 'todo']);
    expect(states('code')).toEqual(['on', 'todo', 'todo']);
    expect(states('words')).toEqual(['done', 'on', 'todo']);
    expect(states('words', true)).toEqual(['done', 'done', 'on']);
    for (const ph of ['idle', 'code', 'words'] as const) for (const m of [false, true]) {
      expect(states(ph, m).filter((x) => x === 'on')).toHaveLength(1);
    }
  });

  it('confirm is done only after Rust says the words were pinned, whatever was clicked here', () => {
    expect(states('words', false, true)).toEqual(['done', 'done', 'done']);
    expect(states('words', true, false)[2]).not.toBe('done');
  });

  it('the answer says where the connection stands and never claims connected before pairing:pinned', () => {
    expect(pairAnswer('create', 'idle', false, false).title).toBe('Connect with another wallet');
    expect(pairAnswer('join', 'idle', false, false).title).toBe('Type the code they gave you');
    expect(pairAnswer('house', 'idle', false, false).title).toBe('Connect with the house seller');
    expect(pairAnswer('create', 'code', false, false).title).toBe('Waiting for them to type your code');
    expect(pairAnswer('create', 'words', false, false).tone).toBe('need');
    expect(pairAnswer('create', 'words', true, false).title).toBe('Confirm in the approval window');
    expect(pairAnswer('create', 'words', true, false).tone).not.toBe('done');
    expect(pairAnswer('create', 'words', true, true)).toMatchObject({ tone: 'done', title: 'You’re connected' });
  });
});

describe('r2-connect: the word ticks and the mirror', () => {
  it('starts with nothing ticked, and "All four match" needs every word', () => {
    const t0 = newTicks(4);
    expect(t0).toEqual([false, false, false, false]);
    expect(allTicked(t0)).toBe(false);
    let t = t0;
    for (const i of [0, 1, 2]) t = toggleTick(t, i);
    expect(ticksDone(t)).toBe(3);
    expect(allTicked(t)).toBe(false);
    t = toggleTick(t, 3);
    expect(allTicked(t)).toBe(true);
  });

  it('a tick can be taken back, and a stray index changes nothing', () => {
    const t = toggleTick(newTicks(4), 2);
    expect(toggleTick(t, 2)).toEqual(newTicks(4));
    expect(toggleTick(t, 9)).toBe(t);
    expect(toggleTick(t, -1)).toBe(t);
    expect(toggleTick(t, 1.5)).toBe(t);
  });

  it('never matches with no words to tick', () => {
    expect(allTicked(newTicks(0))).toBe(false);
    expect(tickProgress(newTicks(0))).toBe('');
  });

  it('says how far along the owner is', () => {
    expect(tickProgress(newTicks(4))).toBe('Tick each word you see on their screen');
    expect(tickProgress(toggleTick(toggleTick(newTicks(4), 0), 3))).toBe('2 of 4 seen');
    expect(tickProgress([true, true, true, true])).toBe('All 4 seen');
  });

  it('the house has no screen, so its ticks point at the approval window', () => {
    expect(tickLabel('create')).toBe('I see this too');
    expect(tickLabel('join')).toBe('I see this too');
    expect(tickLabel('house')).toBe('Same in approval window');
  });

  it('the mirror follows the wizard and never claims they are connected', () => {
    expect(mirrorStage('create', 'idle', false, false)).toBe('start');
    expect(mirrorStage('create', 'code', false, false)).toBe('code');
    expect(mirrorStage('join', 'idle', false, false)).toBe('start');
    expect(mirrorStage('create', 'words', false, false)).toBe('words');
    expect(mirrorStage('create', 'words', true, false)).toBe('confirm');
    expect(mirrorStage('create', 'words', true, true)).toBe('done');
    expect(mirrorText('create', 'words').title).toBe('The same four words');
    for (const m of ['create', 'join', 'house'] as const) {
      for (const s of ['start', 'code', 'words', 'confirm', 'done'] as const) {
        const x = mirrorText(m, s);
        expect(x.title.length).toBeGreaterThan(0);
        expect(x.line).not.toMatch(/\bthey are connected\.?$/i);
        expect(`${x.title} ${x.line}`).not.toMatch(/pinned|pairing_|\bRust\b/i);
      }
    }
    expect(mirrorText('create', 'done').line).toMatch(/once they confirm/);
  });

  it('a house seller already connected is a new practice table; without one the words stay', () => {
    expect(pairAnswer('house', 'idle', false, false, true).title).toBe('Open a new practice table');
    expect(pairAnswer('house', 'idle', false, false, true).sub).toContain('already connected');
    expect(pairAnswer('house', 'idle', false, false, false).title).toBe('Connect with the house seller');
    expect(pairAnswer('house', 'idle', false, false).title).toBe('Connect with the house seller');
    // The four-word check is unchanged either way.
    expect(pairAnswer('house', 'words', false, false, true)).toEqual(pairAnswer('house', 'words', false, false, false));
    expect(houseWords(true)).toEqual({ first: 'Open a new practice table', act: 'Open a new practice table' });
    expect(houseWords(false)).toEqual({ first: 'Connect with the house', act: 'Connect with the house' });
  });
});

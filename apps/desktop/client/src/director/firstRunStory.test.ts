// The "First run" script run end to end on the brand-new wallet's world: the four steps with the
// agent app still to do, the tour walked through every window's stops in order by writes only, and
// nothing in the run ever pays, signs, locks or touches the sample week's storage.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Form } from '@bindings/Form';
import { resetClockForTests } from '../lib/clock';
import { gettingStarted } from '../lib/firstRun';
import { loadTour, resetTourMemory, TOUR_KEY, TOUR_STOPS, tourKey, tourStops, type TourWindow } from '../lib/tour';
import { mockBackend, STORE_KEY, type MockBackend } from '../mock/backend';
import { foldScene, INITIAL_SCENE, placeTours, runActions, WORLD_ACTIONS, type Scene, type Stage } from './actions';
import { FIRST_RUN_BEATS } from './firstRunStory';
import { FIRST_RUN_EXPECT } from './takes';

type Rec = { forms: Form[]; approvals: Array<string | null>; owner: number; main: Array<{ open: boolean; route: string | null }>; dealEvents: number };

function setup(): { core: MockBackend; stage: Stage; rec: Rec } {
  const core = mockBackend('main');
  core.world.reset();
  const rec: Rec = { forms: [], approvals: [], owner: 0, main: [], dealEvents: 0 };
  void core.listen('deal:changed', () => { rec.dealEvents++; });
  const stage: Stage = {
    world: core.world,
    form: (f) => rec.forms.push(f),
    main: (open, route) => rec.main.push({ open, route }),
    approval: (id) => rec.approvals.push(id),
    owner: () => { rec.owner++; },
  };
  return { core, stage, rec };
}

/** The getting-started facts The Table reads on this world (lib/firstRun.ts). */
function mainSteps(core: MockBackend) {
  const s = core.world.settings();
  return gettingStarted({ firstRun: s.first_run, paypal: s.payment_executor_configured, rulesInForce: 0, houseConnected: false, otherConnections: 0, engine: s.selected_engine });
}

const WINDOWS: readonly TourWindow[] = ['main', 'tumbler', 'approval'];
const tourActions = () => FIRST_RUN_BEATS.flatMap((b) => b.do.flatMap((a) => (a.do === 'tour' ? [{ beat: b.id, win: a.win, at: a.at }] : [])));

beforeEach(() => {
  localStorage.clear();
  resetTourMemory();
  resetClockForTests();
  history.replaceState(null, '', '/director.html?story=first-run&first_run=1');
});
afterEach(() => {
  history.replaceState(null, '', '/');
});

describe('First run on the brand-new wallet’s world', () => {
  it('starts on four steps with the agent app to do on the practice agent', () => {
    const { core } = setup();
    const s = core.world.settings();
    expect(s.first_run).toBe(true);
    expect(s.selected_engine).toBe('scripted');
    const gs = mainSteps(core);
    expect(gs.steps.map((x) => x.key)).toEqual(['paypal', 'rules', 'practice', 'engine']);
    expect(gs.steps.find((x) => x.key === 'paypal')?.state).toBe('next');
    expect(gs.steps.find((x) => x.key === 'engine')?.state).toBe('todo');
    expect(core.world.attention().items).toEqual([]);
  });

  it('every tour action names a stop that window has, in the window’s order, and walks all of them', () => {
    const { core } = setup();
    const gs = mainSteps(core);
    for (const w of WINDOWS) {
      const order = tourStops(w, gs).map((s) => s.id);
      const pointed = tourActions().filter((a) => a.win === w);
      const stops = pointed.flatMap((a) => (a.at === null ? [] : [a.at]));
      for (const a of pointed) {
        if (a.at === null) continue;
        expect(TOUR_STOPS.find((s) => s.id === a.at)?.window, `${a.beat} → ${a.at}`).toBe(w);
        expect(order, `${a.beat} → ${a.at}`).toContain(a.at);
      }
      // never backwards (the same stop may be pointed at again)
      const idx = stops.map((id) => order.indexOf(id));
      for (let i = 1; i < idx.length; i++) expect(idx[i]!, `${w} stop ${i}`).toBeGreaterThanOrEqual(idx[i - 1]!);
      expect([...new Set(stops)]).toEqual(order);
      // putting a tour away comes last, once
      const nulls = pointed.filter((a) => a.at === null);
      expect(nulls).toHaveLength(1);
      expect(pointed.at(-1)?.at).toBeNull();
    }
  });

  it('no action moves money, changes the world or locks: the approval window only opens on her setup', () => {
    const { core, stage, rec } = setup();
    for (const b of FIRST_RUN_BEATS) {
      for (const a of b.do) {
        expect(WORLD_ACTIONS.has(a.do), `${b.id} → ${a.do}`).toBe(false);
        expect(['lock', 'select', 'handoff', 'approved_on_paypal', 'arrival', 'refused', 'visual']).not.toContain(a.do);
      }
      runActions(stage, b.do);
    }
    expect(rec.dealEvents).toBe(0);
    expect(core.world.attention().items).toEqual([]);
    expect(core.world.settings().locked).toBe(false);
    expect(core.world.settings().first_run).toBe(true);
    expect(rec.approvals.every((id) => id === null)).toBe(true);
    expect(rec.owner).toBe(1);
    expect(rec.forms).toContain('welcome');
    expect(rec.forms.at(-1)).toBe('rest');
  });

  it('points each window’s tour by a write to the first-run key only; the sample week’s storage stays untouched', () => {
    const { stage } = setup();
    const key = tourKey(true);
    let scene: Scene = INITIAL_SCENE;
    for (const b of FIRST_RUN_BEATS) {
      runActions(stage, b.do);
      scene = foldScene(scene, b.do);
      for (const w of WINDOWS) {
        const at = scene.tour[w];
        const p = loadTour(w, key);
        if (at === undefined) expect(p.status, `${b.id} ${w}`).toBe('new');
        else if (at === null) expect(p, `${b.id} ${w}`).toEqual({ status: 'finished', at: null });
        else expect(p, `${b.id} ${w}`).toEqual({ status: 'active', at });
      }
    }
    expect(localStorage.getItem(STORE_KEY)).toBeNull();
    expect(localStorage.getItem(TOUR_KEY)).toBeNull();
    expect(localStorage.getItem(key)).not.toBeNull();
  });

  it('a seek writes every window’s tour as the earlier beats left it', () => {
    setup();
    const key = tourKey(true);
    const n = FIRST_RUN_BEATS.findIndex((b) => b.id === 'tumbler-engine');
    const scene = FIRST_RUN_BEATS.slice(0, n).reduce((s, b) => foldScene(s, b.do), INITIAL_SCENE);
    localStorage.setItem(key, JSON.stringify({ approval: { status: 'skipped', at: null } }));
    placeTours(scene.tour);
    expect(loadTour('main', key)).toEqual({ status: 'active', at: 'main.approval' });
    expect(loadTour('tumbler', key)).toEqual({ status: 'active', at: 'tumbler.needs' });
    // never pointed yet: starts anew, whatever was saved before
    expect(loadTour('approval', key)).toEqual({ status: 'new', at: null });
    expect(scene.form).toBe('welcome');
    expect(scene.owner).toBe(false);
  });

  it('each beat’s expected mark matches where the beats left that window’s tour', () => {
    let scene: Scene = INITIAL_SCENE;
    for (const b of FIRST_RUN_BEATS) {
      scene = foldScene(scene, b.do);
      const list = FIRST_RUN_EXPECT[b.id] ?? [];
      expect(list.length, b.id).toBeGreaterThan(0);
      const marks = list.flatMap((e) => ('tour' in e ? [e] : []));
      expect(marks.length, `${b.id} names a mark`).toBeGreaterThan(0);
      for (const e of marks) {
        if (e.tour !== null) {
          expect(scene.tour[e.in], `${b.id} ${e.in}`).toBe(e.tour);
          continue;
        }
        // no mark: put away, or the window shows none of its stops (the Tumbler at rest, the approval window closed)
        const away = scene.tour[e.in] === null;
        const hidden = (e.in === 'tumbler' && scene.form === 'rest') || (e.in === 'approval' && !scene.owner);
        expect(away || hidden, `${b.id} ${e.in}`).toBe(true);
      }
      // the four steps are on screen where the beat says, with the agent app to do
      for (const e of list) if ('step' in e && e.step === 'engine') expect(e.state, b.id).toBe('todo');
    }
    expect(scene.main).toEqual({ open: true, route: '' });
    expect(scene.approval).toBeNull();
  });
});

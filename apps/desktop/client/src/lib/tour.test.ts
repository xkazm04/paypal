import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gettingStarted, type StartFacts } from './firstRun';
import {
  loadTour, resetTourMemory, saveTour, TOUR_KEY, TOUR_NEW, TOUR_STOPS, tourEnd, tourKey, tourMove, tourReopen, tourStops, tourView, type TourStop,
} from './tour';
import { TOUR, TOUR_STOP, tourCount } from './words';

const fresh: StartFacts = { firstRun: true, paypal: false, rulesInForce: 0, houseConnected: false, otherConnections: 0, engine: 'scripted' };
const gs = gettingStarted(fresh);
const all = () => true;
const ids = (stops: readonly TourStop[]) => stops.map((s) => s.id);

describe('the tour: stops per window from the getting-started facts', () => {
  it('each window walks its own stops in order', () => {
    expect(ids(tourStops('main', gs))).toEqual(['main.hub', 'main.promise', 'main.steps', 'main.engine', 'main.approval']);
    expect(ids(tourStops('tumbler', gs))).toEqual(['tumbler.what', 'tumbler.needs', 'tumbler.engine', 'tumbler.waiting']);
    expect(ids(tourStops('approval', gs))).toEqual(['approval.only', 'approval.steps', 'approval.engine', 'approval.config']);
    // Every stop belongs to exactly one window and has an anchor and words.
    expect(new Set(TOUR_STOPS.map((s) => s.id)).size).toBe(TOUR_STOPS.length);
    for (const s of TOUR_STOPS) {
      expect(s.anchor).toMatch(/^[a-z-]+$/);
      expect(s.words.title.length).toBeGreaterThan(0);
    }
  });

  it('the agent app stop drops out once an app is chosen, and stays while settings are unread', () => {
    const chosen = gettingStarted({ ...fresh, engine: 'codex-cli' });
    expect(ids(tourStops('main', chosen))).not.toContain('main.engine');
    expect(ids(tourStops('approval', chosen))).not.toContain('approval.engine');
    expect(ids(tourStops('main', gettingStarted({ ...fresh, engine: null })))).toContain('main.engine');
    expect(ids(tourStops('tumbler', null))).toContain('tumbler.engine');
  });

  it('a fresh wallet starts on the first stop; an everyday wallet does not start by itself', () => {
    const stops = tourStops('main', gs);
    const v = tourView(stops, TOUR_NEW, true, all);
    expect(v).toMatchObject({ n: 1, total: 5, back: null, next: 'main.promise' });
    expect(v?.stop.id).toBe('main.hub');
    expect(tourView(stops, TOUR_NEW, false, all)).toBeNull();
  });

  it('Next and Back move between stops; the last stop has no Next (it reads Finish)', () => {
    const stops = tourStops('tumbler', gs);
    let v = tourView(stops, tourMove('tumbler.needs'), true, all);
    expect(v).toMatchObject({ n: 2, total: 4, back: 'tumbler.what', next: 'tumbler.engine' });
    v = tourView(stops, tourMove(v!.next!), true, all);
    expect(v?.stop.id).toBe('tumbler.engine');
    v = tourView(stops, tourMove('tumbler.waiting'), true, all);
    expect(v).toMatchObject({ n: 4, total: 4, next: null, back: 'tumbler.engine' });
    // An active tour goes on even when the path is no longer showing (it was reopened).
    expect(tourView(stops, tourMove('tumbler.needs'), false, all)?.n).toBe(2);
  });

  it('skip and finish close it, and it does not come back by itself', () => {
    const stops = tourStops('approval', gs);
    expect(tourView(stops, tourEnd('skipped'), true, all)).toBeNull();
    expect(tourView(stops, tourEnd('finished'), true, all)).toBeNull();
  });

  it('it can be reopened on the first stop', () => {
    const stops = tourStops('approval', gs);
    const p = tourReopen(stops);
    expect(p).toEqual({ status: 'active', at: 'approval.only' });
    expect(tourView(stops, p, false, all)).toMatchObject({ n: 1, total: 4 });
  });

  it('a stop whose anchor is missing is passed over, never stuck on', () => {
    const stops = tourStops('main', gs);
    const noEngine = (a: string) => a !== 'step-engine';
    // Counted without it.
    expect(tourView(stops, TOUR_NEW, true, noEngine)?.total).toBe(4);
    // Next from the steps goes straight to the approval stop.
    expect(tourView(stops, tourMove('main.steps'), true, noEngine)?.next).toBe('main.approval');
    // Saved on the missing stop: the next one that is there is shown instead.
    expect(tourView(stops, tourMove('main.engine'), true, noEngine)?.stop.id).toBe('main.approval');
    // Saved on a missing last stop: the last one that is there.
    expect(tourView(stops, tourMove('main.approval'), true, (a) => a !== 'approval-way')?.stop.id).toBe('main.engine');
    // Nothing of this window on screen yet: nothing shows (and nothing is marked seen).
    expect(tourView(stops, TOUR_NEW, true, () => false)).toBeNull();
  });
});

describe('the tour: saved progress', () => {
  beforeEach(() => {
    localStorage.clear();
    resetTourMemory();
  });
  afterEach(() => vi.restoreAllMocks());

  it('is new when nothing (valid) is saved', () => {
    expect(loadTour('main')).toEqual(TOUR_NEW);
    localStorage.setItem(TOUR_KEY, '{not json');
    expect(loadTour('main')).toEqual(TOUR_NEW);
    localStorage.setItem(TOUR_KEY, JSON.stringify({ main: { status: 'dancing', at: 'main.hub' }, tumbler: { status: 'active', at: 'nowhere' } }));
    expect(loadTour('main')).toEqual(TOUR_NEW);
    expect(loadTour('tumbler')).toEqual({ status: 'active', at: null });
  });

  it('skip and finish persist under one key, per window', () => {
    saveTour('main', tourEnd('skipped'));
    saveTour('approval', tourEnd('finished'));
    resetTourMemory();
    expect(loadTour('main')).toEqual({ status: 'skipped', at: null });
    expect(loadTour('approval')).toEqual({ status: 'finished', at: null });
    expect(loadTour('tumbler')).toEqual(TOUR_NEW);
    expect(Object.keys(JSON.parse(localStorage.getItem(TOUR_KEY)!))).toEqual(['main', 'approval']);
    // Another window's progress, saved meanwhile, is kept.
    localStorage.setItem(TOUR_KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(TOUR_KEY)!), tumbler: { status: 'finished', at: null } }));
    saveTour('main', tourMove('main.steps'));
    expect(JSON.parse(localStorage.getItem(TOUR_KEY)!).tumbler).toEqual({ status: 'finished', at: null });
  });

  it('the first-run preview keeps its own progress', () => {
    expect(tourKey(false)).toBe('table-tour');
    expect(tourKey(true)).toBe('table-tour:first-run');
    saveTour('main', tourEnd('finished'), tourKey(true));
    resetTourMemory();
    expect(loadTour('main', tourKey(true)).status).toBe('finished');
    expect(loadTour('main', tourKey(false))).toEqual(TOUR_NEW);
  });

  it('survives storage that throws: the tour still works for the session', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadTour('main')).toEqual(TOUR_NEW);
    expect(() => saveTour('main', tourMove('main.steps'))).not.toThrow();
    expect(loadTour('main')).toEqual({ status: 'active', at: 'main.steps' });
    saveTour('main', tourEnd('skipped'));
    expect(tourView(tourStops('main', gs), loadTour('main'), true, all)).toBeNull();
  });
});

describe('the tour: words', () => {
  it('no tour string names internals or a vendor', () => {
    const text = JSON.stringify(Object.values(TOUR_STOP)) + JSON.stringify(Object.values(TOUR)) + tourCount(2, 5);
    expect(text).not.toMatch(/mandate|credential|clause|keyring|Rust|HOUSE|_open|token|scripted|engine|data-tour/);
    expect(text).not.toMatch(/Claude|Anthropic|OpenAI|Codex|GPT/);
    // UX-GUIDE: no em dashes, one or two sentences a stop.
    expect(text).not.toMatch(/—/);
    for (const w of Object.values(TOUR_STOP)) expect(w.text.split(/[.!?](\s|$)/).filter((s) => s && s.trim()).length).toBeLessThanOrEqual(2);
    expect(tourCount(2, 5)).toBe('2 of 5');
  });
});

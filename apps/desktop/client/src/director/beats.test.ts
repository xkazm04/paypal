import { describe, expect, it } from 'vitest';
import { buildMockState } from '../mock/fixtures';
import { formatHash, parseHash } from '../windows/main/logic';
import type { ActionKind } from './actions';
import { BEATS, CHAPTERS, SCRIPT_LENGTH, beatAt } from './beats';
import { helpers } from './helpers';

const labels = new Set(buildMockState(1_700_000_000).deals.map((d) => d.display.label));
const KINDS: readonly ActionKind[] = ['advance', 'until', 'rewind', 'form', 'select', 'visual', 'handoff', 'approved_on_paypal', 'arrival', 'refused', 'lock', 'main', 'approval'];

describe('the beat file', () => {
  it('is well-formed and ordered', () => {
    expect(BEATS[0]?.at).toBe(0);
    expect(new Set(BEATS.map((b) => b.id)).size).toBe(BEATS.length);
    for (let i = 1; i < BEATS.length; i++) expect(BEATS[i]!.at).toBeGreaterThan(BEATS[i - 1]!.at);
    // chapters run in order, each in one block
    const order = BEATS.map((b) => b.chapter).filter((c, i, a) => a[i - 1] !== c);
    expect(order).toEqual(CHAPTERS.map((c) => c.id));
    expect(SCRIPT_LENGTH).toBeGreaterThan(BEATS[BEATS.length - 1]!.at);
    for (const b of BEATS) {
      expect(b.caption.length).toBeGreaterThan(10);
      expect(b.caption.length).toBeLessThanOrEqual(220);
      expect(b.do.length).toBeGreaterThan(0);
    }
  });

  it('gives a judge enough time to read each caption, the last one included', () => {
    // the last caption stays until the story ends (HOLD_LAST), so the end counts as the next beat
    const all = [...BEATS, { id: 'the end', at: SCRIPT_LENGTH, caption: '' }];
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1]!;
      const words = prev.caption.split(/\s+/).length;
      expect(all[i]!.at - prev.at, prev.id).toBeGreaterThanOrEqual(Math.min(9, Math.ceil(words / 3.5)));
    }
  });

  it('uses only known actions and only deals of the sample week', () => {
    for (const b of BEATS) {
      for (const a of b.do) {
        expect(KINDS).toContain(a.do);
        if ('deal' in a && typeof a.deal === 'string') expect(labels, `${b.id} → ${a.deal}`).toContain(a.deal);
      }
    }
  });

  it('routes The Table only to places its router has, in the form it writes them', () => {
    // read by The Table's own router, not by the route's shape: `#m=tabels` has a fine shape and
    // opens the decision centre; an older form still parses, but only while that rewrite is kept
    const routes = BEATS.flatMap((b) => b.do.flatMap((a) => (a.do === 'main' && a.route ? [{ beat: b.id, route: a.route }] : [])));
    expect(routes.length).toBeGreaterThan(0);
    for (const { beat, route } of routes) {
      const r = parseHash(route).route;
      expect(r.level, `${beat} → ${route}`).not.toBe('home');
      expect(formatHash(r), `${beat} → ${route}`).toBe(route);
      if (r.level === 'deal') expect(labels, `${beat} → ${route}`).toContain(r.deal);
    }
  });

  it('never moves money: no action can approve, pay, capture, release or sign', () => {
    const text = JSON.stringify(BEATS);
    expect(text).not.toMatch(/countersign|capture|owner_accept|shield_release|rescue_approve|open_paypal|mandate_sign|unlock|deal_void/i);
    for (const b of BEATS) for (const a of b.do) expect(a.do).not.toBe('lock'); // the story never locks or unlocks for her
  });

  it('captions speak plain words, not internals', () => {
    for (const b of BEATS) {
      expect(b.caption, b.id).not.toMatch(/Rust|backend|mock|clause \d|\bD-\d{4}\b|\bQ-\d{4}\b|_list|_query|UNAVAILABLE|tumbler:|attention|mandate|countersign|capture|void|claude|codex/i);
    }
  });

  it('tells each of the four stories', () => {
    const ids = (c: string) => BEATS.filter((b) => b.chapter === c);
    expect(ids('haggle').some((b) => b.do.some((a) => a.do === 'approval' && a.deal))).toBe(true);
    expect(ids('silence').some((b) => b.do.some((a) => a.do === 'until' && a.left < 0))).toBe(true);
    expect(ids('mismatch').some((b) => b.do.some((a) => a.do === 'rewind'))).toBe(true);
    const closed = ids('closed');
    expect(closed.some((b) => b.do.some((a) => a.do === 'main' && !a.open))).toBe(true);
    expect(closed.some((b) => b.do.some((a) => a.do === 'until' && a.left < 0))).toBe(true);
  });

  it('finds the beat due at a time', () => {
    expect(beatAt(-1)).toBe(-1);
    expect(beatAt(0)).toBe(0);
    expect(beatAt(BEATS[3]!.at + 0.5)).toBe(3);
    expect(beatAt(1e9)).toBe(BEATS.length - 1);
  });
});

describe('preview control helpers', () => {
  it('cover every Tumbler preview control as data', () => {
    const names = Object.keys(helpers);
    for (const n of ['tableClosedFirstTime', 'dock', 'undock', 'paypalOpened', 'paypalOpenedLate', 'handoffOnly', 'paypalApproved', 'deadlineSoon', 'deadlineNow', 'notificationClicked', 'mismatchArrives', 'newDecision', 'agentRefused', 'idleLock', 'quietDim']) {
      expect(names).toContain(n);
    }
    for (const fn of Object.values(helpers)) {
      const out = (fn as (x?: never) => unknown[])();
      expect(Array.isArray(out) && out.length > 0).toBe(true);
      expect(JSON.parse(JSON.stringify(out))).toEqual(out);
    }
  });
});

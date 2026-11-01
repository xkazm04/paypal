// How many keys a cell shows: the board never scrolls, so a cell folds what does not fit.
import { describe, expect, it } from 'vitest';
import { DEFAULT_VISIBLE, KEY_GAP, KEY_H, MORE_H, pickDensity, stackHeight, visibleCount } from './fit';
import { resolveAction } from './resolve';
import type { BoardKey } from './useBoardModel';

const other = (n: number) => Array.from({ length: n }, () => ({ fate: 'moving' as const }));
const needs = (n: number) => Array.from({ length: n }, () => ({ fate: 'needs' as const }));

describe('visibleCount', () => {
  it('shows everything when it fits', () => {
    expect(visibleCount(other(2), 120, 'full')).toBe(2);
    expect(visibleCount([], 120, 'full')).toBe(0);
  });
  it('folds the rest and keeps room for the "+n more" key', () => {
    const avail = 100;
    const n = visibleCount(other(9), avail, 'compact');
    expect(n).toBeLessThan(9);
    expect(stackHeight(other(n), 'compact') + KEY_GAP + MORE_H).toBeLessThanOrEqual(avail);
    expect(stackHeight(other(n + 1), 'compact') + KEY_GAP + MORE_H).toBeGreaterThan(avail);
  });
  it('always shows at least one key', () => { expect(visibleCount(other(5), 10, 'full')).toBe(1); });
  it('without a measurement a cell shows a few keys', () => { expect(visibleCount(other(40), null, 'full')).toBe(DEFAULT_VISIBLE); });
  it('a needs-you key is taller (it carries the If you do nothing line)', () => {
    expect(KEY_H.full.needs).toBeGreaterThan(KEY_H.full.other);
    expect(visibleCount(needs(4), 140, 'full')).toBeLessThan(visibleCount(other(4), 140, 'full') + 1);
  });
});

describe('pickDensity', () => {
  it('full when every cell fits at full height, else compact', () => {
    expect(pickDensity([other(2), needs(1)], 150)).toBe('full');
    expect(pickDensity([other(4)], 100)).toBe('compact');
    expect(pickDensity([other(40)], null)).toBe('full');
  });
});

describe('resolveAction: the host decides what can be armed', () => {
  const k = (over: Partial<BoardKey>): BoardKey => ({ id: 'd1', module: 'tables', fate: 'needs', label: 'D-1', title: 'A monitor', state_word: 'Needs you', amount_minor: 100, currency: 'USD', deadline_ms: null, on_silence: 'x', deadline_s: null, stamp_s: null, side: 'buyer', why: 'y', review: true, ...over });
  const byId = new Map([['d1', k({})], ['d2', k({ id: 'd2', fate: 'moving', review: false })], ['d3', k({ id: 'd3', review: false })]]);
  it('a decision for a deal that needs the owner and can be reviewed is armed, and named by the deal', () => {
    const r = resolveAction({ action: 'open_decision', deal_id: 'd1' }, byId);
    expect(r.armed).toBe(true);
    if (r.armed) { expect(r.run).toEqual({ kind: 'approval', deal_id: 'd1', target: null }); expect(r.label).toContain('A monitor'); }
  });
  it.each([['unknown deal', 'nope'], ['a deal that is not waiting', 'd2'], ['a closed mismatch with no review', 'd3']])('%s is disarmed', (_n, id) => {
    expect(resolveAction({ action: 'open_decision', deal_id: id }, byId).armed).toBe(false);
  });
  it('setup targets are allowlisted', () => {
    expect(resolveAction({ action: 'open_setup', target: 'mandate' }, byId)).toMatchObject({ armed: true, run: { kind: 'approval', deal_id: null, target: 'mandate' } });
    expect(resolveAction({ action: 'open_setup', target: 'deal' as never }, byId).armed).toBe(false);
  });
  it('a console route is armed only if it is a plain route the console knows', () => {
    expect(resolveAction({ action: 'open_console', hash: '#m=spend' }, byId)).toMatchObject({ armed: true, run: { kind: 'console', hash: '#m=spend' } });
    for (const bad of ['javascript:alert(1)', '#m=spend<script>', 'https://x.test', '#' + 'a=b&'.repeat(12), '']) expect(resolveAction({ action: 'open_console', hash: bad }, byId).armed, bad).toBe(false);
  });
});

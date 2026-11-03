// The composition region as a pure value: shows add, equal panels are not duplicated and do not move,
// the cap evicts the oldest unpinned panel, pins survive every reply, and the change line says what a
// reply changed (and nothing when it changed nothing).
import { describe, expect, it } from 'vitest';
import type { PanelSpec, UiOp } from '../../../lib/assistant';
import { BOARD_CHANGED, BOARD_PANEL_TITLE } from '../../../lib/words';
import {
  applyLayout, canPin, changedAnything, changeLine, closePanel, diffArrangement, EMPTY_ARRANGEMENT, focusPanel, panelKey, PIN_MAX, place, REGION_MAX, setPinned, slotsOf, type Arrangement, type ChangeNames,
} from './region';

const money: PanelSpec = { kind: 'money' };
const rules: PanelSpec = { kind: 'rules', module: null };
const week: PanelSpec = { kind: 'week' };
const rescue: PanelSpec = { kind: 'rescue' };
const show = (panel: PanelSpec): UiOp => ({ op: 'show', panel });
const known = () => true;
const kinds = (a: Arrangement) => a.region.map((x) => x.spec.kind);
const names: ChangeNames = { panel: (p) => BOARD_PANEL_TITLE[p.kind], scope: (m, f) => [m, f].filter(Boolean).join(', ') };
const line = (b: Arrangement, a: Arrangement) => changeLine(diffArrangement(b, a), BOARD_CHANGED, names);

describe('the region holds up to three answers', () => {
  it('a cap of three, with one slot always left for the assistant', () => {
    expect(REGION_MAX).toBe(3);
    expect(PIN_MAX).toBe(REGION_MAX - 1);
  });

  it('a show adds a panel and focuses it', () => {
    const a = place(EMPTY_ARRANGEMENT, money);
    expect(kinds(a)).toEqual(['money']);
    expect(a.focus).toBe('money');
    const b = place(a, week);
    expect(kinds(b)).toEqual(['money', 'week']);
    expect(b.focus).toBe('week');
  });

  it('an equal panel is not duplicated and does not move: it stays where it is and becomes the focus', () => {
    const a = applyLayout(EMPTY_ARRANGEMENT, [show(money), show(week), show(rules)], known);
    const b = place(a, { kind: 'money' });
    expect(kinds(b)).toEqual(['money', 'week', 'rules']);
    expect(b.focus).toBe('money');
    // identity is kind plus fields: another module's rules or another deal is a different panel
    expect(panelKey({ kind: 'rules', module: 'spend' })).not.toBe(panelKey(rules));
    expect(panelKey({ kind: 'decision', deal_id: 'D-1' })).not.toBe(panelKey({ kind: 'decision', deal_id: 'D-2' }));
    expect(panelKey({ kind: 'decision', deal_id: 'D-1' })).not.toBe(panelKey({ kind: 'deal', deal_id: 'D-1' }));
    expect(panelKey({ kind: 'book', module: 'spend', fate: 'paid' })).toBe(panelKey({ kind: 'book', module: 'spend', fate: 'paid' }));
  });

  it('several shows in one reply compose several panels, the last one the focus', () => {
    const a = applyLayout(EMPTY_ARRANGEMENT, [show(money), show(rules)], known);
    expect(kinds(a)).toEqual(['money', 'rules']);
    expect(a.focus).toBe(panelKey(rules));
  });

  it('when full, the oldest panel leaves; never more than three', () => {
    const a = applyLayout(EMPTY_ARRANGEMENT, [show(money), show(week), show(rules), show(rescue)], known);
    expect(kinds(a)).toEqual(['week', 'rules', 'rescue']);
    expect(a.region.length).toBe(REGION_MAX);
  });

  it('eviction skips pinned panels: the oldest UNPINNED one leaves', () => {
    let a = applyLayout(EMPTY_ARRANGEMENT, [show(money), show(week), show(rules)], known);
    a = setPinned(a, 'money', true);
    a = applyLayout(a, [show(rescue)], known);
    expect(kinds(a)).toEqual(['money', 'rules', 'rescue']);
    expect(a.region[0]!.pinned).toBe(true);
    // a pinned panel survives every later composition
    a = applyLayout(a, [show(week), show({ kind: 'safety' }), show({ kind: 'needs', module: null })], known);
    expect(kinds(a)[0]).toBe('money');
    expect(a.region.length).toBe(REGION_MAX);
  });

  it('pins stop at PIN_MAX, so a new answer always has a slot; unpin and close are the owner\'s', () => {
    let a = applyLayout(EMPTY_ARRANGEMENT, [show(money), show(week), show(rules)], known);
    a = setPinned(setPinned(a, 'money', true), 'week', true);
    expect(canPin(a.region, panelKey(rules))).toBe(false);
    expect(setPinned(a, panelKey(rules), true)).toBe(a);
    a = applyLayout(a, [show(rescue)], known);
    expect(kinds(a)).toEqual(['money', 'week', 'rescue']);
    a = setPinned(a, 'week', false);
    expect(a.region.find((x) => x.spec.kind === 'week')!.pinned).toBe(false);
    // close removes a pinned panel too, and the focus falls to the newest panel left
    a = focusPanel(a, 'money');
    a = closePanel(a, 'money');
    expect(kinds(a)).toEqual(['week', 'rescue']);
    expect(a.focus).toBe('rescue');
    expect(closePanel(closePanel(a, 'week'), 'rescue')).toEqual({ ...a, region: [], focus: null });
  });

  it('focus and filter ops change the light and the filter; a focus on an unknown deal is skipped; propose is not layout', () => {
    const ops: UiOp[] = [
      { op: 'filter', module: 'spend', fate: null },
      { op: 'focus', module: 'rescue', fate: null, deal_id: null },
      { op: 'focus', module: null, fate: null, deal_id: 'not-a-deal' },
      { op: 'propose', action: { action: 'pause_agents' }, why: 'x' },
    ];
    const a = applyLayout(EMPTY_ARRANGEMENT, ops, (id) => id !== 'not-a-deal');
    expect(a.filter).toEqual({ module: 'spend', fate: null });
    expect(a.highlight).toEqual({ module: 'rescue', fate: null, deal_id: null });
    expect(a.region).toEqual([]);
    expect(applyLayout(a, [{ op: 'focus', module: null, fate: null, deal_id: null }], known).highlight).toBeNull();
  });
});

describe('what changed', () => {
  it('names what was added, kept (pinned said so) and removed', () => {
    let before = applyLayout(EMPTY_ARRANGEMENT, [show(rules), show(week), show(rescue)], known);
    before = setPinned(before, panelKey(rules), true);
    const after = applyLayout(before, [show(money)], known);
    expect(line(before, after)).toBe('Added: Your money today. Kept: Rules in force (pinned) and Failed renewals. Removed: This week.');
  });

  it('a first answer is one added panel', () => {
    expect(line(EMPTY_ARRANGEMENT, applyLayout(EMPTY_ARRANGEMENT, [show(money), show(week)], known))).toBe('Added: Your money today and This week.');
  });

  it('says the filter and the light, and names no panel when only they changed', () => {
    const before = applyLayout(EMPTY_ARRANGEMENT, [show(money)], known);
    const after = applyLayout(before, [{ op: 'filter', module: 'spend', fate: 'needs' }, { op: 'focus', module: 'rescue', fate: null, deal_id: null }], known);
    expect(line(before, after)).toBe('Showing only spend, needs. Lit up: rescue.');
    const cleared = applyLayout(after, [{ op: 'filter', module: null, fate: null }, { op: 'focus', module: null, fate: null, deal_id: null }], known);
    expect(line(after, cleared)).toBe('Showing the whole board again. The light is off.');
  });

  it('no line when nothing changed, including a show of a panel already there', () => {
    const before = applyLayout(EMPTY_ARRANGEMENT, [show(money), show(week), { op: 'filter', module: 'spend', fate: null }], known);
    const after = applyLayout(before, [show(money), { op: 'filter', module: 'spend', fate: null }], known);
    expect(after.focus).toBe('money');
    expect(changedAnything(diffArrangement(before, after))).toBe(false);
    expect(line(before, after)).toBeNull();
    expect(line(before, applyLayout(before, [], known))).toBeNull();
  });

  it('undo is the snapshot from before the reply: restoring it diffs to nothing', () => {
    const before = setPinned(applyLayout(EMPTY_ARRANGEMENT, [show(money), show(week), { op: 'filter', module: 'book', fate: null }], known), 'money', true);
    const after = applyLayout(before, [show(rules), show(rescue), { op: 'filter', module: null, fate: null }, { op: 'focus', module: 'shield', fate: null, deal_id: null }], known);
    expect(changedAnything(diffArrangement(before, after))).toBe(true);
    // the board restores `before` as is (Switchboard.tsx); it is untouched by the reply
    expect(kinds(before)).toEqual(['money', 'week']);
    expect(before.filter).toEqual({ module: 'book', fate: null });
    expect(changedAnything(diffArrangement(after, before))).toBe(true);
    expect(diffArrangement(before, before)).toEqual({ added: [], kept: before.region, removed: [], filter: null, highlight: null });
  });
});

describe('stable slots: an answer stays where it appeared', () => {
  /** The region by slot, as kinds ('-' = an empty slot). */
  const bySlot = (a: Arrangement) => slotsOf(a.region).map((x) => x?.spec.kind ?? '-');

  it('fill three: the slots fill in order', () => {
    const a = applyLayout(EMPTY_ARRANGEMENT, [show(money), show(week), show(rules)], known);
    expect(bySlot(a)).toEqual(['money', 'week', 'rules']);
    expect(a.region.map((x) => x.slot)).toEqual([0, 1, 2]);
    expect(bySlot(EMPTY_ARRANGEMENT)).toEqual(['-', '-', '-']);
  });

  it('pin one, place a fourth: it takes the evicted panel’s slot, and no other panel moves', () => {
    let a = applyLayout(EMPTY_ARRANGEMENT, [show(money), show(week), show(rules)], known);
    a = setPinned(a, 'money', true);
    expect(bySlot(a)).toEqual(['money', 'week', 'rules']);
    a = applyLayout(a, [show(rescue)], known);
    // week (the oldest unpinned) left slot 1; rescue sits there; money and rules did not move
    expect(kinds(a)).toEqual(['money', 'rules', 'rescue']);
    expect(bySlot(a)).toEqual(['money', 'rescue', 'rules']);
    // the next one evicts rules (now the oldest unpinned) and takes slot 2
    a = applyLayout(a, [show({ kind: 'safety' })], known);
    expect(bySlot(a)).toEqual(['money', 'rescue', 'safety']);
  });

  it('a panel never changes slot while it stays: a show of an equal panel, a pin, a focus, a close of another', () => {
    let a = applyLayout(EMPTY_ARRANGEMENT, [show(money), show(week), show(rules)], known);
    a = place(a, { kind: 'money' });
    a = setPinned(a, panelKey(rules), true);
    a = focusPanel(a, 'week');
    expect(bySlot(a)).toEqual(['money', 'week', 'rules']);
    a = closePanel(a, 'week');
    expect(bySlot(a)).toEqual(['money', '-', 'rules']);
  });

  it('close then place: the lowest free slot, with no eviction while one is free', () => {
    let a = applyLayout(EMPTY_ARRANGEMENT, [show(money), show(week), show(rules)], known);
    a = closePanel(closePanel(a, 'money'), panelKey(rules));
    expect(bySlot(a)).toEqual(['-', 'week', '-']);
    a = place(a, rescue);
    expect(bySlot(a)).toEqual(['rescue', 'week', '-']);
    a = place(a, money);
    expect(bySlot(a)).toEqual(['rescue', 'week', 'money']);
    // full again: the oldest unpinned (week) leaves, and the new one takes its slot
    a = place(a, rules);
    expect(bySlot(a)).toEqual(['rescue', 'rules', 'money']);
  });

  it('undo restores the slots: the arrangement is a value', () => {
    let before = applyLayout(EMPTY_ARRANGEMENT, [show(money), show(week), show(rules)], known);
    before = closePanel(before, 'money');
    const snapshot = bySlot(before);
    const after = applyLayout(before, [show(rescue), show({ kind: 'safety' })], known);
    expect(bySlot(after)).toEqual(['rescue', 'safety', 'rules']);
    // the board restores `before` as is: its slots are untouched by the reply
    expect(bySlot(before)).toEqual(snapshot);
    expect(snapshot).toEqual(['-', 'week', 'rules']);
  });
});

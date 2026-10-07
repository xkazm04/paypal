// The "Maya's week" script run end to end on the mock world: each story reaches its end state,
// and nothing in the run ever captures, pays or approves.
import { beforeEach, describe, expect, it } from 'vitest';
import type { DealState } from '@bindings/DealState';
import type { Form } from '@bindings/Form';
import { clockOffset, resetClockForTests } from '../lib/clock';
import { nowUnix } from '../lib/format';
import { mockBackend, type MockBackend } from '../mock/backend';
import { foldScene, INITIAL_SCENE, runActions, WORLD_ACTIONS, applyWorld, type Stage } from './actions';
import { BEATS, type ChapterId } from './beats';
import { HAGGLE, HOLD, MISMATCH, helpers } from './helpers';

type Rec = { forms: Form[]; approvals: Array<string | null>; main: Array<{ open: boolean; route: string | null }>; transitions: Array<{ label: string; to: DealState }> };

function setup(): { core: MockBackend; stage: Stage; rec: Rec } {
  const core = mockBackend('main');
  core.world.reset();
  const rec: Rec = { forms: [], approvals: [], main: [], transitions: [] };
  const labelOf = (id: string) => core.world.attention().items.find((i) => i.deal_id === id)?.label ?? [HAGGLE, HOLD, MISMATCH, 'D-0189', 'D-0198', 'Q-0207'].find((l) => core.world.deal(l)?.deal.id === id) ?? id;
  void core.listen('deal:changed', ({ deal }) => rec.transitions.push({ label: labelOf(deal.id), to: deal.state }));
  const stage: Stage = {
    world: core.world,
    form: (f) => { rec.forms.push(f); core.world.emit('tumbler:form', f); },
    main: (open, route) => rec.main.push({ open, route }),
    approval: (id) => rec.approvals.push(id),
  };
  return { core, stage, rec };
}

function runUntil(stage: Stage, last: ChapterId | 'all'): void {
  for (const b of BEATS) {
    runActions(stage, b.do);
    if (last !== 'all' && b.chapter === last && BEATS[BEATS.indexOf(b) + 1]?.chapter !== last) return;
  }
}

const state = (c: MockBackend, l: string) => c.world.deal(l)?.deal.state;

beforeEach(() => {
  localStorage.clear();
  resetClockForTests();
});

describe("Maya's week on the mock", () => {
  it('(a) the haggle reaches the gate and the approval window only opens', () => {
    const { core, stage, rec } = setup();
    runUntil(stage, 'haggle');
    const d = core.world.deal(HAGGLE);
    expect(d?.deal.state).toBe('NEGOTIATING');
    expect(d?.transcript.at(-1)).toMatchObject({ by: 'them', typ: 'COUNTER' });
    expect(d?.deal.terms.unit_price.minor).toBe(32900);
    expect(d?.attention?.kind).toBe('gate');
    expect(core.world.attention().items.some((i) => i.label === HAGGLE && i.kind === 'gate')).toBe(true);
    expect(rec.approvals).toEqual([d?.deal.id]);
    // nothing decided for her: no ACCEPT of hers, no human decision recorded
    expect(d?.transcript.some((s) => s.by === 'you' && s.typ === 'ACCEPT')).toBe(false);
    expect(d?.deal.decided_by ?? null).toBeNull();
  });

  it('(d) a deadline passes and nothing moves: the haggle is withdrawn by the safe default', () => {
    const { core, stage } = setup();
    runUntil(stage, 'silence');
    const d = core.world.deal(HAGGLE);
    expect(d?.deal.state).toBe('WITHDRAWN');
    expect(d?.deal.decided_by).toEqual({ type: 'safe_default', deadline: d?.display.deadline });
    expect(d?.attention).toBeNull();
    expect(d?.deal.paypal.order).toBeNull();
    expect(clockOffset()).toBeGreaterThan(3 * 3600);
  });

  it('(c) the mismatch arrives as a HOLD that no window can pay', async () => {
    const { core, stage } = setup();
    runUntil(stage, 'mismatch');
    const d = core.world.deal(MISMATCH);
    expect(d?.deal.state).toBe('MISMATCH');
    expect(d?.deal.shield).toBe('HOLD');
    expect(d?.attention?.kind).toBe('hold');
    expect(d?.transcript.at(-1)).toMatchObject({ typ: 'SETTLE', price: { minor: 33900 } });
    expect(d?.deal.terms.unit_price.minor).toBe(32900);
    // the approval window for it: no pay, no release, no PayPal
    history.replaceState(null, '', `/approval.html?deal=${d?.deal.id}`);
    try {
      const s = await mockBackend('approval').invoke('approval_summary', { deal_id: d?.deal.id ?? '' });
      expect(s.can_open_paypal).toBe(false);
      expect(s.can_release).toBe(false);
      expect(s.can_owner_accept).toBe(false);
    } finally {
      history.replaceState(null, '', '/');
    }
  });

  it('(b) with The Table closed the hold releases itself at the deadline, never a capture', () => {
    const { core, stage, rec } = setup();
    runUntil(stage, 'closed');
    const d = core.world.deal(HOLD);
    expect(d?.deal.state).toBe('AUTO_VOIDED');
    expect(d?.deal.decided_by).toEqual({ type: 'safe_default', deadline: d?.display.deadline });
    expect(d?.deal.paypal.capture).toBeNull();
    expect(rec.main.some((m) => !m.open)).toBe(true);
    expect(rec.forms).toContain('welcome');
  });

  it('the whole run: every lapse is a safe default and nothing is ever captured', () => {
    const { core, stage, rec } = setup();
    const history = ['D-0186', 'D-0183', 'D-0185', 'D-0178', 'D-0187'];
    runUntil(stage, 'all');
    const MONEY_IN: DealState[] = ['CAPTURED', 'RECEIPTED', 'RECONCILED', 'APPROVED', 'AUTHORIZED', 'AWAITING_APPROVAL'];
    expect(rec.transitions.filter((t) => MONEY_IN.includes(t.to))).toEqual([]);
    expect(rec.transitions).toContainEqual({ label: HOLD, to: 'AUTO_VOIDED' });
    expect(rec.transitions).toContainEqual({ label: HAGGLE, to: 'WITHDRAWN' });
    for (const l of history) expect(['CAPTURED', 'RECEIPTED']).toContain(state(core, l)); // the week's history is untouched
    for (const [l, to] of [[HAGGLE, 'WITHDRAWN'], [HOLD, 'AUTO_VOIDED'], ['D-0189', 'EXPIRED'], ['D-0198', 'WITHDRAWN'], ['Q-0207', 'WITHDRAWN']] as const) {
      expect(state(core, l)).toBe(to);
      expect(core.world.deal(l)?.deal.decided_by?.type).toBe('safe_default');
    }
    expect(state(core, MISMATCH)).toBe('MISMATCH');
  });

  it('seeking replays only world actions and folds the frames to the same scene', () => {
    const a = setup();
    runUntil(a.stage, 'all');
    const live = a.core.world.attention();
    localStorage.clear();
    resetClockForTests();
    const b = mockBackend('main');
    b.world.reset();
    for (const beat of BEATS) for (const act of beat.do) if (WORLD_ACTIONS.has(act.do)) applyWorld(b.world, act);
    expect(b.world.attention().items.map((i) => [i.label, i.kind])).toEqual(live.items.map((i) => [i.label, i.kind]));
    const scene = BEATS.reduce((s, beat) => foldScene(s, beat.do), INITIAL_SCENE);
    expect(scene.main).toEqual({ open: true, route: '' });
    expect(scene.approval).toBeNull();
  });
});

describe('preview clock on the mock', () => {
  it('advancing shares the offset through storage and the channel, and new windows read it', async () => {
    const core = mockBackend('main');
    core.world.reset();
    const heard = new Promise<unknown>((resolve) => {
      const ch = new BroadcastChannel('the-table-mock');
      ch.addEventListener('message', (m: MessageEvent<{ kind: string }>) => { if (m.data.kind === 'clock') { ch.close(); resolve(m.data); } });
    });
    core.world.advance(4 * 3600);
    expect(await heard).toEqual({ kind: 'clock', offset: 4 * 3600 });
    expect(localStorage.getItem('the-table-mock-clock')).toBe(String(4 * 3600));
    resetClockForTests();
    expect(clockOffset()).toBe(0);
    mockBackend('tumbler'); // a window opened later picks the offset up from storage
    expect(clockOffset()).toBe(4 * 3600);
  });

  it('the attention ladder follows the simulated clock', () => {
    const core = mockBackend('main');
    core.world.reset();
    const urgency = () => core.world.attention().items.find((i) => i.label === HAGGLE)?.urgency;
    expect(urgency()).toBe('calm');
    runActions({ world: core.world, form: () => {}, main: () => {}, approval: () => {} }, helpers.deadlineSoon(HAGGLE));
    expect(urgency()).toBe('soon');
    runActions({ world: core.world, form: () => {}, main: () => {}, approval: () => {} }, helpers.deadlineNow(HAGGLE));
    expect(urgency()).toBe('now');
    const due = core.world.deal(HAGGLE)?.display.deadline ?? 0;
    expect(due - nowUnix()).toBeLessThanOrEqual(14 * 60);
    expect(due - nowUnix()).toBeGreaterThan(13 * 60);
  });

  it('a reset can start the week at a story time, so the fixtures’ times of day line up', () => {
    const core = mockBackend('main');
    const start = new Date();
    start.setHours(14, 2, 4, 0);
    const at = Math.floor(start.getTime() / 1000);
    core.world.reset(at);
    expect(Math.abs(nowUnix() - at)).toBeLessThanOrEqual(1);
    const due = core.world.deal(HAGGLE)?.display.deadline ?? 0;
    expect(new Date(due * 1000).getHours()).toBe(18); // "the offer lapses at 18:00"
    expect(new Date(due * 1000).getMinutes()).toBe(0);
  });

  it('the clock never runs backwards and a reset returns to wall time', () => {
    const core = mockBackend('main');
    core.world.reset();
    const stage: Stage = { world: core.world, form: () => {}, main: () => {}, approval: () => {} };
    runActions(stage, helpers.deadlineNow(HAGGLE));
    const off = clockOffset();
    runActions(stage, helpers.deadlineSoon(HAGGLE)); // already past that rung: no move back
    expect(clockOffset()).toBe(off);
    core.world.reset();
    expect(clockOffset()).toBe(0);
  });
});

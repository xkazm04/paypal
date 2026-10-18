// The demo film's capture adapter (?take=film): the pure parts. Rectangles measured inside a framed
// window land on the recorded page through the frame's place on the desk and the desk's transform,
// and the haggle's figures come from the mock world's deal and its signed mandate, never constants;
// so do the chapter records (shopping around, the week's deadlines, who decided each money step).
import { beforeEach, describe, expect, it } from 'vitest';
import type { DealGroupView } from '@bindings/DealGroupView';
import type { HistoryStep } from '@bindings/HistoryStep';
import { resetClockForTests } from '../lib/clock';
import { nowUnix } from '../lib/format';
import { GROUP_CLOSED, GROUP_WINNER, tablesShortWho } from '../lib/words';
import { mockBackend, type MockBackend } from '../mock/backend';
import { buildMockState } from '../mock/fixtures';
import { laneSteps, weekBounds } from '../windows/main/logic';
import { runActions, type Stage } from './actions';
import { BEATS } from './beats';
import { HAGGLE, HOLD } from './helpers';
import { centre, deadlinesRecord, decisionsRecord, deskTransform, FILM_PRESS, filmTarget, haggleRecord, HOUSE_TABLE, recordShown, recordShownOnStage, shopRecord, stageRect, storyStartOn, usdText } from './takes';

describe('film rectangles', () => {
  it('splits a frame prefix from the selector, and leaves page selectors alone', () => {
    expect(filmTarget('main|.deal-head h1')).toEqual({ frame: 'main', css: '.deal-head h1' });
    expect(filmTarget('tumbler|.f.ticker, .puck-art')).toEqual({ frame: 'tumbler', css: '.f.ticker, .puck-art' });
    expect(filmTarget('approval|button')).toEqual({ frame: 'approval', css: 'button' });
    expect(filmTarget('.dir-banner')).toEqual({ frame: null, css: '.dir-banner' });
    // a CSS pseudo or attribute selector with a bar is not a frame prefix
    expect(filmTarget('[lang|=en]')).toEqual({ frame: null, css: '[lang|=en]' });
    expect(filmTarget('other|x')).toEqual({ frame: null, css: 'other|x' });
  });

  it('reads the desk transform from its computed matrix (identity when there is none)', () => {
    expect(deskTransform({ a: 0.9, e: 60, f: 18 })).toEqual({ tx: 60, ty: 18, s: 0.9 });
    expect(deskTransform(null)).toEqual({ tx: 0, ty: 0, s: 1 });
  });

  it('maps an iframe-local rectangle to page pixels at scale 1', () => {
    // The Table's iframe sits at desk (40, 64): its section at (40, 34) plus the 30 px title bar.
    // The desk is centred in a 1920 x 1046 stage under the 34 px banner: translate(60, 18).
    const r = stageRect({ x: 100, y: 200, w: 300, h: 40 }, { x: 40, y: 64 }, { tx: 60, ty: 18, s: 1 }, { x: 0, y: 34 });
    expect(r).toEqual({ x: 200, y: 316, w: 300, h: 40 });
  });

  it('maps an iframe-local rectangle through a scaled desk', () => {
    // scale 0.5 from the desk's top-left corner, desk translated by (100, 50), stage at (0, 34)
    const r = stageRect({ x: 10, y: 20, w: 200, h: 100 }, { x: 1274, y: 540 }, { tx: 100, ty: 50, s: 0.5 }, { x: 0, y: 34 });
    expect(r).toEqual({ x: 100 + 0.5 * 1284, y: 34 + 50 + 0.5 * 560, w: 100, h: 50 });
    expect(centre(r)).toEqual({ x: 792, y: 389 });
  });

  it('names a press target in a framed window for the beats whose action stands in for a click', () => {
    for (const [beat, sel] of Object.entries(FILM_PRESS)) {
      expect(filmTarget(sel).frame, beat).toBe('tumbler');
    }
  });
});

describe('film record: the haggle', () => {
  const state = buildMockState(1_800_000_000);
  const deal = state.deals.find((d) => d.display.label === HAGGLE);
  if (!deal) throw new Error('no haggle in the fixtures');
  const mandate = state.mandates.find((m) => m.payload.id === deal.deal.mandate_id && m.payload.version === deal.deal.mandate_version);
  if (!mandate) throw new Error('no signed mandate for the haggle');
  /** The deal as MockWorld.rewind shows it after its first `upTo` signed steps. */
  const upTo = (n: number) => ({
    ...deal,
    transcript: deal.transcript.filter((t) => t.seq <= n),
    attention: n >= deal.transcript.length ? deal.attention : null,
  });

  it('reads the ceiling and the ask-me threshold from the signed mandate', () => {
    const rec = haggleRecord(upTo(2), mandate.payload.clauses);
    expect(rec.ceiling).toBe(340);
    expect(rec.askAbove).toBe(250);
    expect(rec.offersMaya).toEqual([290]);
    expect(rec.offersDan).toEqual([389]);
    expect('gateAt' in rec).toBe(false);
  });

  it('follows the trade step by step, and raises the gate at Dan’s last counter', () => {
    expect(haggleRecord(upTo(10), mandate.payload.clauses)).toEqual({
      ceiling: 340, askAbove: 250, offersMaya: [290, 305, 314, 321, 327], offersDan: [389, 372, 355, 344, 333],
    });
    const gate = haggleRecord(upTo(Number.MAX_SAFE_INTEGER), mandate.payload.clauses);
    expect(gate.offersDan.at(-1)).toBe(329);
    expect(gate.gateAt).toBe(329);
    // every one of her offers stays inside her signed ceiling
    expect(Math.max(...gate.offersMaya)).toBeLessThanOrEqual(gate.ceiling ?? 0);
  });

  it('changes with the fixtures, not with a typed constant: a re-signed rule moves the record', () => {
    const resigned = mandate.payload.clauses.map((c) => (c.type === 'human_present_over' ? { ...c, amount: { ...c.amount, minor: 30_000 } } : c));
    expect(haggleRecord(upTo(2), resigned).askAbove).toBe(300);
    // without the mandate, the deal's own band still gives the ceiling; no threshold is invented
    const bare = haggleRecord(upTo(2));
    expect(bare.ceiling).toBe(340);
    expect('askAbove' in bare).toBe(false);
  });

  it('checks the record against what The Table draws', () => {
    expect(usdText(1234)).toBe('$1,234.00');
    const rec = haggleRecord(upTo(Number.MAX_SAFE_INTEGER), mandate.payload.clauses);
    expect(recordShown(rec, 'Accept Dan’s $329.00? … $327.00')).toEqual([]);
    expect(recordShown(rec, 'Accept Dan’s $329.00?')).toEqual(['the record says $327.00, The Table does not show it']);
  });
});

// ---- chapter records, from Maya's week played on the mock world ----------------------------------
// The director's record() reads the same commands these tests read (deal_groups, list_deals,
// deal_display, counterparty_list, deal_history) after the same beats, then reduces them here.

const mockStage = (core: MockBackend): Stage => ({ world: core.world, form: () => {}, main: () => {}, approval: () => {} });

/** A fresh world at the story's start (Thursday 14:02 on the takes' default day), played through `last`. */
function playThrough(last: string): MockBackend {
  const core = mockBackend('main');
  core.world.reset(storyStartOn('2026-11-05'));
  const stage = mockStage(core);
  for (const b of BEATS) {
    runActions(stage, b.do);
    if (b.id === last) break;
  }
  return core;
}

async function dealsOf(core: MockBackend) {
  const ids = await core.invoke('list_deals', null);
  return Promise.all(ids.map(async (deal) => ({ deal, display: await core.invoke('deal_display', { deal_id: deal.id }) })));
}

async function weekOf(core: MockBackend) {
  const week = weekBounds(nowUnix());
  const { steps } = await core.invoke('deal_history', { deal_id: null, from: week.start, to: week.end });
  return { week, steps, deals: await dealsOf(core) };
}

async function shopOf(core: MockBackend, groups?: DealGroupView[]) {
  const [gs, cps, deals] = await Promise.all([core.invoke('deal_groups', null), core.invoke('counterparty_list', null), dealsOf(core)]);
  const byId = new Map(deals.map((d) => [d.deal.id, d.display] as const));
  const cpBy = new Map(cps.map((c) => [c.key_id, c] as const));
  const g = (groups ?? gs)[0];
  if (!g) throw new Error('no shop-around group in the fixtures');
  return shopRecord(g, {
    deal: (id) => byId.get(id),
    seller: (key) => { const c = cpBy.get(key); return c ? tablesShortWho({ house: c.house, name: c.display_name }) : key; },
  });
}

describe('film record: shopping around', () => {
  beforeEach(() => {
    localStorage.clear();
    resetClockForTests();
  });

  it('reads the sample group as the Shop around view draws it at the story’s start', async () => {
    const core = playThrough('shop-prices');
    expect(await shopOf(core)).toEqual({
      group: 'Shopping around for the refurbished 27-inch 4K monitor',
      // Dan's table is rewound to his listing; the house seller's counter is the lowest so far
      sellers: [
        { deal: HAGGLE, seller: 'Dan', price: 389, state: 'Negotiating' },
        { deal: HOUSE_TABLE, seller: 'House seller', price: 334, state: 'Negotiating' },
      ],
    });
  });

  it('follows the world, not a typed constant: Dan’s later counter, a winner and a seller told no', async () => {
    const core = playThrough('haggle-gate');
    // after the haggle's last signed step, Dan's latest price is his $329 counter
    expect((await shopOf(core)).sellers[0]).toEqual({ deal: HAGGLE, seller: 'Dan', price: 329, state: 'Negotiating' });
    // the group rule, as Rust reports it: the house seller agreed first, Dan was told no
    const [g] = await core.invoke('deal_groups', null);
    if (!g) throw new Error('no group');
    const house = core.world.deal(HOUSE_TABLE)?.deal.id ?? '';
    const won: DealGroupView = { ...g, winner: house, tables: g.tables.map((t) => (t.deal_id === house ? { ...t, state: 'AGREED' as const } : { ...t, state: 'WITHDRAWN' as const, closed_by_group: true })) };
    const rec = await shopOf(core, [won]);
    expect(rec.winner).toBe(HOUSE_TABLE);
    expect(rec.sellers.map((s) => s.state)).toEqual([GROUP_CLOSED.text, GROUP_WINNER.text]);
    // a table with no signed price yet has no figure to show
    const unpriced: DealGroupView = { ...g, tables: g.tables.map((t) => (t.deal_id === house ? { ...t, seller_price: null } : t)) };
    expect((await shopOf(core, [unpriced])).sellers.map((s) => s.deal)).toEqual([HAGGLE]);
  });
});

describe('film record: the week’s deadlines', () => {
  beforeEach(() => {
    localStorage.clear();
    resetClockForTests();
  });

  it('when the haggle lapses: lapsed with nothing moved, the dock’s hold still open', async () => {
    const core = playThrough('silence-lapsed');
    const { week, steps, deals } = await weekOf(core);
    const rec = deadlinesRecord(deals, steps, week, nowUnix());
    expect(rec.find((d) => d.deal === HAGGLE)).toEqual({
      deal: HAGGLE, label: 'Refurbished 27-inch 4K monitor', amount: 329, kind: 'offer',
      deadlineAt: new Date((core.world.deal(HAGGLE)?.display.deadline ?? 0) * 1000).toISOString(), outcome: 'lapsed', moved: 0,
    });
    expect(rec.find((d) => d.deal === HOLD)).toMatchObject({ amount: 64, kind: 'hold', outcome: 'open', moved: 0 });
    // the earlier lapses of the week are there too (Tuesday's QHD monitor, the power supply's hold)
    expect(rec.find((d) => d.deal === 'D-0184')).toMatchObject({ kind: 'offer', outcome: 'lapsed', moved: 0 });
    expect(rec.find((d) => d.deal === 'D-0181')).toMatchObject({ kind: 'hold', outcome: 'released', moved: 0 });
    // every deadline lies inside the week, earliest first
    const at = rec.map((d) => Date.parse(d.deadlineAt) / 1000);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    for (const t of at) expect(t >= week.start && t < week.end).toBe(true);
  });

  it('when the dock’s hold runs out: released, and no deadline of the week moved money', async () => {
    const core = playThrough('closed-released');
    const { week, steps, deals } = await weekOf(core);
    const rec = deadlinesRecord(deals, steps, week, nowUnix());
    expect(rec.find((d) => d.deal === HOLD)).toEqual({
      deal: HOLD, label: 'USB-C dock for the test bench', amount: 64, kind: 'hold',
      deadlineAt: new Date((core.world.deal(HOLD)?.display.deadline ?? 0) * 1000).toISOString(), outcome: 'released', moved: 0,
    });
    expect(rec.length).toBeGreaterThanOrEqual(4);
    expect(rec.every((d) => d.moved === 0)).toBe(true);
    // by Sunday morning every deadline of the week has passed
    expect(rec.filter((d) => d.outcome === 'open')).toEqual([]);
  });

  it('reads amounts and money moved from the world: a capture on the record would show', async () => {
    const core = playThrough('silence-lapsed');
    const { week, steps, deals } = await weekOf(core);
    const dock = deals.find((d) => d.display.label === HOLD);
    if (!dock) throw new Error('no dock');
    const captured: HistoryStep = { at: nowUnix(), deal_id: dock.deal.id, seq: 1e6, kind: 'captured', state_after: 'CAPTURED', authority: { type: 'owner' }, paypal: { type: 'call', method: 'capture', outcome: 'ok' } };
    expect(deadlinesRecord(deals, [...steps, captured], week, nowUnix()).find((d) => d.deal === HOLD)?.moved).toBe(64);
    const dearer = deals.map((d) => (d === dock ? { ...d, deal: { ...d.deal, terms: { ...d.deal.terms, unit_price: { ...d.deal.terms.unit_price, minor: 7_100 } } } } : d));
    expect(deadlinesRecord(dearer, steps, week, nowUnix()).find((d) => d.deal === HOLD)?.amount).toBe(71);
  });
});

describe('film record: who decided each money step', () => {
  beforeEach(() => {
    localStorage.clear();
    resetClockForTests();
  });

  it('lists the Rewind’s money steps of the week, with who decided and whether money moved', async () => {
    const core = playThrough('end-table');
    const { steps, deals } = await weekOf(core);
    const rec = decisionsRecord(steps, deals);
    expect(rec).toHaveLength(laneSteps(steps).length);
    // the dock: its order and hold on her signed rule, released by the deadline, never paid
    expect(rec.filter((d) => d.deal === HOLD).map((d) => [d.step, d.decidedBy, d.paid, d.amount])).toEqual([
      ['order_created', 'agent', false, 64],
      ['authorized', 'agent', false, 64],
      ['auto_voided', 'deadline', false, 64],
    ]);
    // the 40 x GPU request refused before PayPal was asked; the duplicate hold she released herself
    expect(rec.find((d) => d.deal === 'D-0192')).toMatchObject({ step: 'refused', decidedBy: 'refused', paid: false });
    expect(rec.find((d) => d.deal === 'D-0180' && d.step === 'voided')).toMatchObject({ decidedBy: 'owner', paid: false });
    // captures are the only paid steps, and every one was on a rule she signed
    expect(rec.some((d) => d.paid)).toBe(true);
    expect(rec.filter((d) => d.paid).every((d) => d.step === 'captured' && d.decidedBy === 'agent')).toBe(true);
    expect(rec.filter((d) => d.decidedBy === 'deadline').every((d) => !d.paid)).toBe(true);
    const at = rec.map((d) => Date.parse(d.at));
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('follows the record: an owner’s decision reads as hers', async () => {
    const core = playThrough('end-table');
    const { steps, deals } = await weekOf(core);
    const dockId = deals.find((d) => d.display.label === HOLD)?.deal.id;
    const mine = steps.map((s): HistoryStep => (s.deal_id === dockId && s.kind === 'auto_voided' ? { ...s, kind: 'voided', authority: { type: 'owner' } } : s));
    expect(decisionsRecord(mine, deals).find((d) => d.deal === HOLD && d.step === 'voided')?.decidedBy).toBe('owner');
  });
});

describe('film record: shown on stage', () => {
  const none = { main: '', tumbler: '', approval: '' };
  it('passes when one figure of each kind is drawn, and names the kind that is not', () => {
    const rec = {
      shop: { group: 'g', sellers: [{ deal: 'a', seller: 'Dan', price: 389, state: 'Negotiating' }] },
      deadlines: [{ deal: HOLD, label: 'dock', amount: 64, kind: 'hold', deadlineAt: '', outcome: 'open', moved: 0 }],
      decisions: [{ deal: HOLD, step: 'authorized', amount: 64, decidedBy: 'agent', paid: false, at: '' }],
    };
    expect(recordShownOnStage(rec, { ...none, main: 'Dan $389.00', tumbler: 'Pay or release $64.00' })).toEqual([]);
    const miss = recordShownOnStage(rec, { ...none, main: 'Dan $389.00' });
    expect(miss).toHaveLength(2);
    expect(miss[0]).toMatch(/deadlines record names \$64\.00/);
    expect(miss[1]).toMatch(/decisions record names \$64\.00/);
    // the haggle's check stays on The Table
    expect(recordShownOnStage({ offersMaya: [327] }, { ...none, tumbler: '$327.00' })).toEqual(['the record says $327.00, The Table does not show it']);
  });
});

describe('the decisions record on the Rewind and the safety record', () => {
  const rec = {
    decisions: [
      { deal: 'D-1', step: 'captured', amount: 38, decidedBy: 'agent', paid: true, at: '2026-11-02T16:20:04.000Z' },
      { deal: 'D-2', step: 'authorized', amount: 64, decidedBy: 'agent', paid: false, at: '2026-11-03T16:20:04.000Z' },
      { deal: 'D-3', step: 'refused', amount: 11960, decidedBy: 'refused', paid: false, at: '2026-11-04T16:20:04.000Z' },
    ],
  };
  const stage = (main: string) => ({ main, tumbler: '', approval: '' });

  it('is shown by the count of money steps where a page draws counts, not amounts', () => {
    expect(recordShownOnStage(rec, stage('2 PayPal money steps this week, one refused before PayPal was asked.'))).toEqual([]);
    expect(recordShownOnStage(rec, stage('Your safety record · 2 money steps'))).toEqual([]);
  });

  it('is not shown by a wrong count or a page that is still reading the week', () => {
    expect(recordShownOnStage(rec, stage('12 PayPal money steps this week'))).toHaveLength(1);
    expect(recordShownOnStage(rec, stage('Reading the week…'))).toHaveLength(1);
  });
});

// The centre's pure model: Rust's order with "Later" moving a decision to the back, the seal's
// state read from the facts, the deadline arc, the facts strip in plain words, and the stack row's slots.
import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import { buildMockState } from '../../../mock/fixtures';
import { buildScaleState, SCALE_NOW } from '../../../mock/scale';
import { MONEY_CHECK_ENDED_SILENCE, SEAL_LINE } from '../../../lib/words';
import { centreFacts, currentIndex, cycle, deadlineProgress, orderQueue, presenceOf, putOff, stackSlots } from './centreModel';

const NOW = 1_790_000_000;
const state = buildMockState(NOW);
const items = state.deals.flatMap((d) => (d.attention ? [d.attention] : []));
const dealOf = (id: string): Deal | undefined => state.deals.find((d) => d.deal.id === id)?.deal;
const item = (over: Partial<AttentionItem>): AttentionItem => ({ ...(items[0] as AttentionItem), ...over });

describe('the queue', () => {
  it('keeps Rust’s order (deadline, no clock last) and moves "Later" to the back, in the order put off', () => {
    const a = item({ deal_id: 'a', deadline: 300 });
    const b = item({ deal_id: 'b', deadline: 100 });
    const c = item({ deal_id: 'c', deadline: null });
    const d = item({ deal_id: 'd', deadline: 200 });
    expect(orderQueue([a, b, c, d], []).map((n) => n.deal_id)).toEqual(['b', 'd', 'a', 'c']);
    expect(orderQueue([a, b, c, d], ['b']).map((n) => n.deal_id)).toEqual(['d', 'a', 'c', 'b']);
    expect(orderQueue([a, b, c, d], putOff(['b', 'd'], 'b')).map((n) => n.deal_id)).toEqual(['a', 'c', 'd', 'b']);
    // a decision that no longer waits is simply not there
    expect(orderQueue([a, c], ['b']).map((n) => n.deal_id)).toEqual(['a', 'c']);
  });
  it('keeps the picked decision while it waits, else the first; cycling wraps', () => {
    const q = orderQueue([item({ deal_id: 'x', deadline: 1 }), item({ deal_id: 'y', deadline: 2 })], []);
    expect(currentIndex(q, 'y')).toBe(1);
    expect(currentIndex(q, 'gone')).toBe(0);
    expect(currentIndex([], 'y')).toBe(-1);
    expect(cycle(1, 1, 2)).toBe(0);
    expect(cycle(0, -1, 2)).toBe(1);
  });
});

describe('the seal reads the facts', () => {
  const base = { firstRun: false, heldAtPayPal: 0, moving: 0 };
  it('says why it is quiet, holding or watching when nothing needs the owner', () => {
    expect(presenceOf({ ...base, top: undefined, deal: undefined }).state).toBe('quiet');
    expect(presenceOf({ ...base, heldAtPayPal: 2, top: undefined, deal: undefined })).toMatchObject({ state: 'holding', line: SEAL_LINE.holding });
    expect(presenceOf({ ...base, moving: 3, top: undefined, deal: undefined }).state).toBe('watching');
    expect(presenceOf({ ...base, firstRun: true, top: items[0], deal: undefined })).toMatchObject({ state: 'quiet', line: SEAL_LINE.setup });
    expect(presenceOf({ ...base, paidFlash: true, top: undefined, deal: undefined }).state).toBe('paid');
  });
  it('follows the decision in front: a pause or a hold is holding, a check is watching, an ended check stopped', () => {
    for (const n of items) {
      const p = presenceOf({ ...base, top: n, deal: dealOf(n.deal_id) });
      if (n.money_check) expect(p.state).toBe(n.on_silence === MONEY_CHECK_ENDED_SILENCE ? 'stopped' : 'watching');
      else if (n.kind === 'hold') expect(p.state).toBe('holding');
      else if (dealOf(n.deal_id)?.state === 'AUTHORIZED') expect(p.state).toBe('holding');
      else expect(['needs', 'stopped']).toContain(p.state);
      expect(p.word.length).toBeGreaterThan(0);
      expect(p.line.length).toBeGreaterThan(0);
    }
  });
});

describe('the facts strip', () => {
  it('draws no arc without a start, and clamps the fraction left', () => {
    expect(deadlineProgress(null, 0, 10)).toBeNull();
    expect(deadlineProgress(100, undefined, 10)).toBeNull();
    expect(deadlineProgress(100, 0, 25)).toBe(0.75);
    expect(deadlineProgress(100, 0, 500)).toBe(0);
  });
  it('says amount, money now and why in plain words, never a raw state or id, for every need in every world', () => {
    const worlds = [state, buildScaleState('small', SCALE_NOW), buildScaleState('large', SCALE_NOW)];
    for (const w of worlds) {
      for (const d of w.deals) {
        if (!d.attention) continue;
        const facts = centreFacts(d.attention, d.deal, SCALE_NOW);
        expect(facts.map((f) => f.key)).toEqual(['amount', 'now', 'why']);
        const text = facts.map((f) => `${String(f.k)} ${String(f.v ?? '')} ${String(f.note ?? '')}`).join(' | ');
        expect(text).not.toMatch(/\b[A-Z]{2,}_[A-Z_]+\b|\bD-\d{4}\b|_list|_query|UNAVAILABLE|\b01[0-9A-HJKMNP-TV-Z]{20,}\b/);
        expect(String(facts[0]?.v)).toMatch(/^[−-]?\$|^€|^£|\d/);
      }
    }
  });
});

describe('the stack row', () => {
  it('fits 2, 4 or 6 cards by width', () => {
    expect(stackSlots(390)).toBe(2);
    expect(stackSlots(1280)).toBe(4);
    expect(stackSlots(1920)).toBe(6);
  });
});

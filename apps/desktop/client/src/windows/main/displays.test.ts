// deal_display is read again only for the deals whose display can have changed: a deal an event
// named, a deal whose row changed, a deal with no timestamp and a deal not read yet. The live and
// paid deals are read again on the slow sweep only (the display holds no clock; countdowns are drawn
// from its deadline on the client clock). An ended deal that did not change is not read again.
import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import { buildMockState } from '../../mock/fixtures';
import { displaysToRead, displayToken } from './displays';

const NOW = 1_800_000_000;
const template = buildMockState(NOW).deals[0]!.deal;
// `null` stands for a shell that reports no timestamp (an explicit undefined would take the default).
const deal = (id: string, state: Deal['state'], updated_at: number | null = 100): Deal => ({ ...template, id, state, shield: null, updated_at: updated_at ?? undefined });
const cached = (...ds: Deal[]) => new Map(ds.map((d) => [d.id, { token: displayToken(d) }]));

describe('displayToken', () => {
  it('is the state and the moment the row last changed, or null without that moment', () => {
    expect(displayToken(deal('A', 'EXPIRED', 120))).toBe('EXPIRED|120');
    expect(displayToken(deal('A', 'EXPIRED', null))).toBeNull();
  });
});

describe('displaysToRead', () => {
  it('does not read again an ended deal that did not change', () => {
    const d = deal('A', 'RECONCILED');
    expect(displaysToRead([d], cached(d))).toEqual([]);
    const e = deal('B', 'EXPIRED');
    expect(displaysToRead([e], cached(e))).toEqual([]);
  });

  it('does not read again a live deal nothing named: the display holds no clock', () => {
    for (const state of ['NEGOTIATING', 'AGREED', 'AWAITING_APPROVAL', 'AUTHORIZED'] as const) {
      const d = deal('A', state);
      expect(displaysToRead([d], cached(d)), state).toEqual([]);
    }
  });

  it('reads a live deal, and a paid deal whose money check can close without its row changing, on the sweep', () => {
    for (const state of ['NEGOTIATING', 'AUTHORIZED', 'CAPTURED', 'RECEIPTED'] as const) {
      const d = deal('A', state);
      expect(displaysToRead([d], cached(d), true), state).toEqual(['A']);
    }
    // an ended deal that did not change is not swept
    const e = deal('B', 'EXPIRED');
    expect(displaysToRead([e], cached(e), true)).toEqual([]);
  });

  it('reads a deal an event named since its last read, and only that deal', () => {
    const x = deal('X', 'NEGOTIATING');
    const y = deal('Y', 'NEGOTIATING');
    const held = new Map([[x.id, { token: displayToken(x), invalidated: true }], [y.id, { token: displayToken(y) }]]);
    expect(displaysToRead([x, y], held)).toEqual(['X']);
  });

  it('reads an ended deal whose state or moment changed', () => {
    const was = deal('A', 'EXPIRED', 100);
    expect(displaysToRead([deal('A', 'EXPIRED', 200)], cached(was))).toEqual(['A']);
    expect(displaysToRead([deal('A', 'WITHDRAWN', 100)], cached(was))).toEqual(['A']);
  });

  it('reads a deal with no timestamp every time', () => {
    const d = deal('A', 'EXPIRED', null);
    expect(displaysToRead([d], cached(d))).toEqual(['A']);
  });

  it('reads a deal not read yet, and only the deals listed', () => {
    const a = deal('A', 'EXPIRED');
    const b = deal('B', 'EXPIRED');
    expect(displaysToRead([a, b], cached(a))).toEqual(['B']);
    expect(displaysToRead([a, b], new Map())).toEqual(['A', 'B']);
  });
});

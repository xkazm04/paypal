// deal_display is read again only for the deals whose display can have changed: a live deal always
// (its "if you do nothing" line follows the clock), a deal whose row changed, a deal with no
// timestamp and a deal not read yet. An ended deal that did not change is not read again.
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

  it('always reads a live deal', () => {
    for (const state of ['NEGOTIATING', 'AGREED', 'AWAITING_APPROVAL', 'AUTHORIZED'] as const) {
      const d = deal('A', state);
      expect(displaysToRead([d], cached(d)), state).toEqual(['A']);
    }
  });

  it('reads a paid deal whose money check can close without its row changing', () => {
    for (const state of ['CAPTURED', 'RECEIPTED'] as const) {
      const d = deal('A', state);
      expect(displaysToRead([d], cached(d)), state).toEqual(['A']);
    }
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

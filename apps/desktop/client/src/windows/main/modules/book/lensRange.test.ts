// The week lens asks for this week, and the window's answer agrees with the wallet's: the same
// range a typed "this week" sends, applied over the same deals. Pure; no IPC.
import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import { LENSES, runQuery, type Ctx } from './model';
import { lensAsRun, whenRange } from './understand';

const H = Array.from({ length: 32 }, () => 0) as unknown as Deal['transcript_head'];
function deal(id: string, kind: Deal['kind'], created_at: number): Deal {
  return {
    id, kind, side: 'buyer', counterparty: 'kp', state: 'CAPTURED', mode: 'sandbox', mandate_id: 'M', mandate_version: 1, transcript_head: H, created_at, updated_at: created_at,
    terms: { item_ref: 'x', qty: 1, unit_price: { minor: 500, currency: 'USD' }, currency: 'USD', delivery: { type: 'ship_then_capture', days: 1 } },
    paypal: { order: null, authorization: null, capture: null, subscription: null }, market: null, shield: null,
  };
}
const ctx: Ctx = { stmt: () => 'not_applicable', cpName: (d) => d.counterparty };

// Wednesday 7 Oct 2026, 15:30 in a UTC+2 calendar: this week is Mon 5 Oct 00:00 to Mon 12 Oct 00:00 local.
const NOW = 1_791_379_800;
const CALENDAR = { now: NOW, offsetMin: 120 };
const FROM = 1_791_151_200;
const TO = 1_791_756_000;
// The same instants as the Rust test `a_range_counts_only_deals_created_from_from_and_before_to`
// (crates/table-ledger/src/book.rs); that test mirrors this one.
const FIXTURE = [
  deal('before', 'purchase', FROM - 1), deal('at_from', 'purchase', FROM), deal('inside_a', 'haggle', FROM + 3 * 86_400),
  deal('inside_b', 'haggle', TO - 1), deal('at_to', 'purchase', TO), deal('after', 'purchase', TO + 1),
];
const lens = (id: string) => {
  const l = LENSES.find((x) => x.id === id);
  if (!l) throw new Error(`no lens ${id}`);
  return l;
};

describe('a ranged week query', () => {
  it('carries the range a typed "this week" sends', () => {
    const run = lensAsRun(lens('week'), CALENDAR);
    expect(run.query.range).toEqual(whenRange({ k: 'this_week' }, CALENDAR));
    expect(run.query.range).toEqual({ from: '2026-10-04T22:00:00Z', to: '2026-10-11T22:00:00Z' });
    expect(lens('week').query.range).toBeUndefined();
  });

  it('answers in the window with exactly the rows the wallet counts: [from, to)', () => {
    const r = runQuery(lensAsRun(lens('week'), CALENDAR).query, FIXTURE, ctx);
    expect(r.rows.map((d) => d.id)).toEqual(['at_from', 'inside_a', 'inside_b']);
    expect(r.groups.map((g) => [g.label, g.count])).toEqual([['haggle', 2], ['purchase', 1]]);
  });
});

describe('a preset lens that names no time', () => {
  it('is run as it is, and the window reads every deal on record', () => {
    for (const id of ['pending', 'decided', 'day', 'stopped', 'mismatch', 'rescue']) {
      const l = lens(id);
      expect(lensAsRun(l, CALENDAR)).toBe(l);
    }
    const r = runQuery(lensAsRun(lens('day'), CALENDAR).query, FIXTURE, ctx);
    expect(r.rows).toHaveLength(FIXTURE.length);
  });
});

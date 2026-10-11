// deal_evidence is read again only for the deals whose evidence can have changed: a deal not read
// yet, one whose row changed or has no timestamp, a live one, one with an open money check and a
// paid seller deal the wallet has not verified yet. The answers outlive the Book, one pass runs at a
// time, and a pass that a newer list supersedes starts no further read but keeps what it finished.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deal } from '@bindings/Deal';
import type { DealEvidence } from '@bindings/DealEvidence';
import type { HouseRecord } from '@bindings/HouseRecord';
import type { MoneyCheck } from '@bindings/MoneyCheck';
import { buildMockState } from '../../mock/fixtures';
import { READ_CONCURRENCY } from '../../lib/readEach';
import { displayToken } from './displays';
import { evidenceToRead, resetEvidence, useEvidence } from './evidence';

type Invoke = (cmd: string, args: { deal_id: string }) => Promise<DealEvidence>;
const hoisted = vi.hoisted((): { invoke: Invoke | null } => ({ invoke: null }));
vi.mock('../../lib/runtime', () => ({
  backend: () => ({
    invoke: (cmd: string, args: { deal_id: string }) => {
      if (!hoisted.invoke) throw new Error('no fake invoke');
      return hoisted.invoke(cmd, args);
    },
  }),
}));

const NOW = 1_800_000_000;
const template = buildMockState(NOW).deals[0]!.deal;
// `null` stands for a shell that reports no timestamp (an explicit undefined would take the default).
const deal = (id: string, state: Deal['state'], updated_at: number | null = 100, side: Deal['side'] = 'seller'): Deal => ({ ...template, id, state, side, shield: null, updated_at: updated_at ?? undefined });
type Seen = Pick<DealEvidence, 'reconciliation' | 'money_check' | 'house_record'>;
const SETTLED: Seen = { reconciliation: 'matched', money_check: null, house_record: null };
const evidence = (id: string, e: Partial<Seen> = {}): DealEvidence => ({ deal_id: id, receipt: 'PAYPAL_VERIFIED', ...SETTLED, ...e });
const cached = (d: Deal, e: Partial<Seen> = {}) => new Map([[d.id, { token: displayToken(d), evidence: { ...SETTLED, ...e } }]]);
const paid: Deal['state'][] = ['CAPTURED', 'RECEIPTED'];
const sides: Deal['side'][] = ['seller', 'buyer'];
const check: MoneyCheck = { step: 'capture', state: 'checking', since: 1, next_check: null };
const record: HouseRecord = { state: 'holds', kept_at: 1, entries: 3, checked_at: null };

describe('evidenceToRead', () => {
  it('does not read again an ended deal that did not change, with settled evidence', () => {
    const ended: Deal['state'][] = ['EXPIRED', 'VOIDED', 'RECONCILED', 'CAPTURED', 'RECEIPTED'];
    for (const state of ended) {
      const d = deal('A', state);
      expect(evidenceToRead([d], cached(d)), state).toEqual([]);
    }
    const mismatch = deal('B', 'MISMATCH');
    expect(evidenceToRead([mismatch], cached(mismatch, { reconciliation: 'mismatch' }))).toEqual([]);
  });

  it('reads a deal not read yet, and only the deals listed', () => {
    const a = deal('A', 'EXPIRED');
    const b = deal('B', 'EXPIRED');
    expect(evidenceToRead([a, b], cached(a))).toEqual(['B']);
    expect(evidenceToRead([a, b], new Map())).toEqual(['A', 'B']);
  });

  it('reads an ended deal whose state or moment changed', () => {
    const was = deal('A', 'EXPIRED', 100);
    expect(evidenceToRead([deal('A', 'EXPIRED', 200)], cached(was))).toEqual(['A']);
    expect(evidenceToRead([deal('A', 'WITHDRAWN', 100)], cached(was))).toEqual(['A']);
  });

  it('reads a deal with no timestamp every time', () => {
    const d = deal('A', 'EXPIRED', null);
    expect(evidenceToRead([d], cached(d))).toEqual(['A']);
  });

  it('always reads a live deal', () => {
    const live: Deal['state'][] = ['NEGOTIATING', 'AGREED', 'AWAITING_APPROVAL', 'AUTHORIZED'];
    for (const state of live) {
      const d = deal('A', state);
      expect(evidenceToRead([d], cached(d)), state).toEqual(['A']);
    }
  });

  it('reads an ended deal whose cached money check is open', () => {
    const d = deal('A', 'CAPTURED');
    expect(evidenceToRead([d], cached(d, { money_check: check }))).toEqual(['A']);
  });

  it('reads a paid seller deal with no statement yet, which a receipt can change without its row changing', () => {
    for (const state of paid) {
      const d = deal('A', state);
      expect(evidenceToRead([d], cached(d, { reconciliation: 'not_applicable' })), state).toEqual(['A']);
    }
  });

  it('does not read a buyer deal for its missing statement: its receipt comes with a state change', () => {
    for (const state of paid) {
      const d = deal('A', state, 100, 'buyer');
      expect(evidenceToRead([d], cached(d, { reconciliation: 'not_applicable' })), state).toEqual([]);
    }
  });

  it('does not read a deal for a pending statement: its only exit writes the row', () => {
    for (const side of sides) {
      const d = deal('A', 'RECEIPTED', 100, side);
      expect(evidenceToRead([d], cached(d, { reconciliation: 'pending_reporting' })), side).toEqual([]);
    }
  });

  it('does not read a deal for its house record, which the Book never shows', () => {
    const d = deal('A', 'RECONCILED');
    expect(evidenceToRead([d], cached(d, { house_record: record }))).toEqual([]);
  });

  it('does not read a settled buyer deal', () => {
    for (const state of paid) {
      const d = deal('A', state, 100, 'buyer');
      expect(evidenceToRead([d], cached(d)), state).toEqual([]);
    }
  });

  it('gives exactly the one changed deal among 100 ended, unchanged ones', () => {
    const many = Array.from({ length: 100 }, (_, i) => deal(`D${i}`, 'EXPIRED'));
    const changed = deal('X', 'EXPIRED', 100);
    const cache = new Map([...many, changed].flatMap((d) => [...cached(d)]));
    expect(evidenceToRead([...many, deal('X', 'EXPIRED', 200)], cache)).toEqual(['X']);
  });
});

// A ledger of ended deals that all carry tokens: settled buyer deals, paid seller deals with a
// pending statement, deals with a house record, and stopped deals.
function ledger(n: number): { deals: Deal[]; answers: Map<string, DealEvidence> } {
  const deals: Deal[] = [];
  const answers = new Map<string, DealEvidence>();
  for (let i = 0; i < n; i += 1) {
    const id = `L${i}`;
    const at = 1000 + i;
    switch (i % 4) {
      case 0: deals.push(deal(id, 'RECONCILED', at, 'buyer')); answers.set(id, evidence(id)); break;
      case 1: deals.push(deal(id, 'RECEIPTED', at, 'seller')); answers.set(id, evidence(id, { reconciliation: 'pending_reporting' })); break;
      case 2: deals.push(deal(id, 'RECONCILED', at, 'seller')); answers.set(id, evidence(id, { house_record: record })); break;
      default: deals.push(deal(id, i % 8 === 3 ? 'EXPIRED' : 'VOIDED', at, 'seller')); answers.set(id, evidence(id)); break;
    }
  }
  return { deals, answers };
}
function cacheOf(deals: readonly Deal[], answers: ReadonlyMap<string, DealEvidence>): Map<string, { token: string | null; evidence: DealEvidence }> {
  const out = new Map<string, { token: string | null; evidence: DealEvidence }>();
  for (const d of deals) {
    const evidence = answers.get(d.id);
    if (evidence) out.set(d.id, { token: displayToken(d), evidence });
  }
  return out;
}

describe('a ledger of 10,000 ended deals', () => {
  const N = 10_000;
  let calls: string[];
  beforeEach(() => { resetEvidence(); calls = []; });
  afterEach(() => { cleanup(); hoisted.invoke = null; });
  const answering = (answers: ReadonlyMap<string, DealEvidence>): Invoke => async (_cmd, args) => {
    calls.push(args.deal_id);
    const e = answers.get(args.deal_id);
    if (!e) throw new Error('unknown deal');
    return e;
  };
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });

  it('with nothing changed names no read, and a reopened Book or a refetch makes none', async () => {
    const { deals, answers } = ledger(N);
    expect(evidenceToRead(deals, cacheOf(deals, answers))).toEqual([]);
    hoisted.invoke = answering(answers);
    const first = renderHook(({ d }) => useEvidence(d), { initialProps: { d: deals } });
    await waitFor(() => expect(first.result.current.map.size).toBe(N), { timeout: 30_000 });
    expect(calls).toHaveLength(N);
    first.unmount();
    calls = [];
    // The Book reopened: the chips are there at once and nothing is read.
    const second = renderHook(({ d }) => useEvidence(d), { initialProps: { d: deals } });
    expect(second.result.current.map.size).toBe(N);
    await settle();
    expect(calls).toHaveLength(0);
    // A refetch with the same deals.
    second.rerender({ d: [...deals] });
    await settle();
    expect(calls).toHaveLength(0);
    expect(second.result.current.map.size).toBe(N);
  }, 60_000);

  it('adds only a changed deal, a live deal and a deal with an open money check', async () => {
    const base = ledger(N);
    const live = deal('LIVE', 'AGREED', 5000);
    const open = deal('OPEN', 'CAPTURED', 5001);
    const answers = new Map(base.answers);
    answers.set('LIVE', evidence('LIVE'));
    answers.set('OPEN', evidence('OPEN', { money_check: check }));
    const deals = [...base.deals, live, open];
    const changedAt = base.deals.findIndex((d) => d.id === 'L3');
    const changed = base.deals.map((d, i) => (i === changedAt ? { ...d, updated_at: 9999 } : d));
    expect(evidenceToRead([...changed, live, open], cacheOf(deals, answers)).sort()).toEqual(['L3', 'LIVE', 'OPEN']);

    hoisted.invoke = answering(answers);
    const view = renderHook(({ d }) => useEvidence(d), { initialProps: { d: deals } });
    await waitFor(() => expect(view.result.current.map.size).toBe(N + 2), { timeout: 30_000 });
    calls = [];
    view.rerender({ d: [...changed, live, open] });
    await waitFor(() => expect(calls).toHaveLength(3));
    await settle();
    expect(calls.sort()).toEqual(['L3', 'LIVE', 'OPEN']);
  }, 60_000);
});

describe('one pass at a time', () => {
  type Held = { id: string; resolve: () => void };
  let held: Held[];
  let calls: string[];
  let inFlight: number;
  let most: number;
  const answers = new Map<string, DealEvidence>();
  const ids50 = Array.from({ length: 50 }, (_, i) => `D${String(i).padStart(2, '0')}`);
  // D49 is the most recently updated, so a first fill reads it first.
  const list = (changedAt: Record<string, number> = {}): Deal[] => ids50.map((id, i) => deal(id, 'EXPIRED', changedAt[id] ?? 100 + i));

  beforeEach(() => {
    resetEvidence();
    held = [];
    calls = [];
    inFlight = 0;
    most = 0;
    answers.clear();
    for (const id of ids50) answers.set(id, evidence(id));
    hoisted.invoke = (_cmd, args) => new Promise<DealEvidence>((resolve, reject) => {
      calls.push(args.deal_id);
      inFlight += 1;
      most = Math.max(most, inFlight);
      held.push({
        id: args.deal_id,
        resolve: () => {
          inFlight -= 1;
          const e = answers.get(args.deal_id);
          if (e) resolve(e); else reject(new Error('unreadable'));
        },
      });
    });
  });
  afterEach(() => { cleanup(); hoisted.invoke = null; });

  const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const release = () => act(async () => {
    for (const h of held.splice(0)) h.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('reads the most recently updated deals first', async () => {
    renderHook(({ d }) => useEvidence(d), { initialProps: { d: list() } });
    await waitFor(() => expect(held).toHaveLength(READ_CONCURRENCY));
    expect(held.map((h) => h.id)).toEqual(ids50.slice(-READ_CONCURRENCY).reverse());
  });

  it('keeps 5 refetches during a pass to 8 reads in flight and 50 plus the changed deals reads', async () => {
    const view = renderHook(({ d }) => useEvidence(d), { initialProps: { d: list() } });
    await waitFor(() => expect(held).toHaveLength(READ_CONCURRENCY));
    const firstEight = held.map((h) => h.id);
    // Five new lists during the first pass; the last one changes a deal the first pass is reading.
    for (let k = 0; k < 4; k += 1) view.rerender({ d: list() });
    view.rerender({ d: list({ D49: 500 }) });
    await tick();
    // The superseded pass starts nothing more.
    expect(calls).toHaveLength(READ_CONCURRENCY);
    await release();
    // Its eight reads are kept: the next pass skips them, except the one whose token changed.
    await waitFor(() => expect(held.length).toBeGreaterThan(0));
    const settled = view.result.current.map;
    expect([...settled.keys()].sort()).toEqual([...firstEight].sort());
    for (let i = 0; i < 100 && view.result.current.map.size < 50; i += 1) await release();
    expect(view.result.current.map.size).toBe(50);
    expect(most).toBeLessThanOrEqual(READ_CONCURRENCY);
    expect(calls.length).toBeLessThanOrEqual(50 + 1);
    expect(calls.filter((id) => id === 'D49')).toHaveLength(2);
    expect(calls.filter((id) => id !== 'D49' && firstEight.includes(id))).toHaveLength(7);
    expect(view.result.current.error).toBeNull();
  });

  it('stops reading when the Book closes and keeps the reads that finished', async () => {
    const first = renderHook(({ d }) => useEvidence(d), { initialProps: { d: list() } });
    await waitFor(() => expect(held).toHaveLength(READ_CONCURRENCY));
    first.unmount();
    await release();
    await tick();
    expect(calls).toHaveLength(READ_CONCURRENCY);
    // Reopened: the eight are there at once and are not read again.
    const second = renderHook(({ d }) => useEvidence(d), { initialProps: { d: list() } });
    expect(second.result.current.map.size).toBe(READ_CONCURRENCY);
    for (let i = 0; i < 100 && second.result.current.map.size < 50; i += 1) await release();
    expect(second.result.current.map.size).toBe(50);
    expect(calls).toHaveLength(50);
    expect(most).toBeLessThanOrEqual(READ_CONCURRENCY);
  });

  it('leaves a failed read uncached, sets the error, and reads it again on the next refetch', async () => {
    answers.delete('D00');
    const view = renderHook(({ d }) => useEvidence(d), { initialProps: { d: list() } });
    for (let i = 0; i < 100 && view.result.current.error === null; i += 1) await release();
    expect(view.result.current.error).not.toBeNull();
    expect(view.result.current.map.has('D00')).toBe(false);
    expect(view.result.current.map.size).toBe(49);
    answers.set('D00', evidence('D00'));
    calls = [];
    view.rerender({ d: list() });
    for (let i = 0; i < 100 && view.result.current.map.size < 50; i += 1) await release();
    expect(calls).toEqual(['D00']);
    expect(view.result.current.map.size).toBe(50);
    expect(view.result.current.error).toBeNull();
  });
});

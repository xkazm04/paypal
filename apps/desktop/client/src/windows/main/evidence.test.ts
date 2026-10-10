// deal_evidence is read again only for the deals whose evidence can have changed: a deal not read
// yet, one whose row changed or has no timestamp, a live one, and an ended one whose evidence can
// still change with no write to its row. An ended deal that did not change, with settled evidence,
// is not read again.
import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import type { DealEvidence } from '@bindings/DealEvidence';
import type { HouseRecord } from '@bindings/HouseRecord';
import type { MoneyCheck } from '@bindings/MoneyCheck';
import { buildMockState } from '../../mock/fixtures';
import { displayToken } from './displays';
import { evidenceToRead } from './evidence';

const NOW = 1_800_000_000;
const template = buildMockState(NOW).deals[0]!.deal;
// `null` stands for a shell that reports no timestamp (an explicit undefined would take the default).
const deal = (id: string, state: Deal['state'], updated_at: number | null = 100, side: Deal['side'] = 'seller'): Deal => ({ ...template, id, state, side, shield: null, updated_at: updated_at ?? undefined });
type Seen = Pick<DealEvidence, 'reconciliation' | 'money_check' | 'house_record'>;
const SETTLED: Seen = { reconciliation: 'matched', money_check: null, house_record: null };
const cached = (d: Deal, evidence: Partial<Seen> = {}) => new Map([[d.id, { token: displayToken(d), evidence: { ...SETTLED, ...evidence } }]]);
const check = { step: 'capture', state: 'checking', since: 1, next_check: null } as MoneyCheck;
const record = { state: 'consistent' } as unknown as HouseRecord;

describe('evidenceToRead', () => {
  it('does not read again an ended deal that did not change, with settled evidence', () => {
    for (const state of ['EXPIRED', 'VOIDED', 'RECONCILED', 'CAPTURED', 'RECEIPTED'] as const) {
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
    for (const state of ['NEGOTIATING', 'AGREED', 'AWAITING_APPROVAL', 'AUTHORIZED'] as const) {
      const d = deal('A', state);
      expect(evidenceToRead([d], cached(d)), state).toEqual(['A']);
    }
  });

  it('reads an ended deal whose cached money check is open', () => {
    const d = deal('A', 'CAPTURED');
    expect(evidenceToRead([d], cached(d, { money_check: check }))).toEqual(['A']);
  });

  it('reads an ended deal that has a house record, which a later house head changes', () => {
    const d = deal('A', 'RECONCILED');
    expect(evidenceToRead([d], cached(d, { house_record: record }))).toEqual(['A']);
  });

  it('reads a deal whose statement is still pending', () => {
    const d = deal('A', 'RECEIPTED');
    expect(evidenceToRead([d], cached(d, { reconciliation: 'pending_reporting' }))).toEqual(['A']);
  });

  it('reads a paid deal with no statement yet, which a receipt can change without its row changing', () => {
    for (const state of ['CAPTURED', 'RECEIPTED'] as const) {
      const d = deal('A', state);
      expect(evidenceToRead([d], cached(d, { reconciliation: 'not_applicable' })), state).toEqual(['A']);
    }
  });

  it('reads a settled buyer deal, where a house head can be kept beside the receipt with no row write', () => {
    for (const state of ['RECEIPTED', 'RECONCILED'] as const) {
      const d = deal('A', state, 100, 'buyer');
      expect(evidenceToRead([d], cached(d)), state).toEqual(['A']);
    }
  });

  it('gives exactly the one changed deal among 100 ended, unchanged ones', () => {
    const many = Array.from({ length: 100 }, (_, i) => deal(`D${i}`, 'EXPIRED'));
    const changed = deal('X', 'EXPIRED', 100);
    const cache = new Map([...many, changed].flatMap((d) => [...cached(d)]));
    expect(evidenceToRead([...many, deal('X', 'EXPIRED', 200)], cache)).toEqual(['X']);
  });
});

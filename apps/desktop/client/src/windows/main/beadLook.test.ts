// The dial's beads: a payment whose outcome is not known is a dashed bead with the check's words,
// now and on the Rewind, and never the on-hold bead or "nothing moved"; everything else keeps the
// look and words Home gave it before.
import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import type { HistoryKind } from '@bindings/HistoryKind';
import type { HistoryStep } from '@bindings/HistoryStep';
import { buildMockState } from '../../mock/fixtures';
import { ENDING_UNREAD_NOW, ENDING_UNREAD_PILL, MONEY_CHECK_ENDED_NOW, MONEY_CHECK_ENDED_PILL, MONEY_CHECK_NOW, MONEY_CHECK_PILL } from '../../lib/words';
import { liveLook, pastLook } from './beadLook';
import { chipTone } from './home/model';
import { chipClass, historyAt, moneyNow, stateLabel } from './logic';

const NOW = 1_800_000_000;
const ID = 'deal-look';
const template = buildMockState(NOW).deals[0]!.deal;
const deal = (state: Deal['state']): Deal => ({ ...template, id: ID, state, shield: null });
const need = (check: boolean): AttentionItem => ({
  deal_id: ID, label: 'D-0001', kind: 'hold', module: 'counter', headline: 'Checking with PayPal', amount_minor: 100, currency: 'USD',
  counterparty: null, clause: null, deadline: null, on_silence: 'nothing is sent', urgency: 'calm', mode: 'sandbox', actions: ['open_in_table'],
  money_check: check ? { step: 'capture', state: 'checking', since: NOW - 60, next_check: null } : null,
});
let seq = 0;
const step = (at: number, kind: HistoryKind, o: Partial<HistoryStep> = {}): HistoryStep =>
  ({ deal_id: ID, seq: ++seq, at, kind, state_after: null, authority: { type: 'none' }, paypal: { type: 'none' }, ...o });
const at = (steps: HistoryStep[], t: number) => {
  const p = historyAt(steps, t).get(ID);
  if (!p) throw new Error('deal absent at the playhead');
  return p;
};
const NONE: ReadonlySet<string> = new Set();

describe('liveLook: a bead as the deal stands now', () => {
  it('draws a payment being checked with PayPal as unknown, with the check’s words', () => {
    expect(liveLook(deal('AUTHORIZED'), need(true))).toEqual({ kind: 'unknown', state: MONEY_CHECK_PILL, tone: 'dashed', money: MONEY_CHECK_NOW });
  });
  it('keeps the on-hold bead and today’s words when nothing is being checked', () => {
    const d = deal('AUTHORIZED');
    const want = { kind: 'held', state: stateLabel('AUTHORIZED', d), tone: chipTone(chipClass(d)), money: moneyNow(d) };
    expect(liveLook(d, need(false))).toEqual(want);
    expect(liveLook(d, undefined)).toEqual(want);
  });
});

describe('pastLook: a bead on the Rewind', () => {
  it('draws D-0194 as unknown at the Rewind’s opening playhead', () => {
    const st = buildMockState(NOW);
    const d194 = st.deals.find((x) => x.display.label === 'D-0194')!.deal;
    const steps = st.history ?? [];
    const lastAt = Math.max(...steps.filter((x) => x.deal_id === d194.id).map((x) => x.at));
    const p = historyAt(steps, lastAt).get(d194.id);
    if (!p) throw new Error('D-0194 absent at the playhead');
    expect(pastLook(steps, p, d194, NONE, NONE)).toMatchObject({ kind: 'unknown', state: MONEY_CHECK_PILL, tone: 'dashed', money: MONEY_CHECK_NOW });
  });
  it('draws an EXPIRED deal whose check was open as unknown, with the ended words', () => {
    const steps = [step(10, 'checking_with_paypal'), step(40, 'expired', { state_after: 'EXPIRED' })];
    expect(pastLook(steps, at(steps, 50), deal('EXPIRED'), NONE, NONE))
      .toEqual({ kind: 'unknown', state: MONEY_CHECK_ENDED_PILL, tone: 'dashed', money: MONEY_CHECK_ENDED_NOW });
  });
  it('draws an ending whose record could not be read as unknown, never nothing moved', () => {
    const steps = [step(40, 'expired', { state_after: 'EXPIRED' })];
    const look = pastLook(steps, at(steps, 50), deal('EXPIRED'), NONE, new Set([ID]));
    expect(look).toEqual({ kind: 'unknown', state: ENDING_UNREAD_PILL, tone: 'dashed', money: ENDING_UNREAD_NOW });
    expect(look.money).not.toMatch(/nothing moved/i);
  });
  it('keeps nothing moved for a plain EXPIRED deal, where it is true', () => {
    const steps = [step(40, 'expired', { state_after: 'EXPIRED' })];
    const d = deal('EXPIRED');
    const look = pastLook(steps, at(steps, 50), d, NONE, NONE);
    expect(look).toEqual({ kind: 'off', state: stateLabel('EXPIRED', d), tone: chipTone(chipClass(d)), money: moneyNow(d) });
    expect(look.money).toBe('nothing moved');
  });
});

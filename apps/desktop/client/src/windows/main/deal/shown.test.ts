import { describe, expect, it } from 'vitest';
import type { HistoryStep } from '@bindings/HistoryStep';
import type { RungMark } from '@bindings/RungMark';
import { buildMockState, fakeUlid } from '../../../mock/fixtures';
import { shownParts, shownStep, shownTime } from './shown';

/** Local wall-clock seconds for a day of October 2026 at hh:mm (the strip prints local times). */
const t = (day: number, hh: number, mm: number) => Math.floor(new Date(2026, 9, day, hh, mm).getTime() / 1000);
const step = (over: Partial<HistoryStep>): HistoryStep => ({
  at: t(6, 18, 0), deal_id: 'D', seq: 9, kind: 'lapsed', state_after: 'WITHDRAWN',
  authority: { type: 'safe_default' }, paypal: { type: 'none' }, ...over,
});
const mark = (rung: RungMark['rung'], at: number, reason?: RungMark['reason']): RungMark => ({ rung, at, ...(reason ? { reason } : {}) });

describe('what you were shown', () => {
  it('reads the brief’s lapse word for word: ending, shown, notified, opened, no money moved', () => {
    const s = step({ rungs: [mark('shown', t(6, 16, 2)), mark('breathing', t(6, 16, 2)), mark('notified', t(6, 17, 45)), mark('card_opened', t(6, 17, 50))] });
    expect(shownParts(s, t(6, 20, 0)).join(' · ')).toBe('Lapsed 18:00 · shown 16:02 · notified 17:45 · opened 17:50 · no money moved');
  });

  it('says plainly why the owner was not notified, and never says notified when she was not', () => {
    for (const [reason, words] of [
      ['do_not_disturb', 'not notified: Do Not Disturb was on'],
      ['notifications_off', 'not notified: notifications were off'],
      ['system_quiet', 'not notified: your computer was in a quiet mode'],
      ['not_shown', 'not notified: the notification couldn’t be shown'],
    ] as const) {
      const parts = shownParts(step({ rungs: [mark('shown', t(6, 9, 0)), mark('notify_suppressed', t(6, 17, 45), reason)] }), t(6, 20, 0));
      expect(parts).toContain(words);
      expect(parts.join(' ')).not.toMatch(/notified \d/);
    }
    // Shown once more after a failed toast: the notification that did show wins.
    const both = shownParts(step({ rungs: [mark('shown', t(6, 9, 0)), mark('notify_suppressed', t(6, 17, 45), 'not_shown'), mark('notified', t(6, 17, 46))] }), t(6, 20, 0));
    expect(both).toEqual(['Lapsed 18:00', 'shown 09:00', 'notified 17:46', 'no money moved']);
  });

  it('orders what happened by time, names another day, and counts a review as opening it', () => {
    const s = step({
      kind: 'auto_voided', state_after: 'AUTO_VOIDED', paypal: { type: 'call', method: 'void', outcome: 'ok' }, at: t(8, 11, 53),
      rungs: [mark('shown', t(5, 11, 48)), mark('snoozed', t(5, 12, 0)), mark('review_opened', t(8, 11, 0)), mark('notified', t(8, 11, 38))],
    });
    expect(shownParts(s, t(9, 9, 0))).toEqual([
      `Hold released ${shownTime(t(8, 11, 53), t(9, 9, 0))}`, `shown ${shownTime(t(5, 11, 48), t(8, 0, 0))}`, `snoozed ${shownTime(t(5, 12, 0), t(8, 0, 0))}`,
      'opened 11:00', 'notified 11:38', 'nothing was paid',
    ]);
    expect(shownTime(t(5, 11, 48), t(8, 0, 0))).toMatch(/^[A-Z][a-z]{2} 11:48$/);
  });

  it('says so when the card was never on screen before its deadline', () => {
    expect(shownParts(step({ kind: 'expired', state_after: 'EXPIRED', rungs: [] }), t(6, 20, 0))).toEqual(['Expired 18:00', 'not shown to you before the deadline', 'no money moved']);
  });

  it('shows only on a safe default that cites its rungs', () => {
    expect(shownStep([step({ rungs: null })])).toBeNull();
    expect(shownStep([step({})])).toBeNull();
    expect(shownStep([step({ authority: { type: 'owner' }, kind: 'withdrawn', rungs: [] })])).toBeNull();
    expect(shownStep([step({ kind: 'captured', rungs: [] })])).toBeNull();
    const cited = step({ rungs: [] });
    expect(shownStep([step({ seq: 1, kind: 'created', authority: { type: 'none' } }), cited])).toBe(cited);
  });

  it('the sample week carries a lapse that cites its rungs and a hold released while Do Not Disturb was on', () => {
    const s = buildMockState(t(9, 12, 0));
    const of = (label: string) => shownStep((s.history ?? []).filter((h) => h.deal_id === fakeUlid(label)));
    const lapse = of('D-0184');
    expect(lapse?.kind).toBe('lapsed');
    expect(lapse && shownParts(lapse, t(9, 12, 0)).slice(1)).toEqual(['shown 16:02', 'notified 17:45', 'opened 17:50', 'no money moved']);
    const hold = of('D-0181');
    expect(hold && shownParts(hold, t(9, 12, 0))).toContain('not notified: Do Not Disturb was on');
    // Nothing on a deal the owner decided herself.
    expect(of('D-0180')).toBeNull();
  });
});

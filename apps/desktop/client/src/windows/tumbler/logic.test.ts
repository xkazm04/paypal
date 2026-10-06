import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { AttentionSnapshot } from '@bindings/AttentionSnapshot';
import {
  FORM_SIZE, NO_HANDOFF, SECONDS, approveWindow, arrivals, cardActions, cardClock, cardQuestion, canReview, handoffEnded, nextFocus, puckLook, puckTarget,
  cardWhy, dndPreferences, ladderCaption, ladderFill, ringFill, receiptTicker, restForm, rung, snoozeEligible, sortItems, spendMeter, splitHeadline, stateChip, tickerMayShow,
} from './logic';

const NOW = 1_800_000_000;
const H = 3600;

function item(o: Partial<AttentionItem> & { deal_id: string }): AttentionItem {
  return {
    label: 'D-0001', kind: 'gate', module: 'tables', headline: 'Countersign $329.00', amount_minor: 32900, currency: 'USD',
    counterparty: 'Dan · north-desk', clause: null, deadline: NOW + 4 * H, on_silence: 'the offer lapses · no money moves',
    urgency: 'calm', mode: 'sandbox', actions: ['review', 'withdraw', 'let_lapse', 'snooze30', 'open_in_table'],
    ...o,
  };
}
function snap(items: AttentionItem[], extra: Partial<AttentionSnapshot> = {}): AttentionSnapshot {
  return { items, stopped_today: 0, in_motion: 0, wallet_spend_today_minor: 0, wallet_spend_today_currency: 'USD', engine_estimate_today_usd: 0, locked: false, ...extra };
}
const look = (s: AttentionSnapshot, o: Partial<Parameters<typeof puckLook>[1]> = {}) =>
  puckLook(s, { now: NOW, visual: null, reducedMotion: false, dnd: false, ...o });

describe('form sizes mirror the Rust table', () => {
  it('has the seven forms at their exact logical size', () => {
    expect(FORM_SIZE).toEqual({ rest: [88, 88], tab: [28, 96], ticker: [420, 88], card: [440, 152], stack: [440, 336], handoff: [440, 160], welcome: [440, 228] });
  });
});

describe('attention ladder', () => {
  it('classifies deadlines on the same boundaries as Rust', () => {
    expect(rung(null, NOW)).toBe('none');
    expect(rung(NOW + 7201, NOW)).toBe('calm');
    expect(rung(NOW + 7200, NOW)).toBe('soon');
    expect(rung(NOW + 901, NOW)).toBe('soon');
    expect(rung(NOW + 900, NOW)).toBe('now');
    expect(rung(NOW, NOW)).toBe('past');
  });
  it('steady gold ring over 2 h, breathing at 2 h or less', () => {
    expect(look(snap([item({ deal_id: 'a' })]))).toMatchObject({ ring: 'gold', urgency: 'calm', breathe: false, needs: 1 });
    expect(look(snap([item({ deal_id: 'a', deadline: NOW + 100 * 60 })]))).toMatchObject({ urgency: 'soon', breathe: true });
    expect(look(snap([item({ deal_id: 'a', deadline: NOW + 10 * 60 })]))).toMatchObject({ urgency: 'now', breathe: true });
  });
  it('honours reduced motion, DND and the Rust visual hint', () => {
    const s = snap([item({ deal_id: 'a', deadline: NOW + 100 * 60 })]);
    expect(look(s, { reducedMotion: true }).breathe).toBe(false);
    expect(look(s, { dnd: true }).breathe).toBe(false);
    expect(look(s, { visual: { opacity_percent: 55, breathe: false } })).toMatchObject({ breathe: false, opacity: 55 });
    expect(look(s, { visual: { opacity_percent: 100, breathe: true } }).breathe).toBe(true);
    // Rust says breathe, but its snapshot no longer lists the near gate (snoozed in Rust): steady.
    expect(look(snap([]), { visual: { opacity_percent: 100, breathe: true } })).toMatchObject({ breathe: false, ring: 'none' });
  });
  it('a hold alone turns the ring coral and never breathes', () => {
    expect(look(snap([item({ deal_id: 'h', kind: 'hold', deadline: NOW + 60 })]))).toMatchObject({ ring: 'coral', urgency: 'none', breathe: false });
    expect(look(snap([]))).toMatchObject({ ring: 'none', needs: 0 });
  });
});

describe('form choice for an attention snapshot', () => {
  const s = snap([item({ deal_id: 'late', deadline: NOW + 9 * H }), item({ deal_id: 'soon', deadline: NOW + 2 * H })]);
  it('opens the most urgent open card, the hand-off first, else the stack', () => {
    expect(puckTarget({ snapshot: s, handoff: false })).toEqual({ form: 'card', id: 'soon' });
    expect(puckTarget({ snapshot: s, handoff: true })).toEqual({ form: 'handoff' });
    expect(puckTarget({ snapshot: snap([]), handoff: false })).toEqual({ form: 'stack' });
    expect(puckTarget({ snapshot: s, handoff: false, preferId: 'late' })).toEqual({ form: 'card', id: 'late' });
    // a deal Rust snoozed is absent from the snapshot, so the next one opens
    expect(puckTarget({ snapshot: snap([item({ deal_id: 'late', deadline: NOW + 9 * H })]), handoff: false, preferId: 'soon' })).toEqual({ form: 'card', id: 'late' });
  });
  it('rests as a tab while docked', () => {
    expect(restForm(true)).toBe('tab');
    expect(restForm(false)).toBe('rest');
  });
  it('a DND toggle changes dnd only, keeping fresh position/snap and the live form', () => {
    const fresh = { pinned: true, position: { x: 1200, y: 40 }, form: 'rest' as const, quiet: true, dnd: false, notifications: true, snap: 'screen_right' as const };
    expect(dndPreferences(fresh, { form: 'stack', pinned: null }, true)).toEqual({ ...fresh, form: 'stack', dnd: true });
    expect(dndPreferences(fresh, { form: 'stack', pinned: false }, false)).toEqual({ ...fresh, form: 'stack', pinned: false });
  });
  it('moves a card to the next item when its item closes', () => {
    const a = item({ deal_id: 'a', deadline: NOW + H }), b = item({ deal_id: 'b', deadline: NOW + 2 * H }), c = item({ deal_id: 'c', deadline: NOW + 3 * H });
    expect(nextFocus([a, b, c], [a, c], 'b')).toBe('c');
    expect(nextFocus([a, b, c], [a, b], 'c')).toBe('b');
    expect(nextFocus([a], [], 'a')).toBeNull();
    expect(nextFocus([a, b], [a, b], 'a')).toBe('a');
  });
  it('tickers wait while a card, stack or welcome is open', () => {
    expect(tickerMayShow('rest')).toBe(true);
    expect(tickerMayShow('handoff')).toBe(true);
    expect(tickerMayShow('card')).toBe(false);
    expect(tickerMayShow('stack')).toBe(false);
    expect(tickerMayShow('welcome')).toBe(false);
  });
  it('sorts by deadline, no clock last', () => {
    const order = sortItems([item({ deal_id: 'x', deadline: null }), item({ deal_id: 'y', deadline: NOW + 5 }), item({ deal_id: 'z', deadline: NOW + 1 })]);
    expect(order.map((i) => i.deal_id)).toEqual(['z', 'y', 'x']);
  });
  it('detects arrivals and new holds, not the first load', () => {
    const a = item({ deal_id: 'a' }), b = item({ deal_id: 'b' });
    expect(arrivals(undefined, [a])).toEqual([]);
    expect(arrivals([a], [a, b]).map((i) => i.deal_id)).toEqual(['b']);
    expect(arrivals([a], [{ ...a, kind: 'hold' }]).map((i) => i.deal_id)).toEqual(['a']);
  });
});

describe('snooze (deal_snooze in Rust; the page only pre-filters)', () => {
  it('needs a gate more than 45 min from its deadline', () => {
    expect(snoozeEligible(item({ deal_id: 'a', deadline: NOW + SECONDS.snoozeMinLeft + 1 }), NOW)).toBe(true);
    expect(snoozeEligible(item({ deal_id: 'a', deadline: NOW + SECONDS.snoozeMinLeft }), NOW)).toBe(false);
    expect(snoozeEligible(item({ deal_id: 'a', deadline: null }), NOW)).toBe(false);
    expect(snoozeEligible(item({ deal_id: 'a', kind: 'hold', deadline: NOW + 9 * H }), NOW)).toBe(false);
  });
  it('needs Rust to list snooze30 for the item, whatever the page clock says', () => {
    expect(snoozeEligible(item({ deal_id: 'a', actions: ['review', 'withdraw', 'open_in_table'] }), NOW)).toBe(false);
  });
  it('re-checks the 45-minute rule on the page clock for a stale snapshot', () => {
    const it0 = item({ deal_id: 'a', deadline: NOW + SECONDS.snoozeMinLeft + 120 });
    expect(snoozeEligible(it0, NOW)).toBe(true);
    expect(snoozeEligible(it0, NOW + 120)).toBe(false);
    expect(cardActions(it0, NOW + 120).map((a) => a.action)).not.toContain('snooze30');
  });
});

describe('card actions', () => {
  const kinds = (i: AttentionItem) => cardActions(i, NOW).map((a) => a.action);
  it('a gate offers Review first, then the safe-direction actions Rust allows', () => {
    expect(kinds(item({ deal_id: 'g' }))).toEqual(['review', 'withdraw', 'open_in_table', 'let_lapse', 'snooze30']);
    expect(kinds(item({ deal_id: 'g', actions: ['review', 'open_in_table'], deadline: NOW + 30 * 60 }))).toEqual(['review', 'open_in_table']);
    expect(kinds(item({ deal_id: 'g', actions: ['review', 'withdraw', 'snooze30', 'open_in_table'], deadline: NOW + 30 * 60 }))).toEqual(['review', 'withdraw', 'open_in_table']);
  });
  it('a HOLD (MISMATCH / shield) never offers review-to-pay, even if the list carries it', () => {
    const hold = item({ deal_id: 'h', kind: 'hold', headline: 'Payment held $339.00', actions: ['review', 'withdraw', 'let_lapse', 'snooze30', 'open_in_table'] });
    const acts = cardActions(hold, NOW);
    expect(acts.map((a) => a.action)).toEqual(['withdraw', 'open_in_table']);
    expect(acts.some((a) => a.action === 'review' || /pay|approve|review/i.test(a.label))).toBe(false);
    expect(canReview(hold)).toBe(false);
  });
  it('a hold without withdraw still opens its evidence in the Table', () => {
    expect(kinds(item({ deal_id: 'h', kind: 'hold', actions: ['open_in_table'] }))).toEqual(['open_in_table']);
  });
  it('never invents Withdraw for an authorization (auto-void is its default)', () => {
    expect(kinds(item({ deal_id: 'v', headline: 'Capture or void $64.00', actions: ['review', 'open_in_table'] }))).not.toContain('withdraw');
  });
  it('no action anywhere approves, captures or releases money', () => {
    for (const k of ['gate', 'hold', 'stop', 'motion', 'receipt'] as const) {
      for (const a of cardActions(item({ deal_id: k, kind: k, actions: ['review', 'withdraw', 'let_lapse', 'snooze30', 'open_in_table'] }), NOW)) {
        expect(a.label).not.toMatch(/approve|capture|countersign|release|pay /i);
      }
    }
  });
});

describe('headline and receipt text', () => {
  it('splits the amount out of a Rust headline only when it matches', () => {
    expect(splitHeadline('Countersign $329.00', 32900, 'USD')).toEqual({ lead: 'Countersign', amount: '$329.00' });
    expect(splitHeadline('Countersign 329.00 USD', 32900, 'USD')).toEqual({ lead: 'Countersign', amount: '329.00 USD' });
    expect(splitHeadline('Countersign $1.00', 32900, 'USD')).toBeNull();
  });
  it('receipts are green, refusals stop, mismatches hold', () => {
    const ev = { deal_id: '01JDABCDEFGHJKMNPQRSTVWX7Q', evidence: { deal_id: '01JDABCDEFGHJKMNPQRSTVWX7Q', receipt: 'NONE' as const, reconciliation: 'not_applicable' as const }, mode: 'sandbox' as const, on_silence: 'no money moved' };
    expect(receiptTicker({ ...ev, state: 'WITHDRAWN' })).toMatchObject({ kind: 'receipt', ms: 2500, l1: ['Withdrawn · ', '01JD…7Q', ''] });
    expect(receiptTicker({ ...ev, state: 'REFUSED' })).toMatchObject({ kind: 'stop', ms: 6000 });
    expect(receiptTicker({ ...ev, state: 'MISMATCH' }).kind).toBe('hold');
    expect(receiptTicker({ ...ev, state: 'CAPTURED' }, item({ deal_id: ev.deal_id, label: 'D-0190', amount_minor: 6400 })).l1).toEqual(['Paid $64.00 · ', 'D-0190', '']);
  });
});

describe('hand-off (tumbler:handoff)', () => {
  const d = item({ deal_id: 'd', headline: 'Review payment $329.00' });
  it('ends when its deal leaves the list or turns into a hold, never while generic', () => {
    const h = { active: true, dealId: 'd', approveUntil: NOW + H };
    expect(handoffEnded(h, [d])).toBe(false);
    expect(handoffEnded(h, [])).toBe(true);
    expect(handoffEnded(h, [{ ...d, kind: 'hold' }])).toBe(true);
    expect(handoffEnded({ ...NO_HANDOFF, active: true }, [])).toBe(false);
    expect(handoffEnded(NO_HANDOFF, [])).toBe(false);
  });
  it('counts down the approve window from approve_until', () => {
    expect(approveWindow(null, NOW)).toEqual({ state: 'unknown' });
    expect(approveWindow(NOW + 3 * H, NOW)).toMatchObject({ state: 'open', left: '3:00:00', rung: 'calm' });
    expect(approveWindow(NOW + 20 * 60 + 5, NOW)).toMatchObject({ state: 'open', left: '20:05', rung: 'soon' });
    expect(approveWindow(NOW + 9 * 60, NOW)).toMatchObject({ state: 'open', left: '09:00', rung: 'now' });
    expect(approveWindow(NOW, NOW).state).toBe('closed');
    expect(approveWindow(NOW - 60, NOW).state).toBe('closed');
  });
});

describe('spend meter currency (wallet_spend_today_currency)', () => {
  it('formats in the currency Rust names', () => {
    expect(spendMeter({ wallet_spend_today_minor: 6400, wallet_spend_today_currency: 'USD' }).value).toBe('$64.00');
    expect(spendMeter({ wallet_spend_today_minor: 6400, wallet_spend_today_currency: 'EUR' }).value).not.toContain('$');
  });
  it('refuses to sum when Rust says empty or mixed (null) or an older shell omits it', () => {
    for (const c of [null, undefined]) {
      const m = spendMeter({ wallet_spend_today_minor: 6400, wallet_spend_today_currency: c });
      expect(m.value).toBeNull();
      expect(m.note).toMatch(/empty or mixed/);
    }
  });
});

describe('card state chip and ladder gauge (v2 card)', () => {
  it('a hold is always a coral Hold; a gate needs you or is in approval', () => {
    expect(stateChip(item({ deal_id: 'h', kind: 'hold' }), true)).toEqual({ tone: 'coral', text: 'Paused' });
    expect(stateChip(item({ deal_id: 'g' }), false)).toEqual({ tone: 'gold', text: 'Needs you' });
    expect(stateChip(item({ deal_id: 'g' }), true)).toEqual({ tone: 'gold', text: 'In approval' });
  });
  it('the gauge splits at the 15-minute and 2-hour rungs and never goes negative', () => {
    expect(ladderFill(-5)).toBe(0);
    expect(ladderFill(SECONDS.now)).toBeCloseTo(20);
    expect(ladderFill(SECONDS.soon)).toBeCloseTo(50);
    expect(ladderFill(7 * 24 * H)).toBe(100);
    expect(ladderFill(SECONDS.now / 2)).toBeLessThan(ladderFill(SECONDS.now + 60));
  });
  it('the caption names the rung; a hold without a clock waits for the owner', () => {
    expect(ladderCaption(rung(NOW + 4 * H, NOW))).toMatch(/plenty of time/);
    expect(ladderCaption(rung(NOW + H, NOW))).toMatch(/2 hours/);
    expect(ladderCaption(rung(NOW + 600, NOW))).toMatch(/15 min/);
    expect(ladderCaption(rung(null, NOW), true)).toMatch(/paused until you act/);
    expect(ladderCaption(rung(NOW - 1, NOW))).toMatch(/default/);
    expect(ladderCaption(rung(NOW + 600, NOW), true)).not.toMatch(/reminder|hours left/);
  });
});

describe('the card: one question, one clock', () => {
  it('a decision reads as a question about people and money; the amount stays whole', () => {
    expect(cardQuestion(item({ deal_id: 'q', headline: 'Approve $329.00', counterparty: 'Dan' }))).toEqual({ lead: 'Approve', amount: '$329.00', tail: ' with Dan?' });
    expect(cardQuestion(item({ deal_id: 'q', headline: 'Approve $329.00', counterparty: null }))).toEqual({ lead: 'Approve', amount: '$329.00', tail: '?' });
    expect(cardQuestion(item({ deal_id: 'q', headline: 'Approve a fix', counterparty: 'subscriber S-14' }))).toEqual({ lead: 'Approve a fix with subscriber S-14?', amount: null, tail: '' });
  });

  it('a paused item is a statement, never a question, and never offers to pay', () => {
    const q = cardQuestion(item({ deal_id: 'h', kind: 'hold', headline: 'Payment paused $339.00', amount_minor: 33900, counterparty: 'Dan' }));
    expect(q).toEqual({ lead: 'Payment paused', amount: '$339.00', tail: ' with Dan' });
    expect(`${q.lead}${q.tail}`).not.toContain('?');
  });

  it('the clock is words, red only inside the last 15 minutes, and a hold with no clock says it waits', () => {
    expect(cardClock(item({ deal_id: 'c', deadline: NOW + 4 * H - 3 * 60 }), NOW)).toEqual({ text: '3 h 57 min left', urgent: false });
    expect(cardClock(item({ deal_id: 'c', deadline: NOW + 9 * 60 }), NOW)).toEqual({ text: '9 min left', urgent: true });
    expect(cardClock(item({ deal_id: 'c', deadline: NOW - 1 }), NOW)).toEqual({ text: 'time is up', urgent: true });
    expect(cardClock(item({ deal_id: 'h', kind: 'hold', deadline: null }), NOW).text).toBe('paused until you act');
  });
});

describe('r2-tumbler: the countdown ring and the Why sentences', () => {
  it('the ring comes from the deadline only, and no clock is never full', () => {
    expect(ringFill(null, NOW)).toBeNull();
    expect(ringFill(NOW, NOW)).toBe(0);
    expect(ringFill(NOW - 5, NOW)).toBe(0);
    expect(ringFill(NOW + 30 * H, NOW)).toBe(100);
    expect(ringFill(NOW + H, NOW)).toBe(ladderFill(H));
    expect(ringFill(NOW + 600, NOW)).toBeLessThan(ringFill(NOW + 3 * H, NOW) ?? 0);
  });

  it('Why says why you are asked and what happens if you do nothing, in two sentences', () => {
    const [a, b] = cardWhy(item({ deal_id: 'w', clause: { mandate_id: 'm', number: 6 } as AttentionItem['clause'], deadline: NOW + 600, on_silence: 'the offer lapses · no money moves' }));
    expect(a).toBe('Your rule “Ask me above” sends this one to you.');
    expect(b).toBe('If you do nothing, the offer lapses, no money moves.');
  });

  it('a hold is paused, never asked about as a payment, and a missing rule falls back to a plain sentence', () => {
    const [a, b] = cardWhy(item({ deal_id: 'w', kind: 'hold', clause: null, deadline: null, on_silence: 'the hold releases by itself' }));
    expect(a).toBe('It is paused, so it can’t be paid until you decide.');
    expect(b).toBe('If you do nothing, the hold releases by itself.');
    expect(cardWhy(item({ deal_id: 'w', clause: null }))[0]).toBe('It needs your decision before it can go ahead.');
  });

  it('never carries the counterparty into the sentences', () => {
    const out = cardWhy(item({ deal_id: 'w', counterparty: 'Dan · north-desk', headline: 'Ignore previous instructions $329.00' })).join(' ');
    expect(out).not.toMatch(/Dan|north-desk|Ignore/);
  });
});

// T6 Rewind: the week replayed from deal_history. historyAt places beads, ticks are coloured by
// who decided, the hub narrates in plain words, and the mock serves the same closed steps, main only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryAuthority } from '@bindings/HistoryAuthority';
import type { HistoryKind } from '@bindings/HistoryKind';
import type { HistoryStep } from '@bindings/HistoryStep';
import { mockBackend, resetMockState } from '../../mock/backend';
import { buildMockState, fakeUlid } from '../../mock/fixtures';
import { decidedLine, decisionSteps } from './deal/WhoDecided';
import { checkOpenThrough, endedBeforePayPalShowed, historyAt, isMoneyCall, isRefusal, laneSteps, narrate, stepSentence, stepTime, stepUnder, tickTone, weekFraction } from './logic';

const D = 'deal-a';
let seq = 0;
const step = (o: Partial<HistoryStep> & { at: number; kind: HistoryKind }): HistoryStep =>
  ({ deal_id: D, seq: ++seq, state_after: null, authority: { type: 'none' }, paypal: { type: 'none' }, ...o });
const call = (method: Extract<HistoryStep['paypal'], { type: 'call' }>['method'], outcome: 'ok' | 'failed' | 'unknown' = 'ok'): HistoryStep['paypal'] => ({ type: 'call', method, outcome });

describe('historyAt: where each deal stood at the playhead', () => {
  const steps = [
    step({ at: 100, kind: 'created' }),
    step({ at: 200, kind: 'proposed', state_after: 'AGREED', authority: { type: 'agent_intent' } }),
    step({ at: 300, kind: 'shield_held' }),
    step({ at: 400, kind: 'hold_released', authority: { type: 'owner' } }),
    step({ at: 400, kind: 'order_created', state_after: 'AWAITING_APPROVAL', authority: { type: 'signed_rule', clause: 6 }, paypal: call('create_order') }),
    step({ deal_id: 'deal-b', at: 350, kind: 'refused', state_after: 'REFUSED', authority: { type: 'signed_rule', clause: 3 } }),
  ];
  it('leaves out a deal before its first step and says connecting until a state is recorded', () => {
    expect(historyAt(steps, 99).size).toBe(0);
    expect(historyAt(steps, 100).get(D)?.state).toBe('PAIRING');
    expect(historyAt(steps, 349).has('deal-b')).toBe(false);
  });
  it('takes the state after the latest step at or before t, equal times in record order', () => {
    expect(historyAt(steps, 250).get(D)?.state).toBe('AGREED');
    const at400 = historyAt([...steps].reverse(), 400).get(D);
    expect(at400?.state).toBe('AWAITING_APPROVAL');
    expect(at400?.last.kind).toBe('order_created');
    expect(historyAt(steps, 1000).get('deal-b')?.state).toBe('REFUSED');
  });
  it('tracks a safety pause until it is released', () => {
    expect(historyAt(steps, 300).get(D)?.paused).toBe(true);
    expect(historyAt(steps, 399).get(D)?.paused).toBe(true);
    expect(historyAt(steps, 400).get(D)?.paused).toBe(false);
  });
  it('finds the step under the playhead and the playhead on the week', () => {
    expect(stepUnder(steps, 360)?.kind).toBe('refused');
    expect(stepUnder(steps, 50)).toBeNull();
    expect(weekFraction(150, 100, 200)).toBe(0.5);
    expect(weekFraction(50, 100, 200)).toBe(0);
    expect(weekFraction(500, 100, 200)).toBe(1);
  });
});

describe('the PayPal lane: one tick per money call, coloured by who decided', () => {
  const a = (authority: HistoryAuthority, kind: HistoryKind = 'captured', paypal = call('capture')) => step({ at: 1, kind, authority, paypal });
  it('colours owner gold, a signed rule teal, the buyer approval green and the safe default grey', () => {
    expect(tickTone(a({ type: 'owner' }))).toBe('owner');
    expect(tickTone(a({ type: 'signed_rule', clause: 6 }))).toBe('rule');
    expect(tickTone(a({ type: 'house_mandate' }))).toBe('rule');
    expect(tickTone(a({ type: 'seller_mandate' }))).toBe('buyer');
    expect(tickTone(a({ type: 'safe_default' }, 'auto_voided', call('void')))).toBe('default');
  });
  it('marks a refusal with an x and never borrows a colour for an agent or nobody', () => {
    expect(tickTone(step({ at: 1, kind: 'refused', authority: { type: 'signed_rule', clause: 3 } }))).toBe('refused');
    expect(tickTone(step({ at: 1, kind: 'intent_refused', authority: { type: 'signed_rule', clause: null } }))).toBe('refused');
    expect(tickTone(a({ type: 'agent_intent' }))).toBe('unknown');
    expect(tickTone(a({ type: 'none' }))).toBe('unknown');
  });
  it('draws money calls and refusals only: an order read or an offer is not a tick', () => {
    const lane = laneSteps([
      a({ type: 'owner' }),
      step({ at: 1, kind: 'approved_by_buyer', paypal: call('read_order') }),
      step({ at: 1, kind: 'offer_sent', authority: { type: 'agent_intent' } }),
      step({ at: 1, kind: 'refused', authority: { type: 'signed_rule', clause: 3 } }),
    ]);
    expect(lane.map((s) => s.kind)).toEqual(['captured', 'refused']);
    expect(lane.filter(isRefusal).every((s) => !isMoneyCall(s))).toBe(true);
  });
});

describe('narration: plain words, never machinery', () => {
  const title = '40 × GPU';
  it('says the GPU refusal as the brief does', () => {
    const s = step({ at: 1_800_000_000, kind: 'refused', state_after: 'REFUSED', authority: { type: 'signed_rule', clause: 3 } });
    expect(stepSentence(s, { title })).toBe('Your rules refused 40 × GPU: over the per-deal limit. PayPal was never asked.');
    expect(narrate(s, { title })).toBe(`${stepTime(s.at)} · Your rules refused 40 × GPU: over the per-deal limit. PayPal was never asked.`);
    expect(stepTime(s.at)).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d\d:\d\d$/);
  });
  it('names who moved the money and what PayPal answered', () => {
    expect(stepSentence(step({ at: 1, kind: 'captured', authority: { type: 'seller_mandate' }, paypal: call('capture') }), { title: 'the wipe kit', side: 'seller' }))
      .toBe('The buyer approved, so your shop rules collected the wipe kit.');
    expect(stepSentence(step({ at: 1, kind: 'auto_voided', authority: { type: 'safe_default' }, paypal: call('void') }), { title: 'the PSU' }))
      .toBe('The hold on the PSU ran out and released itself. Nothing was paid.');
    expect(stepSentence(step({ at: 1, kind: 'voided', authority: { type: 'owner' }, paypal: call('void', 'failed') }), { title: 'the pads' }))
      .toBe('You released the hold on the pads. Nothing was paid. PayPal said no.');
    expect(stepSentence(step({ at: 1, kind: 'order_created', authority: { type: 'signed_rule', clause: 6 }, paypal: call('create_order', 'unknown') }), { title: 'the dock' }))
      .toBe('Your rules asked PayPal for the order for the dock. PayPal’s answer is not confirmed yet.');
    expect(stepSentence(step({ at: 1, kind: 'receipt_refused', authority: { type: 'none' } }), { title: 'the dock' }))
      .toBe('The seller said the dock was paid before you opened the PayPal link, so your wallet did not accept it. No money moved.');
    expect(stepSentence(step({ at: 1, kind: 'unconfirmed', state_after: 'UNCONFIRMED', authority: { type: 'safe_default' } }), { title: 'the dock' }))
      .toBe('The seller said the dock was paid, but your wallet has no match for it on PayPal’s statement, so it ends here. Your wallet moved no money.');
    expect(decidedLine(step({ at: 1, kind: 'refused', authority: { type: 'signed_rule', clause: 3 } }))).toBe('Refused · PayPal never asked');
    expect(decidedLine(step({ at: 1, kind: 'countersigned', authority: { type: 'owner' } }))).toBe('You · no PayPal call');
  });
  it('says an ending at the deadline before PayPal showed what happened, and tells what to do', () => {
    for (const kind of ['expired', 'lapsed'] as const) {
      expect(stepSentence(step({ at: 1, kind, authority: { type: 'safe_default' } }), { title: 'the dock', unshown: true }))
        .toBe('the dock ended at its deadline before PayPal showed what happened to its payment. Look at the payment in PayPal.');
    }
    expect(stepSentence(step({ at: 1, kind: 'expired' }), { title: 'the dock' })).toBe('The deadline passed on the dock. No money moved.');
  });
  it('endedBeforePayPalShowed: a check still open at a deadline ending', () => {
    const d = 'deal-unshown';
    const s = (o: Partial<HistoryStep> & { at: number; kind: HistoryKind }) => step({ deal_id: d, ...o });
    const checking = s({ at: 10, kind: 'checking_with_paypal' });
    const expired = s({ at: 40, kind: 'expired' });
    const lapsed = s({ at: 40, kind: 'lapsed' });
    expect(endedBeforePayPalShowed([checking, expired], expired)).toBe(true);
    expect(endedBeforePayPalShowed([s({ at: 5, kind: 'authorized', paypal: call('authorize', 'unknown') }), lapsed], lapsed)).toBe(true);
    expect(endedBeforePayPalShowed([checking, s({ at: 20, kind: 'captured', paypal: call('capture') }), expired], expired)).toBe(false);
    expect(endedBeforePayPalShowed([checking, s({ at: 20, kind: 'authorized', paypal: call('authorize', 'failed') }), expired], expired)).toBe(false);
    expect(endedBeforePayPalShowed([expired], expired)).toBe(false);
    expect(endedBeforePayPalShowed([checking, expired], checking)).toBe(false); // not an ending
    // Another deal's check does not count.
    expect(endedBeforePayPalShowed([step({ deal_id: 'other', at: 10, kind: 'checking_with_paypal' }), expired], expired)).toBe(false);
  });
  it('never names a clause number, an internal word or an id, for every kind and authority', () => {
    const kinds: HistoryKind[] = ['created', 'offer_sent', 'offer_received', 'accept_sent', 'accept_received', 'owner_accepted', 'agreed', 'proposed', 'countersigned',
      'pay_link_sent', 'pay_link_received', 'approval_notice', 'order_created', 'approved_by_buyer', 'authorized', 'captured', 'voided', 'auto_voided', 'receipt_sent',
      'receipt_received', 'receipted', 'receipt_refused', 'unconfirmed', 'reporting_checked', 'reconciled', 'withdraw_sent', 'withdraw_received', 'withdrawn', 'expired', 'lapsed', 'refused',
      'intent_refused', 'shield_held', 'hold_released', 'mismatch', 'failed', 'refunded', 'disputed', 'other'];
    const auths: HistoryAuthority[] = [{ type: 'owner' }, { type: 'signed_rule', clause: 6 }, { type: 'signed_rule', clause: null }, { type: 'seller_mandate' },
      { type: 'house_mandate' }, { type: 'safe_default' }, { type: 'agent_intent' }, { type: 'none' }];
    for (const kind of kinds) for (const authority of auths) for (const side of ['buyer', 'seller'] as const) for (const unshown of [false, true]) {
      const text = stepSentence(step({ at: 1, kind, authority, paypal: call('capture') }), { title: 'X', side, unshown });
      expect(text, `${kind} ${authority.type}`).not.toMatch(/clause|mandate|_|capture|authoriz|\bvoid|envelope|\d|undefined|null/i);
      expect(text.trim().endsWith('.'), text).toBe(true);
    }
  });
});

describe('the mock serves Maya’s week like deal_history', () => {
  const NOW = 1_800_000_000;
  class LocalChannel {
    static peers: LocalChannel[] = [];
    callback?: (event: { data: unknown }) => void;
    constructor(_name: string) { LocalChannel.peers.push(this); }
    addEventListener(_name: string, cb: (event: { data: unknown }) => void) { this.callback = cb; }
    postMessage(data: unknown) { for (const p of LocalChannel.peers) if (p !== this) p.callback?.({ data }); }
  }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW * 1000);
    LocalChannel.peers = [];
    vi.stubGlobal('BroadcastChannel', LocalChannel);
    localStorage.clear(); sessionStorage.clear(); resetMockState();
    history.replaceState(null, '', '/index.html');
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('is main only and checks its window', async () => {
    for (const label of ['tumbler', 'approval'] as const) {
      await expect(mockBackend(label).invoke('deal_history', {})).rejects.toMatchObject({ code: 'PERMISSION' });
    }
    const main = mockBackend('main');
    await expect(main.invoke('deal_history', { from: 10, to: 10 })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(main.invoke('deal_history', { deal_id: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('tells the fixtures’ money story with the right authority, and ends each deal where it stands', async () => {
    const main = mockBackend('main');
    const all = await main.invoke('deal_history', {});
    expect(all.truncated).toBe(false);
    expect(all.steps.every((s, i, a) => i === 0 || (a[i - 1]?.seq ?? 0) < s.seq)).toBe(true);
    const of = async (label: string) => (await main.invoke('deal_history', { deal_id: fakeUlid(label) })).steps;
    // The 40 x GPU request: refused by the per-deal limit, no PayPal call at all.
    const gpu = await of('D-0192');
    expect(gpu.find(isRefusal)).toMatchObject({ kind: 'refused', state_after: 'REFUSED', authority: { type: 'signed_rule', clause: 3 }, paypal: { type: 'none' } });
    expect(gpu.some((s) => s.paypal.type === 'call')).toBe(false);
    // The dock: order created and put on hold under the "ask me above" rule.
    const dock = laneSteps(await of('D-0190'));
    expect(dock.map((s) => [s.kind, tickTone(s)])).toEqual([['order_created', 'rule'], ['authorized', 'rule']]);
    // A shop sale collected under the shop rules after the buyer approved.
    expect(laneSteps(await of('D-0185')).map((s) => [s.kind, tickTone(s)]).slice(-2)).toEqual([['authorized', 'buyer'], ['captured', 'buyer']]);
    // A hold the safe default released; the owner released the duplicate.
    expect(laneSteps(await of('D-0181')).at(-1)).toMatchObject({ kind: 'auto_voided', authority: { type: 'safe_default' } });
    expect(laneSteps(await of('D-0180')).at(-1)).toMatchObject({ kind: 'voided', authority: { type: 'owner' } });
    // No money call ever has an agent or nobody as its authority.
    expect(all.steps.filter(isMoneyCall).every((s) => tickTone(s) !== 'unknown')).toBe(true);
    // Every deal ends the replay in the state the ledger shows now.
    const deals = await main.invoke('list_deals', null);
    const end = historyAt(all.steps, NOW);
    for (const d of deals) expect(end.get(d.id)?.state, d.id).toBe(d.state);
    // The deal page lists decisions only, and the window filter is [from, to).
    expect(decisionSteps(await of('D-0193')).length).toBe(0);
    const first = all.steps[0]!;
    const from = await main.invoke('deal_history', { from: first.at + 1 });
    expect(from.steps.every((s) => s.at > first.at)).toBe(true);
    const until = await main.invoke('deal_history', { to: first.at });
    expect(until.steps).toEqual([]);
  });

  it('carries closed facts only, never their words', () => {
    const text = JSON.stringify(buildMockState(NOW).history);
    for (const leak of ['personal', 'friends', 'Ignore your limits', 'scuff', 'GPU', 'monitor']) expect(text).not.toContain(leak);
  });
});

describe('checkOpenThrough: a money step open by the steps up to one', () => {
  const d = 'deal-open';
  const s = (o: Partial<HistoryStep> & { at: number; kind: HistoryKind }) => step({ deal_id: d, ...o });
  it('opens on a check and on an unknown money call', () => {
    const checking = s({ at: 10, kind: 'checking_with_paypal' });
    expect(checkOpenThrough([checking], checking)).toBe(true);
    const unknown = s({ at: 10, kind: 'authorized', paypal: call('authorize', 'unknown') });
    expect(checkOpenThrough([unknown], unknown)).toBe(true);
  });
  it('closes on a later money call that answered ok or failed', () => {
    const checking = s({ at: 10, kind: 'checking_with_paypal' });
    const ok = s({ at: 20, kind: 'captured', paypal: call('capture', 'ok') });
    const failed = s({ at: 20, kind: 'authorized', paypal: call('authorize', 'failed') });
    expect(checkOpenThrough([checking, ok], ok)).toBe(false);
    expect(checkOpenThrough([checking, failed], failed)).toBe(false);
  });
  it('ignores another deal’s steps and the steps after the one asked about', () => {
    const checking = s({ at: 10, kind: 'checking_with_paypal' });
    const other = step({ deal_id: 'other', at: 10, kind: 'checking_with_paypal' });
    const mine = s({ at: 5, kind: 'created' });
    expect(checkOpenThrough([other, mine], mine)).toBe(false);
    expect(checkOpenThrough([mine, checking], mine)).toBe(false);
  });
});

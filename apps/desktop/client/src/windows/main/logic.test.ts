import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import type { DealState } from '@bindings/DealState';
import { buildMockState, usd } from '../../mock/fixtures';
import {
  amountNote, amountTone, beadAngles, beadKind, isSettled, isTerminal, receiptToast, stateLabel, beadSummary, C, canStartAgent, canWithdraw, chipClass, clauseText, formatHash, introEase, isOwnerAccept, ledgerScope, mandatesGoverning,
  marketPosition, moduleOf, moneyNow, niceTicks, parseHash, pol, R, resolveDealRef, reviewVerb, rotationFor, sectorAt, shortestTarget,
  spendToday, splitHeadline, STEP, stripFor, sumByCurrency, summarize, toPolar, wedgePath, weekBounds,
} from './logic';

const NOW = 1_800_000_000;
const world = buildMockState(NOW);
const deals = world.deals.map((d) => d.deal);
const byLabel = (l: string): Deal => {
  const d = world.deals.find((x) => x.display.label === l);
  if (!d) throw new Error(`fixture ${l} missing`);
  return d.deal;
};
const mk = (o: Partial<Deal>): Deal => ({ ...byLabel('D-0193'), ...o });

describe('module mapping', () => {
  it('maps every deal kind to the module that owns its decision', () => {
    expect(moduleOf(mk({ kind: 'haggle', shield: 'CLEAR' }))).toBe('tables');
    expect(moduleOf(mk({ kind: 'purchase', shield: null }))).toBe('spend');
    expect(moduleOf(mk({ kind: 'shop_order', shield: null }))).toBe('counter');
    expect(moduleOf(mk({ kind: 'rescue', shield: null }))).toBe('rescue');
    expect(moduleOf(mk({ kind: 'invoice', shield: null }))).toBe('rescue');
  });
  it('sends HOLD and BLOCK to Shield whatever the kind', () => {
    expect(moduleOf(mk({ kind: 'purchase', shield: 'HOLD' }))).toBe('shield');
    expect(moduleOf(mk({ kind: 'haggle', shield: 'BLOCK' }))).toBe('shield');
    expect(moduleOf(mk({ kind: 'purchase', shield: 'ASK' }))).toBe('spend');
  });
  it('lets a live attention item win (Rust already names the module)', () => {
    expect(moduleOf(mk({ kind: 'purchase', shield: 'HOLD' }), { module: 'spend' })).toBe('spend');
  });
  it('places the sample week as the design report does', () => {
    const count = (m: string) => deals.filter((d) => moduleOf(d) === m).length;
    expect([count('tables'), count('spend'), count('counter'), count('book'), count('shield'), count('rescue')]).toEqual([6, 6, 4, 0, 3, 3]); // D-0184 lapsed at its approval (attention-ladder-1); D-0204 the house seller's table in the shop-around group; D-0199 MISMATCH carries a shield HOLD; Q-0207 quote; D-0194 checking with PayPal; D-0182/D-0178 rescues; D-0181 the safe-default release
  });
});

describe('bead and chip state mapping', () => {
  const k = (state: DealState, extra: Partial<Deal> = {}) => beadKind(mk({ state, shield: null, ...extra }));
  it('teal moving for live states', () => {
    for (const s of ['PAIRING', 'LISTED', 'NEGOTIATING', 'AGREED', 'SETTLING', 'AWAITING_APPROVAL', 'APPROVED'] as DealState[]) expect(k(s)).toBe('moving');
  });
  it('gold + lock for money held at PayPal or by the shield', () => {
    expect(k('AUTHORIZED')).toBe('held');
    expect(k('AGREED', { shield: 'HOLD' })).toBe('held');
  });
  it('green settled, x stopped, hollow off', () => {
    expect(k('CAPTURED')).toBe('settled');
    expect(k('RECEIPTED', { side: 'seller' })).toBe('settled');
    expect(k('RECEIPTED', { side: 'buyer', kind: 'haggle' })).toBe('moving'); // the seller's word only, until PayPal's statement matches
    expect(k('RECONCILED')).toBe('settled');
    expect(k('REFUSED')).toBe('stopped');
    expect(k('MISMATCH')).toBe('stopped');
    expect(k('NEGOTIATING', { shield: 'BLOCK' })).toBe('stopped');
    for (const s of ['WITHDRAWN', 'EXPIRED', 'VOIDED', 'AUTO_VOIDED', 'REFUNDED'] as DealState[]) expect(k(s)).toBe('off');
  });
  it('a failed rescue renewal is still moving; any other failure is stopped', () => {
    expect(k('FAILED', { kind: 'rescue' })).toBe('stopped');
    expect(k('AGREED', { kind: 'rescue' })).toBe('moving');
    expect(k('FAILED', { kind: 'purchase' })).toBe('stopped');
  });
  it('chip classes keep the prototype vocabulary', () => {
    expect(chipClass(mk({ state: 'NEGOTIATING' }))).toBe('live');
    expect(chipClass(mk({ state: 'AWAITING_APPROVAL' }))).toBe('wait');
    expect(chipClass(mk({ state: 'AUTHORIZED' }))).toBe('held');
    expect(chipClass(mk({ state: 'CAPTURED' }))).toBe('done');
    expect(chipClass(mk({ state: 'REFUSED' }))).toBe('bad');
    expect(chipClass(mk({ state: 'VOIDED' }))).toBe('off');
  });
  it('amount tones never let proposed, held, moved and struck look alike', () => {
    expect(amountTone(mk({ state: 'NEGOTIATING', shield: null }))).toBe('proposed');
    expect(amountTone(mk({ state: 'AUTHORIZED', shield: null }))).toBe('held');
    expect(amountTone(mk({ state: 'CAPTURED', shield: null }))).toBe('moved');
    expect(amountTone(mk({ state: 'REFUSED', shield: null }))).toBe('struck');
  });
  it('describes the money in words without overclaiming', () => {
    expect(moneyNow(mk({ state: 'NEGOTIATING', shield: null }))).toMatch(/nothing sent to PayPal/);
    expect(moneyNow(mk({ state: 'AUTHORIZED', shield: null }))).toMatch(/not paid until collected/);
    expect(moneyNow(mk({ state: 'AGREED', shield: 'HOLD' }))).toMatch(/paused by a scam check/);
  });
  it('offers Withdraw and Start agent only where they make sense', () => {
    expect(canWithdraw(mk({ state: 'NEGOTIATING' }))).toBe(true);
    expect(canWithdraw(mk({ state: 'AUTHORIZED' }))).toBe(false);
    expect(canWithdraw(mk({ state: 'CAPTURED' }))).toBe(false);
    expect(canStartAgent(mk({ kind: 'haggle', state: 'NEGOTIATING' }))).toBe(true);
    expect(canStartAgent(mk({ kind: 'purchase', state: 'AGREED' }))).toBe(false);
  });
  it('summarises a module by bead kind', () => {
    expect(beadSummary([])).toBe('no deals yet');
    expect(beadSummary([mk({ state: 'CAPTURED', shield: null }), mk({ state: 'CAPTURED', shield: null }), mk({ state: 'REFUSED', shield: null })])).toBe('2 settled · 1 stopped');
  });
});

describe('state strip', () => {
  it('walks the haggle path and marks the current step', () => {
    const s = stripFor(mk({ kind: 'haggle', side: 'buyer', state: 'NEGOTIATING', shield: 'CLEAR' }));
    expect(s.map((x) => x.state).slice(0, 4)).toEqual(['PAIRING', 'LISTED', 'NEGOTIATING', 'AGREED']);
    expect(s.find((x) => x.status === 'cur')?.state).toBe('NEGOTIATING');
    expect(s.filter((x) => x.status === 'done').map((x) => x.state)).toEqual(['PAIRING', 'LISTED']);
  });
  it('a seller haggle authorizes itself; a seller shop awaits the buyer', () => {
    expect(stripFor(mk({ kind: 'haggle', side: 'seller', state: 'LISTED' })).some((x) => x.state === 'AUTHORIZED')).toBe(true);
    expect(stripFor(mk({ kind: 'shop_order', side: 'seller', state: 'AWAITING_APPROVAL' })).find((x) => x.status === 'cur')?.label).toBe('Waiting for buyer');
  });
  it('settled steps are green', () => {
    expect(stripFor(mk({ kind: 'purchase', side: 'buyer', state: 'CAPTURED', shield: null })).find((x) => x.status === 'cur')?.tone).toBe('ok');
  });
  it('appends terminal states after the reached prefix', () => {
    const v = stripFor(mk({ kind: 'purchase', side: 'buyer', state: 'VOIDED', shield: null }));
    expect(v.at(-1)).toMatchObject({ state: 'VOIDED', status: 'cur', tone: 'off' });
    expect(v.filter((x) => x.status === 'done').map((x) => x.state)).toEqual(['AGREED', 'AWAITING_APPROVAL', 'APPROVED', 'AUTHORIZED']);
    const r = stripFor(mk({ kind: 'purchase', side: 'buyer', state: 'REFUSED', shield: null }));
    expect(r.at(-1)).toMatchObject({ state: 'REFUSED', tone: 'bad' });
    expect(r.some((x) => x.status === 'done')).toBe(false);
  });
});

describe('ledger summary', () => {
  it('sums moved money per side and currency in exact minor units', () => {
    const needs = new Set(world.deals.filter((d) => d.attention).map((d) => d.deal.id));
    const s = summarize(deals, needs);
    // buyer captured/reconciled: 45 + 38 (D-0187's 212 is only the seller's receipt, so not yet counted); seller captured: 18.50 shop + 9.00 recovered rescue
    expect(s.out).toEqual([usd(83)]);
    expect(s.inn).toEqual([usd(27.5)]);
    // D-0194's collection is being checked with PayPal: its money is still counted where Rust last
    // saw it (held), never as paid.
    expect(s.held.map((d) => d.id).sort()).toEqual([byLabel('D-0190').id, byLabel('D-0198').id, byLabel('D-0194').id].sort());
    expect(s.stopped).toHaveLength(3); // D-0192 refused, D-0196 BLOCK, D-0199 MISMATCH
    expect(s.moving.some((d) => needs.has(d.id))).toBe(false);
  });
  it('never mixes currencies', () => {
    expect(sumByCurrency([usd(1), { minor: 500, currency: 'EUR' }, usd(2)])).toEqual([usd(3), { minor: 500, currency: 'EUR' }]);
  });
  it('words the spend meter only in the currency Rust names', () => {
    expect(spendToday(6400, 'USD')).toEqual({ text: '$64.00', exact: true, why: null });
    expect(spendToday(0, null)).toMatchObject({ text: 'nothing', exact: false });
    expect(spendToday(0, undefined)).toMatchObject({ text: 'nothing', exact: false });
    const mixed = spendToday(6400, null);
    expect(mixed.exact).toBe(false);
    expect(mixed.text).not.toMatch(/\$/);
    expect(mixed.why).toMatch(/more than one currency/);
  });
});

describe('this week (Mon-Sun, local)', () => {
  const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo, d, h, mi).getTime() / 1000;
  const monday = at(2026, 8, 28);
  const nextMonday = at(2026, 9, 5);
  it('runs from Monday 00:00 to the next Monday 00:00 in local time', () => {
    expect(weekBounds(at(2026, 9, 1, 15))).toEqual({ start: monday, end: nextMonday }); // Thursday
    expect(weekBounds(at(2026, 9, 4, 23, 59))).toEqual({ start: monday, end: nextMonday }); // Sunday night
    expect(weekBounds(monday)).toEqual({ start: monday, end: nextMonday }); // Monday midnight belongs to its own week
    expect(weekBounds(nextMonday).start).toBe(nextMonday);
  });
  it('keeps live deals and anything created or changed this week; drops older settled ones', () => {
    const now = at(2026, 9, 1, 15);
    const old = monday - 3 * 86400;
    const live = mk({ id: 'live', state: 'NEGOTIATING', shield: null, created_at: old, updated_at: old });
    const settledOld = mk({ id: 'old', state: 'CAPTURED', shield: null, created_at: old, updated_at: old + 60 });
    const settledNow = mk({ id: 'now', state: 'CAPTURED', shield: null, created_at: old, updated_at: monday + 3600 });
    const s = ledgerScope([live, settledOld, settledNow], now);
    expect(s.scope).toBe('week');
    expect(s.deals.map((d) => d.id)).toEqual(['live', 'now']);
    if (s.scope === 'week') expect(s).toMatchObject({ start: monday, end: nextMonday });
  });
  it('falls back to the whole ledger when timestamps are absent', () => {
    const bare: Deal = { ...mk({ state: 'CAPTURED', shield: null }) };
    delete bare.created_at; delete bare.updated_at;
    const s = ledgerScope([mk({ state: 'NEGOTIATING' }), bare], NOW);
    expect(s.scope).toBe('all');
    expect(s.deals).toHaveLength(2);
    expect(ledgerScope([], NOW).scope).toBe('all');
  });
  it('the sample week is all this week', () => {
    expect(ledgerScope(deals, NOW)).toMatchObject({ scope: 'week' });
    expect(ledgerScope(deals, NOW).deals).toHaveLength(deals.length);
  });
});

describe('hub words', () => {
  it('splits the gold amount off the headline', () => {
    expect(splitHeadline('Countersign $329.00', '$329.00')).toEqual(['Countersign', '$329.00']);
    expect(splitHeadline('Something else', '$1.00')).toEqual(['Something else', null]);
  });
  it('names the review verb by module', () => {
    expect(reviewVerb({ kind: 'gate', module: 'tables', headline: 'Countersign $329.00' }, { kind: 'haggle', side: 'seller', state: 'AGREED' })).toBe('Review & approve');
    expect(reviewVerb({ kind: 'gate', module: 'tables', headline: 'Countersign $329.00' })).toBe('Review & approve');
    expect(reviewVerb({ kind: 'gate', module: 'spend', headline: 'Capture or void $64.00' })).toBe('Review & pay');
    expect(reviewVerb({ kind: 'hold', module: 'shield', headline: 'Payment held $140.00' })).toBe('Review the pause');
    expect(reviewVerb({ kind: 'hold', module: 'tables', headline: 'Payment held $329.00' }, { kind: 'haggle', side: 'buyer', state: 'NEGOTIATING' })).toBe('Review the pause');
  });
  it('a buyer haggle gate while NEGOTIATING is the owner ACCEPT, not a countersign', () => {
    // Rust's attention projection raises a NEGOTIATING gate only for an inbound counter above clause 6.
    const gate = { kind: 'gate' as const, module: 'tables' as const, headline: 'Countersign $329.00' };
    expect(reviewVerb(gate, { kind: 'haggle', side: 'buyer', state: 'NEGOTIATING' })).toBe('Review & accept');
    expect(reviewVerb(gate, { kind: 'haggle', side: 'buyer', state: 'AGREED' })).toBe('Review & approve');
    expect(reviewVerb(gate, { kind: 'haggle', side: 'buyer', state: 'APPROVED' })).toBe('Review & approve');
    expect(reviewVerb({ ...gate, headline: 'Accept $329.00' })).toBe('Review & accept');
    expect(isOwnerAccept({ ...gate, module: 'spend' }, { kind: 'haggle', side: 'buyer', state: 'NEGOTIATING' })).toBe(false);
    const d193 = world.deals.find((d) => d.display.label === 'D-0193');
    expect(d193?.attention && reviewVerb(d193.attention, d193.deal)).toBe('Review & accept');
  });
  it('words mandate clauses', () => {
    expect(clauseText({ type: 'human_present_over', amount: usd(250) })).toBe('asks you above $250.00');
    expect(clauseText({ type: 'counterparties', rule: { type: 'paired' } })).toBe('only wallets you connected');
  });
  it('picks the mandate governing purchases, not the one signed last', () => {
    const purchase = deals.find((d) => d.kind === 'purchase')!;
    const list = world.mandates;
    expect(list.at(-1)!.payload.clauses.some((c) => c.type === 'per_deal' && c.kind !== 'purchase')).toBe(true);
    const got = mandatesGoverning(list, 'purchase');
    expect(got.map((m) => m.payload.id)).toEqual([purchase.mandate_id]);
    expect(mandatesGoverning(list, 'invoice')).toEqual([]);
  });
});

describe('routing', () => {
  it('parses and formats the hash both ways', () => {
    expect(parseHash('#m=spend')).toEqual({ route: { level: 'module', module: 'spend' }, sheet: null });
    expect(parseHash('#d=D-0193')).toEqual({ route: { level: 'deal', deal: 'D-0193' }, sheet: null });
    expect(parseHash('#m=nope')).toEqual({ route: { level: 'home' }, sheet: null });
    expect(parseHash('#s=pairing')).toEqual({ route: { level: 'home' }, sheet: 'pairing' });
    expect(formatHash({ level: 'module', module: 'rescue' }, 'mandates')).toBe('#m=rescue&s=mandates');
    expect(formatHash({ level: 'home' }, null)).toBe('');
    const r = formatHash({ level: 'deal', deal: '01JDABC' }, null);
    expect(parseHash(r).route).toEqual({ level: 'deal', deal: '01JDABC' });
  });
  it('resolves a deal by ULID or by display label', () => {
    const labels = new Map(world.deals.map((d) => [d.deal.id, d.display.label]));
    const d = byLabel('D-0190');
    expect(resolveDealRef(d.id, deals, labels)).toBe(d);
    expect(resolveDealRef('d-0190', deals, labels)).toBe(d);
    expect(resolveDealRef('D-9999', deals, labels)).toBeUndefined();
  });
});

describe('dial geometry', () => {
  const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);
  it('measures angles clockwise from 12 o’clock', () => {
    const [x0, y0] = pol(100, 0);
    close(x0, C); close(y0, C - 100);
    const [x1, y1] = pol(100, 90);
    close(x1, C + 100); close(y1, C);
  });
  it('turns the short way round', () => {
    expect(shortestTarget(0, 300)).toBe(-60);
    expect(shortestTarget(-60, -300)).toBe(60);
    expect(shortestTarget(720, 60)).toBe(780);
    expect(shortestTarget(10, 10)).toBe(10);
  });
  it('brings module i under the index and finds sectors back', () => {
    expect(STEP).toBe(60);
    expect(rotationFor(2)).toBe(-120);
    for (let i = 0; i < 6; i++) {
      const rot = rotationFor(i);
      expect(sectorAt(0, rot)).toBe(i); // under the index
      expect(sectorAt(STEP, rot)).toBe((i + 1) % 6); // one sector clockwise
      expect(sectorAt(359, rot)).toBe(i);
    }
  });
  it('maps the pointer to polar coordinates in viewBox units', () => {
    const rect = { left: 0, top: 0, width: 500, height: 500 };
    const top = toPolar(250, 0, rect);
    expect(top.rad).toBeCloseTo(500);
    expect(top.th).toBeCloseTo(0);
    expect(toPolar(500, 250, rect).th).toBeCloseTo(90);
  });
  it('spreads beads inside their sector, centred', () => {
    const a = beadAngles([0, 0, 0, 1]);
    expect(a[0]).toBeCloseTo(-8.5); expect(a[1]).toBeCloseTo(0); expect(a[2]).toBeCloseTo(8.5);
    expect(a[3]).toBe(STEP);
    const many = beadAngles(new Array(20).fill(2));
    expect(Math.max(...many) - Math.min(...many)).toBeLessThanOrEqual(46 + 1e-9);
    expect(many.every((x) => Math.abs(x - 2 * STEP) <= 23 + 1e-9)).toBe(true);
  });
  it('the intro eases from 0 to exactly 1 with an overshoot', () => {
    expect(introEase(0)).toBeCloseTo(0);
    expect(introEase(1)).toBe(1);
    const peak = Math.max(...Array.from({ length: 101 }, (_, i) => introEase(i / 100)));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.1);
  });
  it('draws closed sector paths inside the ring', () => {
    const p = wedgePath(-30, 30, R.secI, R.secO);
    expect(p.startsWith('M')).toBe(true);
    expect(p.endsWith('Z')).toBe(true);
  });
});

describe('charts', () => {
  it('chooses round money grid lines', () => {
    const t = niceTicks(29000, 38900);
    expect(t.lo).toBeLessThanOrEqual(29000);
    expect(t.hi).toBeGreaterThanOrEqual(38900);
    expect(t.ticks.length).toBeGreaterThanOrEqual(3);
    expect(t.ticks.length).toBeLessThanOrEqual(8);
    expect(t.ticks.every((x) => x % 1000 === 0)).toBe(true);
  });
  it('places a price on the market band', () => {
    expect(marketPosition(30000, 30100, 31800, 33600)).toBe('below p25');
    expect(marketPosition(34000, 30100, 31800, 33600)).toBe('above p75');
    expect(marketPosition(31800, 30100, 31800, 33600)).toBe('p50');
    expect(marketPosition(32900, 30100, 31800, 33600)).toBe('p65');
  });
});

describe('a buyer’s RECEIPTED deal is the seller’s word, not paid', () => {
  const buyer = (state: DealState) => mk({ kind: 'haggle', side: 'buyer', state, shield: null });
  it('waits on the chip and the bead, and does not count as settled', () => {
    expect(chipClass(buyer('RECEIPTED'))).toBe('wait');
    expect(beadKind(buyer('RECEIPTED'))).not.toBe('settled');
    expect(isSettled(buyer('RECEIPTED'))).toBe(false);
    expect(amountTone(buyer('RECEIPTED'))).not.toBe('moved');
    expect(moneyNow(buyer('RECEIPTED'))).not.toBe('paid');
  });
  it('is paid once PayPal’s statement matches, and for the seller at once', () => {
    expect(chipClass(buyer('RECONCILED'))).toBe('done');
    expect(beadKind(buyer('RECONCILED'))).toBe('settled');
    expect(chipClass(mk({ kind: 'haggle', side: 'seller', state: 'RECEIPTED', shield: null }))).toBe('done');
    expect(beadKind(mk({ kind: 'haggle', side: 'seller', state: 'RECEIPTED', shield: null }))).toBe('settled');
  });
  it('the sample week’s D-0187 reads as the seller’s word', () => {
    expect(chipClass(byLabel('D-0187'))).toBe('wait');
    expect(stateLabel(byLabel('D-0187').state, byLabel('D-0187'))).toBe('Seller says paid');
  });
});

describe('a seller’s receipt is the seller’s word, and a deal PayPal never confirmed is an end (value-1)', () => {
  const ev = (state: DealState, receipt: 'NONE' | 'SELLER_ATTESTED' | 'PAYPAL_VERIFIED') => ({ state, evidence: { deal_id: 'd', receipt, reconciliation: 'pending_reporting' as const } });
  it('the main window’s receipt toast never reads the seller’s word as paid', () => {
    expect(receiptToast(ev('RECEIPTED', 'SELLER_ATTESTED'))).toEqual({ text: 'Seller says paid', tone: 'gold' });
    expect(receiptToast(ev('RECEIPTED', 'PAYPAL_VERIFIED'))).toEqual({ text: 'Paid, receipt saved', tone: 'ok' });
    expect(receiptToast(ev('UNCONFIRMED', 'SELLER_ATTESTED'))).toEqual({ text: 'Not confirmed by PayPal', tone: 'bad' });
    expect(receiptToast(ev('WITHDRAWN', 'NONE'))).toEqual({ text: 'Withdrawn', tone: 'info' });
  });
  it('UNCONFIRMED is closed, never settled, and says what is known about the money', () => {
    const d = { state: 'UNCONFIRMED' as const, side: 'buyer' as const, kind: 'haggle' as const, shield: null };
    expect(isTerminal(d)).toBe(true);
    expect(isSettled(d)).toBe(false);
    expect(beadKind(d)).toBe('stopped');
    expect(chipClass(d)).toBe('bad');
    expect(moneyNow(d)).toBe('the seller says paid · PayPal’s statement never showed it');
    expect(amountNote(d)).toBe('not confirmed by PayPal');
    expect(stateLabel('UNCONFIRMED', d)).toBe('Not confirmed by PayPal');
    const strip = stripFor(d);
    expect(strip[strip.length - 1]).toMatchObject({ state: 'UNCONFIRMED', status: 'cur', tone: 'bad' });
    expect(strip.find((s) => s.state === 'AWAITING_APPROVAL')?.status).toBe('done');
    expect(strip.find((s) => s.state === 'CAPTURED')?.status).toBe('todo');
  });
});

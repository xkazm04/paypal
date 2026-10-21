import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import type { DealState } from '@bindings/DealState';
import { buildMockState, usd } from '../../mock/fixtures';
import {
  amountNote, amountTone, beadKind, isSettled, isTerminal, receiptToast, stateLabel, canStartAgent, canWithdraw, chipClass, clauseText, formatHash, isOwnerAccept, ledgerScope, mandatesGoverning,
  marketPosition, moduleOf, stepBack, moneyNow, niceTicks, parseHash, resolveDealRef, reviewVerb,
  type Route, spendToday, splitHeadline, stripFor, sumByCurrency, summarize, weekBounds,
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
    expect(parseHash('#m=spend')).toEqual({ route: { level: 'module', module: 'spend' } });
    expect(parseHash('#d=D-0193')).toEqual({ route: { level: 'deal', deal: 'D-0193' } });
    expect(parseHash('#m=nope')).toEqual({ route: { level: 'home' } });
    // The old sheet links open their place (WP2.5: the sheets are layers now).
    expect(parseHash('#s=pairing')).toEqual({ route: { level: 'place', place: 'pairing' } });
    expect(parseHash('#m=rescue&s=mandates')).toEqual({ route: { level: 'place', place: 'rules' } });
    expect(formatHash({ level: 'place', place: 'rules', from: 'rescue' })).toBe('#p=rules&m=rescue');
    expect(formatHash({ level: 'home' })).toBe('');
    const r = formatHash({ level: 'deal', deal: '01JDABC' });
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
    expect(moneyNow(d)).toBe('the seller says paid · no match on PayPal’s statement');
    expect(amountNote(d)).toBe('not confirmed by PayPal');
    expect(stateLabel('UNCONFIRMED', d)).toBe('Not confirmed by PayPal');
    const strip = stripFor(d);
    expect(strip[strip.length - 1]).toMatchObject({ state: 'UNCONFIRMED', status: 'cur', tone: 'bad' });
    expect(strip.find((s) => s.state === 'AWAITING_APPROVAL')?.status).toBe('done');
    expect(strip.find((s) => s.state === 'CAPTURED')?.status).toBe('todo');
  });
});

describe('nested routes', () => {
  const round = (r: Route) => parseHash(formatHash(r));
  it('round-trips every hash form', () => {
    const forms: Array<[Route, string]> = [
      [{ level: 'home' }, ''],
      [{ level: 'place', place: 'settings' }, '#p=settings'],
      [{ level: 'module', module: 'book' }, '#m=book'],
      [{ level: 'module', module: 'book', view: 'ledger' }, '#m=book&v=ledger'],
      [{ level: 'module', module: 'rescue', view: 'in-progress' }, '#m=rescue&v=in-progress'],
      [{ level: 'place', place: 'pairing', from: 'settings' }, '#p=pairing&m=settings'],
      [{ level: 'place', place: 'safety', from: 'book' }, '#p=safety&m=book'],
      [{ level: 'setup', step: 'rules' }, '#s=setup&step=rules'],
      [{ level: 'setup', step: 'unlock' }, '#s=setup&step=unlock'],
    ];
    for (const [route, hash] of forms) {
      expect(formatHash(route)).toBe(hash);
      expect(round(route)).toEqual({ route });
    }
  });
  it('keeps the older grammars and falls back for unknown views and steps', () => {
    // An old sheet over a route opens the place that was in front.
    expect(parseHash('#m=spend&s=settings')).toEqual({ route: { level: 'place', place: 'settings' } });
    expect(parseHash('#d=D-0193&s=pairing')).toEqual({ route: { level: 'place', place: 'pairing' } });
    expect(parseHash('#m=book&v=Bad%20View!')).toEqual({ route: { level: 'module', module: 'book' } });
    expect(parseHash('#v=ledger')).toEqual({ route: { level: 'home' } });
    expect(parseHash('#s=setup')).toEqual({ route: { level: 'setup', step: 'keys' } });
    expect(parseHash('#s=setup&step=nope')).toEqual({ route: { level: 'setup', step: 'keys' } });
    expect(formatHash({ level: 'setup' })).toBe('#s=setup&step=keys');
  });
  it('steps back one level: view, module, deal, setup', () => {
    expect(stepBack({ level: 'module', module: 'book', view: 'ledger' }, null)).toEqual({ level: 'module', module: 'book' });
    expect(stepBack({ level: 'module', module: 'book', view: 'ghost' }, null, false)).toEqual({ level: 'home' });
    expect(stepBack({ level: 'module', module: 'book' }, null)).toEqual({ level: 'home' });
    expect(stepBack({ level: 'deal', deal: 'x' }, 'spend')).toEqual({ level: 'module', module: 'spend' });
    expect(stepBack({ level: 'deal', deal: 'x' }, null)).toEqual({ level: 'home' });
    expect(stepBack({ level: 'setup', step: 'rules' }, null)).toEqual({ level: 'home' });
    expect(stepBack({ level: 'home' }, null)).toBeNull();
  });
  it('steps back from a place: to where it was opened, else its usual parent, else the centre', () => {
    expect(stepBack({ level: 'place', place: 'rules' }, null)).toEqual({ level: 'home' });
    expect(stepBack({ level: 'place', place: 'limits' }, null)).toEqual({ level: 'place', place: 'rules' });
    expect(stepBack({ level: 'place', place: 'pairing' }, null)).toEqual({ level: 'place', place: 'connections' });
    expect(stepBack({ level: 'place', place: 'pairing', from: 'settings' }, null)).toEqual({ level: 'place', place: 'settings' });
    expect(stepBack({ level: 'place', place: 'safety', from: 'book' }, null)).toEqual({ level: 'module', module: 'book' });
  });
});

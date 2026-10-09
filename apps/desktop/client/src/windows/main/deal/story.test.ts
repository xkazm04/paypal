import { describe, expect, it } from 'vitest';
import type { Clause } from '@bindings/Clause';
import type { Deal } from '@bindings/Deal';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import { SELLER_SAYS_PAID } from '../../../lib/words';
import { buildMockState } from '../../../mock/fixtures';
import { readClauses, type Reading } from './model';
import { CLOSED, dealAnswer, decisionQuestion, decisionWhy, reviewMeans, ruleChecks, rulesBadge, standingFacts, threadRows } from './story';

const NOW = 1_800_000_000;
const world = buildMockState(NOW);
const entry = (l: string) => {
  const d = world.deals.find((x) => x.display.label === l);
  if (!d) throw new Error(`fixture ${l} missing`);
  return d;
};
const deal = (l: string): Deal => entry(l).deal;
const clausesOf = (d: Deal): Clause[] => world.mandates.find((m) => m.payload.id === d.mandate_id && m.payload.version === d.mandate_version)!.payload.clauses;
const last = (l: string): TranscriptStep | null => entry(l).transcript.reduce<TranscriptStep | null>((a, s) => (!a || s.seq > a.seq ? s : a), null);
const answer = (l: string, band: Reading | null = null, mayWithdraw = false) =>
  dealAnswer(deal(l), { need: entry(l).attention ?? undefined, them: 'Dan', latest: last(l), band, mayWithdraw });

describe('dealAnswer: one sentence a first-time reader understands', () => {
  it('a haggle that waits for you names the offer and where it sits against your range', () => {
    const a = answer('D-0193', 'within');
    expect(a.tone).toBe('need');
    expect(a.title).toBe('Dan offered $329.00. It’s inside your price range; you decide.');
    expect(answer('D-0193', 'outside').title).toContain('outside your price range');
    expect(answer('D-0193', null).title).toMatch(/Your call\.$/);
  });
  it('a held payment says it is on hold and that releasing is the owner’s choice', () => {
    const a = dealAnswer(deal('D-0190'), { need: entry('D-0190').attention ?? undefined, them: 'partsco', latest: null, band: null, mayWithdraw: false });
    expect(a.tone).toBe('need');
    expect(a.title).toBe('$64.00 for partsco is on hold at PayPal. Pay it or release it; you decide.');
  });
  it('a mismatch is an alert, closed, and never mentions paying', () => {
    const a = answer('D-0199');
    expect(a.tone).toBe('alert');
    expect(a.sub).toContain(CLOSED);
    expect(a.sub).toContain('Asked $339.00, not $329.00');
    expect(`${a.title} ${a.sub}`).not.toMatch(/approve|pay it|collect/i);
  });
  it('refusals and blocks are alerts that say nothing moved', () => {
    expect(answer('D-0196').tone).toBe('alert');
    expect(answer('D-0196').title).toContain('stopped this for good');
    // The check that stopped it is the wallet core's recorded rule, in plain words.
    expect(answer('D-0196').sub).toBe('The money would go to someone other than the payee you agreed with. ' + CLOSED);
    expect(answer('D-0192').title).toContain('refused this before PayPal was asked');
    expect(answer('D-0192').sub).toContain(CLOSED);
  });
  it('a closed deal is calm and says nothing here can move money', () => {
    const done = answer('D-0185');
    expect(done).toMatchObject({ tone: 'done', title: CLOSED });
    expect(done.sub).toContain('Paid to you');
    expect(done.sub).toContain('decided by your shop rules');
    expect(answer('D-0180')).toMatchObject({ tone: 'calm', title: CLOSED });
    expect(answer('D-0176').sub).toContain('No money moved');
  });
  it('a paused request and a failed renewal name what the owner is asked', () => {
    expect(answer('D-0198').title).toContain('paused for your check');
    expect(answer('D-0198').title).toContain('Nothing was sent to PayPal');
    expect(answer('D-0198').sub).toBe('The price is more than 1.4 × the usual price.');
    expect(dealAnswer(deal('D-0188'), { need: entry('D-0188').attention ?? undefined, them: 'S-14', latest: null, band: null, mayWithdraw: false }).title).toBe('S-14’s renewal didn’t go through. You choose the fix: a $9.60 invoice for this cycle.');
  });
  it('a live deal with nothing for the owner is calm and may mention withdrawing', () => {
    const a = dealAnswer({ ...deal('D-0193') }, { need: undefined, them: 'Dan', latest: last('D-0193'), band: null, mayWithdraw: true });
    expect(a.tone).toBe('calm');
    expect(a.title).toBe('Dan offered $329.00. Nothing needs you right now.');
    expect(a.sub).toContain('withdrawing can’t move money');
    expect(dealAnswer({ ...deal('D-0193'), state: 'SETTLING' }, { need: undefined, them: 'Dan', latest: null, band: null, mayWithdraw: true }).title).toContain('Dan acts next');
  });
});

describe('the decision card words', () => {
  it('asks a question about people and money', () => {
    const n = (l: string) => entry(l).attention!;
    expect(decisionQuestion(deal('D-0193'), n('D-0193'), 'Dan')).toBe('Accept Dan’s $329.00?');
    expect(decisionQuestion(deal('D-0190'), n('D-0190'), 'partsco')).toBe('Pay partsco $64.00, or release the hold?');
    expect(decisionQuestion(deal('D-0198'), n('D-0198'), 'pixel-bay')).toBe('Let this $140.00 payment to pixel-bay go ahead?');
    expect(decisionQuestion({ ...deal('D-0198'), state: 'WITHDRAWN' }, n('D-0198'), 'pixel-bay')).toBe('Withdraw pixel-bay’s paused $140.00 request?');
    expect(decisionQuestion(deal('D-0188'), n('D-0188'), 'S-14')).toBe('Approve a $9.60 invoice to fix S-14’s failed renewal?');
  });
  it('names the rule that asks, in plain words', () => {
    const d = deal('D-0193');
    const readings = readClauses(clausesOf(d), d, { asks: 6 });
    expect(decisionWhy(d, { clause: { mandate_id: d.mandate_id, number: 6 } }, readings, d.mandate_id)).toBe('Because of your rule “Ask me above” (asks you above $250.00).');
    expect(decisionWhy(deal('D-0198'), { clause: null }, [], 'x')).toBe('A scam check paused this before PayPal was asked.');
    expect(decisionWhy(deal('D-0188'), { clause: null }, [], 'x')).toBeNull();
    const p = deal('D-0190');
    // The payees rule names the house seller as a name, never "HOUSE".
    expect(decisionWhy(p, { clause: { mandate_id: p.mandate_id, number: 7 } }, readClauses(clausesOf(p), p, { asks: 7 }), p.mandate_id)).toMatch(/^Because of your rule “Approved payees” \(only .*House seller.*\)\.$/);
    // D-0190's $64.00 hold is under the ask-me threshold: as in Rust, its attention item names no rule.
    expect(decisionWhy(p, entry('D-0190').attention!, readClauses(clausesOf(p), p), p.mandate_id)).toBeNull();
  });
  it('the review option only hands off: it always says nothing moves until you confirm in the approval window', () => {
    for (const l of ['D-0193', 'D-0190', 'D-0188', 'D-0198']) {
      const m = reviewMeans(deal(l), false);
      expect(m).toContain('approval window');
      expect(m).toContain('Nothing moves until you confirm there.');
    }
    expect(reviewMeans(deal('D-0193'), true)).toContain('Windows Hello');
    expect(reviewMeans(deal('D-0193'), false)).not.toContain('Windows Hello');
  });
});

describe('your rules as checks', () => {
  const d = deal('D-0193');
  const checks = ruleChecks(readClauses(clausesOf(d), d, { rounds: { used: 5, max: 6 } }));
  it('maps readings to pass / ask / fail / unknown and drops rules that do not apply', () => {
    expect(checks.find((c) => c.n === 4)?.state).toBe('pass');
    expect(checks.find((c) => c.n === 6)?.state).toBe('ask');
    expect(checks.find((c) => c.n === 5)?.state).toBe('unknown'); // never green
    expect(checks.every((c) => c.name && c.value && c.title.startsWith('You signed: '))).toBe(true);
    const big = deal('D-0196');
    const bigChecks = ruleChecks(readClauses(clausesOf(big), big));
    expect(bigChecks.find((c) => c.n === 3)?.state).toBe('fail');
    expect(bigChecks.find((c) => c.n === 6)).toBeUndefined(); // closed, nothing is asked
  });
  it('badges the tab only for an exception, a failure first', () => {
    expect(rulesBadge(checks)).toEqual({ tone: 'gold', text: '1 asks you' });
    expect(rulesBadge(checks.filter((c) => c.state === 'pass'))).toBeNull();
    expect(rulesBadge([{ key: 'a', n: 3, name: 'x', state: 'fail', value: '', title: '' }, ...checks])).toEqual({ tone: 'red', text: '1 outside' });
  });
});

describe('what happened', () => {
  it('reads oldest first with the current state last, and no invented times', () => {
    const rows = threadRows(entry('D-0193').transcript, deal('D-0193'));
    expect(rows[0]).toMatchObject({ kind: 'ledger', key: 'created' });
    expect(rows.at(-1)).toMatchObject({ kind: 'ledger', key: 'updated' });
    const env = rows.filter((r) => r.kind === 'env');
    expect(env.map((r) => r.kind === 'env' && r.step.seq)).toEqual([...env.map((r) => r.kind === 'env' && r.step.seq)].sort((a, b) => Number(a) - Number(b)));
    expect(env.at(-1)).toMatchObject({ step: { seq: 11 } });
  });
  it('adds PayPal events only from ids the deal holds, between the messages and the current state', () => {
    const rows = threadRows(entry('D-0187').transcript, deal('D-0187'));
    const keys = rows.filter((r) => r.kind === 'event').map((r) => r.key);
    expect(keys).toEqual(['pp-order', 'pp-hold', 'pp-pay']);
    expect(rows.find((r) => r.kind === 'event' && r.key === 'pp-pay')).toMatchObject({ text: 'The seller reports the payment' });
    expect(rows.at(-1)).toMatchObject({ key: 'updated' });
    expect(threadRows([], deal('D-0196')).some((r) => r.kind === 'event')).toBe(false);
  });
});

describe('where it stands', () => {
  it('shows the latest offer, the limit, offers used and the market for a haggle', () => {
    const e = entry('D-0193');
    const f = standingFacts(e.deal, e.display.band, last('D-0193'), 'Dan');
    expect(f.find((x) => x.k === 'Dan’s latest')?.v).toBe('$329.00');
    expect(f.find((x) => x.k === 'Most you’ll pay')?.v).toBe('$340.00');
    expect(f.find((x) => x.k === 'Offers used')?.v).toBe('5 of 6');
    expect(f.find((x) => x.k === 'This price is')?.v).toBe('a bit above typical');
  });
  it('shows price and quantity for other kinds, and nothing it cannot know', () => {
    const e = entry('D-0198');
    const f = standingFacts(e.deal, null, null, 'pixel-bay');
    expect(f.map((x) => x.k)).toContain('Quantity');
    expect(standingFacts(deal('D-0180'), null, null, 'x').find((x) => x.k === 'Typical price')).toBeUndefined();
  });
  it('a failed renewal shows what failed and what the fix invoices, as Rescue and the approval window do', () => {
    const d = deal('D-0188');
    const offer = world.rescue?.[d.id]?.offer ?? null;
    expect(offer).not.toBeNull();
    expect(standingFacts(d, null, null, 'S-14', offer).map((x) => [x.k, x.v])).toEqual([
      ['Renewal that failed', '$12.00'], ['This fix invoices', '$9.60'], ['Discount', '20% off this cycle only'],
    ]);
    // Without the wallet's rescue read it says only the deal's own price.
    expect(standingFacts(d, null, null, 'S-14', null).map((x) => x.k)).toEqual(['Price']);
  });
});

describe('a buyer’s deal the seller says is paid', () => {
  it('is not closed as paid: D-0187 reads the seller’s word and stays calm, not done', () => {
    const a = answer('D-0187');
    expect(a.tone).toBe('calm');
    expect(a.sub).toContain(SELLER_SAYS_PAID);
    expect(a.sub).not.toContain('Paid, on statement');
  });
  it('a buyer deal PayPal’s statement matched is closed as paid', () => {
    const d = { ...deal('D-0187'), state: 'RECONCILED' as const };
    const a = dealAnswer(d, { need: undefined, them: 'Dan', latest: null, band: null, mayWithdraw: false });
    expect(a.tone).toBe('done');
    expect(a.sub).toContain('Paid, on statement');
  });
});

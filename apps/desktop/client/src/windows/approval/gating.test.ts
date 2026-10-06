import { describe, expect, it } from 'vitest';
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import type { Deal } from '@bindings/Deal';
import type { DealKind } from '@bindings/DealKind';
import type { Clause } from '@bindings/Clause';
import type { DealState } from '@bindings/DealState';
import type { H256 } from '@bindings/H256';
import type { ShieldVerdict } from '@bindings/ShieldVerdict';
import type { Side } from '@bindings/Side';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import { anyMoneyEnabled, decisionArgs, deriveGates, namesMatch, offersOwnerAccept, ownerAcceptArgs, ownsPaypalResource, type GateContext } from './gating';
import { buildChecks, buildStrip, derivePhase, marketPercentile, parseMoneyInput } from './model';
import { buildMandate, draftFrom, newDraft } from './mandateDraft';
import { nameProblem } from './PairingConfirm';
import { anyRowFailed, buildDiff, buildEvidence, diffKind, evidenceVisible, relSame, relWithin, tally, toneOf, type DiffInput, type DiffRow } from './review/diff';

const HASH = Array.from({ length: 32 }, (_, i) => i) as H256;
const ALL_STATES: DealState[] = [
  'PAIRING', 'LISTED', 'NEGOTIATING', 'AGREED', 'SETTLING', 'AWAITING_APPROVAL', 'APPROVED', 'AUTHORIZED', 'CAPTURED', 'RECEIPTED',
  'RECONCILED', 'WITHDRAWN', 'EXPIRED', 'REFUSED', 'MISMATCH', 'FAILED', 'VOIDED', 'AUTO_VOIDED', 'REFUNDED', 'DISPUTED',
];
const KINDS: DealKind[] = ['purchase', 'haggle', 'shop_order', 'rescue', 'invoice'];
const SIDES: Side[] = ['buyer', 'seller'];
const SHIELDS: Array<ShieldVerdict | null> = [null, 'CLEAR', 'ASK', 'HOLD', 'BLOCK'];

function deal(p: Partial<Deal> = {}): Deal {
  return {
    id: '01JDTESTDEAL0000000000000Q',
    kind: 'purchase',
    side: 'buyer',
    counterparty: 'kp_test',
    terms: { item_ref: 'dock', qty: 1, unit_price: { minor: 6400, currency: 'USD' }, currency: 'USD', delivery: { type: 'digital_now' } },
    state: 'AWAITING_APPROVAL',
    mandate_id: 'M1',
    mandate_version: 3,
    transcript_head: HASH,
    paypal: { order: 'ORD1', authorization: null, capture: null, subscription: null },
    mode: 'sandbox',
    market: null,
    shield: 'CLEAR',
    ...p,
  };
}

function summary(d: Partial<Deal> = {}, s: Partial<ApprovalSummary> = {}): ApprovalSummary {
  return {
    deal: deal(d),
    evidence: { deal_id: 'x', receipt: 'NONE', reconciliation: 'not_applicable' },
    attempt: 1,
    terms_hash: HASH,
    locked: false,
    can_release: true,
    can_open_paypal: true,
    unavailable_reason: null,
    ...s,
  };
}

function ctx(s: ApprovalSummary, p: Partial<GateContext> = {}): GateContext {
  return { summary: s, settingsLocked: false, lockedByError: false, tokenReady: true, anyCheckFailed: false, typedName: '', expectedName: 'pixel-bay', ...p };
}

/** Every combination of state × kind × side × shield × flags. */
function* everything() {
  for (const state of ALL_STATES)
    for (const kind of KINDS)
      for (const side of SIDES)
        for (const shield of SHIELDS)
          for (const can_release of [true, false])
            for (const can_open_paypal of [true, false])
              yield summary({ state, kind, side, shield }, { can_release, can_open_paypal });
}

describe('locked: no money button is ever enabled', () => {
  it('for summary.locked, settings.locked and a LOCKED answer, across every combination', () => {
    let n = 0;
    for (const s of everything()) {
      const variants: GateContext[] = [
        ctx({ ...s, locked: true }, { typedName: 'pixel-bay' }),
        ctx(s, { settingsLocked: true, typedName: 'pixel-bay' }),
        ctx(s, { lockedByError: true, typedName: 'pixel-bay' }),
      ];
      for (const c of variants) {
        const g = deriveGates(c);
        expect(anyMoneyEnabled(g)).toBe(false);
        expect(g.bandSet.enabled).toBe(false);
        n++;
      }
    }
    expect(n).toBeGreaterThan(10000);
  });
  it('nor without the capability', () => {
    for (const s of everything()) expect(anyMoneyEnabled(deriveGates(ctx(s, { tokenReady: false, typedName: 'pixel-bay' })))).toBe(false);
  });
  it('but withdraw stays available while locked (the safe direction)', () => {
    const g = deriveGates(ctx(summary({ state: 'AWAITING_APPROVAL' }, { locked: true })));
    expect(g.withdraw).toMatchObject({ visible: true, enabled: true });
  });
});

describe('can_release=false disables countersign, capture, void and rescue', () => {
  it('everywhere', () => {
    for (const s of everything()) {
      if (s.can_release) continue;
      const g = deriveGates(ctx(s));
      expect(g.countersign.enabled || g.capture.enabled || g.void.enabled || g.rescue.enabled).toBe(false);
    }
  });
  it('and shows the unavailable_reason honestly', () => {
    const g = deriveGates(ctx(summary({ state: 'AUTHORIZED' }, { can_release: false, unavailable_reason: 'Enter PayPal sandbox credentials' })));
    expect(g.capture).toEqual({ visible: true, enabled: false, reason: 'Enter PayPal sandbox credentials' });
  });
});

describe('shield', () => {
  it('BLOCK is never releasable and never offers PayPal or countersign', () => {
    for (const s of everything()) {
      if (s.deal.shield !== 'BLOCK') continue;
      const g = deriveGates(ctx(s, { typedName: 'pixel-bay' }));
      expect(g.releaseHold.visible).toBe(false);
      expect(g.openPaypal.visible).toBe(false);
      expect(g.countersign.visible).toBe(false);
      expect(g.capture.visible).toBe(false);
    }
  });
  it('HOLD releases only after the exact name is typed', () => {
    const s = summary({ state: 'AGREED', shield: 'HOLD' });
    expect(deriveGates(ctx(s, { typedName: '' })).releaseHold).toMatchObject({ visible: true, enabled: false });
    expect(deriveGates(ctx(s, { typedName: 'pixel' })).releaseHold.enabled).toBe(false);
    expect(deriveGates(ctx(s, { typedName: 'Pixel-Bay' })).releaseHold.enabled).toBe(false);
    expect(deriveGates(ctx(s, { typedName: '  pixel-bay ' })).releaseHold.enabled).toBe(true);
    expect(deriveGates(ctx(s, { typedName: 'pixel-bay', expectedName: null })).releaseHold.enabled).toBe(false);
  });
  it('HOLD hides PayPal and countersign until released', () => {
    const g = deriveGates(ctx(summary({ state: 'AWAITING_APPROVAL', shield: 'HOLD' }), { typedName: 'pixel-bay' }));
    expect(g.openPaypal.visible).toBe(false);
    expect(deriveGates(ctx(summary({ state: 'AGREED', shield: 'HOLD' }))).countersign.visible).toBe(false);
  });
  it('namesMatch is exact apart from surrounding / repeated whitespace', () => {
    expect(namesMatch('Dan ·  north-desk', 'Dan · north-desk')).toBe(true);
    expect(namesMatch('dan · north-desk', 'Dan · north-desk')).toBe(false);
    expect(namesMatch('   ', '   ')).toBe(false);
  });
});

describe('MISMATCH never shows PayPal', () => {
  it('in any combination, and offers no money action at all', () => {
    for (const s of everything()) {
      if (s.deal.state !== 'MISMATCH') continue;
      const g = deriveGates(ctx(s, { typedName: 'pixel-bay' }));
      expect(g.openPaypal.visible).toBe(false);
      expect(g.countersign.visible).toBe(false);
      expect(g.capture.visible).toBe(false);
      expect(g.void.visible).toBe(false);
      expect(anyMoneyEnabled(g)).toBe(false);
    }
  });
  it('and the phase is mismatch even when the shield is CLEAR', () => {
    expect(derivePhase(summary({ state: 'MISMATCH' }), { locked: false, inBrowser: true, revealed: true })).toBe('mismatch');
  });
});

describe('buyer haggle resources belong to the seller', () => {
  it('never shows capture, void or countersign (authorize) for a buyer haggle or shop order', () => {
    for (const s of everything()) {
      if (s.deal.side !== 'buyer' || (s.deal.kind !== 'haggle' && s.deal.kind !== 'shop_order')) continue;
      const g = deriveGates(ctx(s));
      expect(g.capture.visible).toBe(false);
      expect(g.void.visible).toBe(false);
      expect(g.countersign.visible).toBe(false);
    }
  });
  it('but the buyer may still open PayPal to approve the seller’s order', () => {
    const g = deriveGates(ctx(summary({ kind: 'haggle', side: 'buyer', state: 'AWAITING_APPROVAL' })));
    expect(g.openPaypal).toMatchObject({ visible: true, enabled: true });
  });
  it('owned resources are seller-side deals and own purchases, never rescue/invoice/replay', () => {
    expect(ownsPaypalResource({ side: 'buyer', kind: 'purchase', mode: 'sandbox' })).toBe(true);
    expect(ownsPaypalResource({ side: 'seller', kind: 'haggle', mode: 'sandbox' })).toBe(true);
    expect(ownsPaypalResource({ side: 'buyer', kind: 'haggle', mode: 'sandbox' })).toBe(false);
    expect(ownsPaypalResource({ side: 'seller', kind: 'rescue', mode: 'sandbox' })).toBe(false);
    expect(ownsPaypalResource({ side: 'buyer', kind: 'purchase', mode: 'replay' })).toBe(false);
  });
});

describe('open PayPal is gated separately on can_open_paypal', () => {
  it('is enabled only in AWAITING_APPROVAL, buyer side, with can_open_paypal, unlocked, all checks ✓', () => {
    for (const s of everything()) {
      const g = deriveGates(ctx(s));
      if (g.openPaypal.enabled) {
        expect(s.deal.state).toBe('AWAITING_APPROVAL');
        expect(s.deal.side).toBe('buyer');
        expect(s.can_open_paypal).toBe(true);
        expect(['HOLD', 'BLOCK']).not.toContain(s.deal.shield);
      }
    }
  });
  it('does not depend on can_release (buyer credentials are unnecessary)', () => {
    const g = deriveGates(ctx(summary({ kind: 'haggle', state: 'AWAITING_APPROVAL' }, { can_release: false, can_open_paypal: true })));
    expect(g.openPaypal.enabled).toBe(true);
  });
  it('is disabled when can_open_paypal=false or a check failed', () => {
    expect(deriveGates(ctx(summary({}, { can_open_paypal: false }))).openPaypal).toMatchObject({ visible: true, enabled: false });
    expect(deriveGates(ctx(summary(), { anyCheckFailed: true })).openPaypal.enabled).toBe(false);
  });
});

describe('countersign / capture follow the Rust decision table', () => {
  it('countersign only from AGREED (create) or APPROVED (authorize)', () => {
    for (const s of everything()) {
      if (deriveGates(ctx(s)).countersign.visible) expect(['AGREED', 'APPROVED']).toContain(s.deal.state);
    }
    expect(deriveGates(ctx(summary({ state: 'AGREED', shield: 'ASK' }))).countersign).toMatchObject({ visible: true, enabled: true });
    expect(deriveGates(ctx(summary({ state: 'NEGOTIATING' }))).countersign.visible).toBe(false);
  });
  it('capture and void only for an AUTHORIZED owned resource', () => {
    for (const s of everything()) {
      const g = deriveGates(ctx(s));
      if (g.capture.visible || g.void.visible) expect(s.deal.state).toBe('AUTHORIZED');
    }
    const g = deriveGates(ctx(summary({ state: 'AUTHORIZED' })));
    expect(g.capture.enabled && g.void.enabled).toBe(true);
  });
  it('rescue renders (Rust answers UNAVAILABLE) but never for other kinds', () => {
    for (const s of everything()) if (deriveGates(ctx(s)).rescue.visible) expect(s.deal.kind).toBe('rescue');
  });
  it('DecisionArgs come straight from the summary', () => {
    const s = summary({}, { attempt: 2 });
    expect(decisionArgs(s)).toEqual({ deal_id: s.deal.id, attempt: 2, terms_hash: HASH });
  });
});

describe('owner ACCEPT (deal_owner_accept)', () => {
  const COUNTER = Array.from({ length: 32 }, (_, i) => 255 - i) as H256;
  const haggle = (s: Partial<ApprovalSummary> = {}, d: Partial<Deal> = {}) =>
    summary({ kind: 'haggle', side: 'buyer', state: 'NEGOTIATING', ...d }, { can_owner_accept: true, counter_hash: COUNTER, can_release: false, can_open_paypal: false, ...s });

  it('is offered and enabled for a buyer haggle when Rust says can_owner_accept and the window is unlocked', () => {
    expect(deriveGates(ctx(haggle())).ownerAccept).toEqual({ visible: true, enabled: true, reason: null });
  });
  it('does not need can_release (it moves no money and needs no buyer credentials)', () => {
    expect(deriveGates(ctx(haggle({ can_release: false }))).ownerAccept.enabled).toBe(true);
  });
  it('absent or false can_owner_accept means no owner accept', () => {
    const { can_owner_accept: _drop, ...older } = haggle();
    expect(deriveGates(ctx(older)).ownerAccept.visible).toBe(false);
    expect(deriveGates(ctx(haggle({ can_owner_accept: false }))).ownerAccept.visible).toBe(false);
    expect(offersOwnerAccept(older)).toBe(false);
  });
  it('is never offered on the seller side, for purchases or any other kind, even if the flag were set', () => {
    for (const s of everything()) {
      const g = deriveGates(ctx({ ...s, can_owner_accept: true, counter_hash: COUNTER }));
      if (g.ownerAccept.visible) {
        expect(s.deal.side).toBe('buyer');
        expect(s.deal.kind).toBe('haggle');
        expect(['HOLD', 'BLOCK']).not.toContain(s.deal.shield);
        expect(s.deal.state).not.toBe('MISMATCH');
      }
    }
    expect(deriveGates(ctx(haggle({}, { side: 'seller' }))).ownerAccept.visible).toBe(false);
    expect(deriveGates(ctx(haggle({}, { kind: 'purchase' }))).ownerAccept.visible).toBe(false);
    expect(deriveGates(ctx(haggle({}, { kind: 'shop_order' }))).ownerAccept.visible).toBe(false);
  });
  it('is disabled while locked (any lock source) or without the capability', () => {
    expect(deriveGates(ctx(haggle({ locked: true }))).ownerAccept.enabled).toBe(false);
    expect(deriveGates(ctx(haggle(), { settingsLocked: true })).ownerAccept.enabled).toBe(false);
    expect(deriveGates(ctx(haggle(), { lockedByError: true })).ownerAccept.enabled).toBe(false);
    expect(deriveGates(ctx(haggle(), { tokenReady: false })).ownerAccept.enabled).toBe(false);
    for (const s of everything()) {
      const g = deriveGates(ctx({ ...s, can_owner_accept: true, counter_hash: COUNTER, locked: true }));
      expect(g.ownerAccept.enabled).toBe(false);
    }
  });
  it('is disabled without a counter_hash and never on a held shield or a closed deal', () => {
    expect(deriveGates(ctx(haggle({ counter_hash: null }))).ownerAccept).toMatchObject({ visible: true, enabled: false });
    expect(deriveGates(ctx(haggle({}, { shield: 'HOLD' }))).ownerAccept.visible).toBe(false);
    expect(deriveGates(ctx(haggle({}, { state: 'WITHDRAWN' }))).ownerAccept.visible).toBe(false);
  });
  it('counts as a money-advancing control', () => {
    expect(anyMoneyEnabled(deriveGates(ctx(haggle())))).toBe(true);
  });
  it('the strip names the step and an AGREED buyer haggle waits for the seller', () => {
    expect(buildStrip(haggle(), 'ready', false)[1]).toEqual({ label: 'Your approval', status: 'cur' });
    expect(buildStrip(haggle({ can_owner_accept: false }), 'ready', false)[1]?.label).toBe('Negotiating');
    expect(derivePhase(haggle({}, { state: 'AGREED' }), { locked: false, inBrowser: false, revealed: true })).toBe('waiting');
    expect(derivePhase(summary({ kind: 'purchase', state: 'AGREED' }), { locked: false, inBrowser: false, revealed: true })).toBe('ready');
  });
  it('DecisionArgs carry the exact counter_hash from the summary, or nothing is sent', () => {
    const s = haggle({ attempt: 3 });
    expect(ownerAcceptArgs(s)).toEqual({ deal_id: s.deal.id, attempt: 3, terms_hash: HASH, counter_hash: COUNTER });
    expect(ownerAcceptArgs(haggle({ counter_hash: null }))).toBeNull();
    expect(ownerAcceptArgs(haggle({ counter_hash: undefined }))).toBeNull();
  });
});

describe('withdraw follows the Rust transition table', () => {
  it('is offered only pre-capture and never for an authorization or a closed deal', () => {
    for (const st of ALL_STATES) {
      const g = deriveGates(ctx(summary({ state: st })));
      const expected = ['PAIRING', 'LISTED', 'NEGOTIATING', 'AGREED', 'SETTLING', 'AWAITING_APPROVAL', 'APPROVED'].includes(st);
      expect(g.withdraw.visible).toBe(expected);
    }
  });
});

describe('display model', () => {
  it('parses owner-typed money exactly', () => {
    expect(parseMoneyInput('340', 'USD')).toBe(34000);
    expect(parseMoneyInput('$1,200.5', 'USD')).toBe(120050);
    expect(parseMoneyInput('0.07', 'USD')).toBe(7);
    expect(parseMoneyInput('1.234', 'USD')).toBeNull();
    expect(parseMoneyInput('12', 'JPY')).toBe(12);
    expect(parseMoneyInput('1.5', 'JPY')).toBeNull();
    expect(parseMoneyInput('-3', 'USD')).toBeNull();
    expect(parseMoneyInput('abc', 'USD')).toBeNull();
  });
  it('places a price in the market band', () => {
    const m = { p25: { minor: 30100, currency: 'USD' as const }, median: { minor: 31800, currency: 'USD' as const }, p75: { minor: 33600, currency: 'USD' as const }, retrieved_at: 0, response_hash: HASH, cached: true };
    expect(marketPercentile({ minor: 31800, currency: 'USD' }, m)).toBe(50);
    expect(marketPercentile({ minor: 32900, currency: 'USD' }, m)).toBe(65);
    expect(marketPercentile({ minor: 32900, currency: 'EUR' }, m)).toBeNull();
  });
  it('marks a MISMATCH amount and a HOLD/BLOCK shield as failed checks', () => {
    const base = { mandate: undefined, clauseNumber: null, counterparty: { name: 'x', known: true }, now: 0 };
    expect(buildChecks({ ...base, summary: summary({ state: 'MISMATCH' }) }).some((c) => c.id === 'amount' && c.status === 'bad')).toBe(true);
    expect(buildChecks({ ...base, summary: summary({ shield: 'HOLD' }) }).find((c) => c.id === 'shield')?.status).toBe('bad');
    expect(buildChecks({ ...base, summary: summary({ shield: 'CLEAR' }) }).every((c) => c.status !== 'bad')).toBe(true);
  });
  it('never shows the amount as a passed check: the page has no settled amount to compare', () => {
    const base = { mandate: undefined, clauseNumber: null, counterparty: { name: 'x', known: true }, now: 0 };
    for (const state of ['AGREED', 'AWAITING_APPROVAL', 'AUTHORIZED', 'CAPTURED'] as const) {
      expect(buildChecks({ ...base, summary: summary({ state }) }).find((c) => c.id === 'amount')?.status).toBe('info');
    }
  });
  it('states delivery as a note, not a passed check, while there is no receipt evidence', () => {
    const base = { mandate: undefined, clauseNumber: null, counterparty: { name: 'x', known: true }, now: 0 };
    const s = summary();
    const none = { ...s, evidence: { ...s.evidence, receipt: 'NONE' as const, reconciliation: 'not_applicable' as const } };
    expect(buildChecks({ ...base, summary: none }).find((c) => c.id === 'evidence')?.status).toBe('info');
    const verified = { ...s, evidence: { ...s.evidence, receipt: 'PAYPAL_VERIFIED' as const } };
    expect(buildChecks({ ...base, summary: verified }).find((c) => c.id === 'evidence')?.status).toBe('ok');
  });
  it('strip ends red on terminal failures and shows LOCKED in place of READY', () => {
    const s = summary({ state: 'WITHDRAWN' });
    expect(buildStrip(s, 'stopped', false).at(-1)).toEqual({ label: 'Withdrawn', status: 'bad' });
    const r = buildStrip(summary({ kind: 'haggle' }), 'locked', true);
    expect(r[1]).toEqual({ label: 'Locked', status: 'cur' });
  });
  it('a new mandate version keeps the agent slot mandate_list reported', () => {
    const base = newDraft(1_700_000_000);
    const built = buildMandate({ ...base, clauses: base.clauses.map((c) => (c.type === 'human_present_over' ? { ...c, amount: '250' } : c)) });
    if (!built.ok) throw new Error('fixture');
    const payload = { id: 'M9', version: 2, agent_key: HASH, clauses: built.clauses, not_before: 1_700_000_000, expires: 1_800_000_000 } as unknown as Parameters<typeof draftFrom>[0]['payload'];
    expect(draftFrom({ payload, owner_sig: [], agent: 'shopper' }, 1_700_000_000).agent).toBe('shopper');
    expect(draftFrom({ payload, owner_sig: [] }, 1_700_000_000).agent).toBe('negotiator');
  });
  it('pairing names must fit Rust’s 32-byte label', () => {
    expect(nameProblem('Dan · north-desk')).toBeNull();
    expect(nameProblem('   ')).not.toBeNull();
    expect(nameProblem('x'.repeat(33))).not.toBeNull();
    expect(nameProblem('ž'.repeat(17))).not.toBeNull();
    expect(nameProblem('ab')).not.toBeNull();
  });
  it('mandate drafts convert into exact clause shapes or explain what is missing', () => {
    const d = newDraft(1_700_000_000);
    const bad = buildMandate(d);
    expect(bad.ok).toBe(false);
    const fixed = buildMandate({ ...d, clauses: d.clauses.map((c) => (c.type === 'human_present_over' ? { ...c, amount: '250' } : c)) });
    expect(fixed.ok).toBe(true);
    if (fixed.ok) expect(fixed.clauses).toContainEqual({ type: 'human_present_over', amount: { minor: 25000, currency: 'USD' } });
  });
});

// ---- The Diff (review/diff.ts): the comparison the approval window draws ----------------------

const usd = (minor: number) => ({ minor, currency: 'USD' as const });
const NOW = 1_800_000_000;
const CLAUSES: Clause[] = [
  { type: 'roles', roles: ['buy'] },
  { type: 'counterparties', rule: { type: 'paired' } },
  { type: 'per_deal', kind: 'purchase', max_amount: usd(20000), categories: ['parts'] },
  { type: 'band', item_refs: ['monitor'], floor: null, ceiling: usd(34000), max_rounds: 6, deadline: NOW + 3600 },
  { type: 'human_present_over', amount: usd(25000) },
  { type: 'payees', payees: ['cablehaus'] },
];
function mandateOf(clauses: Clause[] = CLAUSES, expires = NOW + 86400) {
  return { payload: { id: 'M1', version: 3, agent_key: HASH as unknown as never, clauses, not_before: NOW - 86400, expires } };
}
function dinput(s: ApprovalSummary, p: Partial<DiffInput> = {}): DiffInput {
  return { summary: s, mandate: mandateOf(), clauseNumber: null, counterparty: { name: 'pixel-bay', known: true }, band: null, transcript: [], ownerAccept: false, now: NOW, ...p };
}
const step = (typ: TranscriptStep['typ'], minor: number): TranscriptStep => ({ seq: 1, by: 'them', typ, price: usd(minor), at: NOW, verified: true });
const row = (rows: DiffRow[], id: string): DiffRow => {
  const r = rows.find((x) => x.id === id);
  if (!r) throw new Error(`no row ${id}`);
  return r;
};

describe('The Diff · relations', () => {
  it('= only for the exact same minor units and currency, ≠ otherwise, ? when a side is missing', () => {
    expect(relSame(usd(32900), usd(32900))).toBe('=');
    expect(relSame(usd(32900), usd(33900))).toBe('≠');
    expect(relSame(usd(32900), { minor: 32900, currency: 'EUR' })).toBe('≠');
    expect(relSame(usd(32900), null)).toBe('?');
    expect(relSame(undefined, usd(1))).toBe('?');
  });
  it('≤ within a limit (inclusive), > over it, ? across currencies or without a limit', () => {
    expect(relWithin(usd(34000), usd(34000))).toBe('≤');
    expect(relWithin(usd(34001), usd(34000))).toBe('>');
    expect(relWithin(usd(1), { minor: 5, currency: 'EUR' })).toBe('?');
    expect(relWithin(usd(1), null)).toBe('?');
  });
  it('reads = ≤ ✓ as passing, ≠ > as failing, ? as a note, … as waiting, ! as a hold', () => {
    expect(toneOf('=')).toBe('ok');
    expect(toneOf('≤')).toBe('ok');
    expect(toneOf('✓')).toBe('ok');
    expect(toneOf('≠')).toBe('bad');
    expect(toneOf('>')).toBe('bad');
    expect(toneOf('?')).toBe('info');
    expect(toneOf('…')).toBe('wait');
    expect(toneOf('!')).toBe('hold');
  });
});

describe('The Diff · before the decision', () => {
  it('READY: Rust’s can_open_paypal is what makes amount, invoice id and host read “same”', () => {
    const d = buildDiff(dinput(summary({}, { can_open_paypal: true })));
    expect(d.kind).toBe('approve');
    expect(['amount', 'invoice', 'host'].map((id) => row(d.rows, id).rel)).toEqual(['=', '=', '=']);
    expect(d.twin.op).toBe('=');
    expect(d.twin.right.v).toBe('$64.00');
  });
  it('never claims a match it cannot see: no can_open_paypal (e.g. locked) → unknown, never =', () => {
    const d = buildDiff(dinput(summary({}, { can_open_paypal: false, locked: true })));
    for (const id of ['amount', 'invoice', 'host', 'payee']) expect(row(d.rows, id).rel).toBe('?');
    expect(d.twin.right.v).toBeNull();
    expect(anyRowFailed(d.rows)).toBe(false);
    expect(row(d.rows, 'amount').src).toMatch(/unlock/);
  });
  it('the order payee is never drawn as a match (the contract does not expose it)', () => {
    expect(row(buildDiff(dinput(summary())).rows, 'payee')).toMatchObject({ rel: '?', right: null });
  });
  it('after the hand-off the asked side reads “PayPal was asked”', () => {
    expect(buildDiff(dinput(summary(), { handedOff: true })).heads[1]).toBe('PayPal was asked');
    expect(buildDiff(dinput(summary())).heads[1]).toBe('PayPal will be asked');
  });
  it('MISMATCH: ≠ in the twin and the amount row, a red row, and the asked amount only when the SETTLE carries it', () => {
    const s = summary({ kind: 'haggle', state: 'MISMATCH', shield: 'HOLD' }, { can_open_paypal: false });
    const blind = buildDiff(dinput(s));
    expect(blind.kind).toBe('mismatch');
    expect(blind.twin).toMatchObject({ op: '≠', tone: 'bad', right: { v: null } });
    expect(row(blind.rows, 'amount')).toMatchObject({ rel: '≠', tone: 'bad' });
    expect(anyRowFailed(blind.rows)).toBe(true);
    const seen = buildDiff(dinput(s, { transcript: [step('SETTLE', 6900)] }));
    expect(seen.twin.right.v).toBe('$69.00');
    expect(row(seen.rows, 'amount')).toMatchObject({ rel: '≠', right: 'asked $69.00' });
  });
  it('a SETTLE equal to the signed total reads = from the transcript itself', () => {
    const d = buildDiff(dinput(summary({}, { can_open_paypal: false }), { transcript: [step('SETTLE', 6400)] }));
    expect(row(d.rows, 'amount').rel).toBe('=');
  });
  it('the mandate row: ≤ inside the per-deal limit, > (failed) over it, ≠ when expired or inactive, ? when unknown', () => {
    expect(row(buildDiff(dinput(summary())).rows, 'mandate').rel).toBe('≤');
    const over = summary({ terms: { item_ref: 'dock', qty: 4, unit_price: usd(6400), currency: 'USD', delivery: { type: 'digital_now' } } });
    expect(row(buildDiff(dinput(over)).rows, 'mandate')).toMatchObject({ rel: '>', tone: 'bad' });
    expect(row(buildDiff(dinput(summary(), { mandate: mandateOf(CLAUSES, NOW - 1) })).rows, 'mandate')).toMatchObject({ rel: '≠', right: 'expired' });
    expect(row(buildDiff(dinput(summary(), { mandate: null })).rows, 'mandate').rel).toBe('≠');
    expect(row(buildDiff(dinput(summary(), { mandate: undefined })).rows, 'mandate').rel).toBe('?');
  });
  it('a red row narrows gating (Open PayPal disabled); an unknown row never enables anything', () => {
    const s = summary({}, { can_open_paypal: true });
    const d = buildDiff(dinput(s, { mandate: mandateOf(CLAUSES, NOW - 1) }));
    expect(anyRowFailed(d.rows)).toBe(true);
    expect(deriveGates(ctx(s, { anyCheckFailed: anyRowFailed(d.rows) })).openPaypal).toMatchObject({ visible: true, enabled: false });
    const locked = summary({}, { can_open_paypal: false });
    expect(deriveGates(ctx(locked, { anyCheckFailed: anyRowFailed(buildDiff(dinput(locked)).rows) })).openPaypal.enabled).toBe(false);
  });
  it('owner accept: band within the ceiling, who-decides “over” is a fact, not a failure', () => {
    const s = summary(
      { kind: 'haggle', state: 'NEGOTIATING', terms: { item_ref: 'monitor', qty: 1, unit_price: usd(32900), currency: 'USD', delivery: { type: 'digital_now' } } },
      { can_owner_accept: true, counter_hash: HASH, can_open_paypal: false },
    );
    const d = buildDiff(dinput(s, { ownerAccept: true, band: { floor: null, ceiling: usd(34000), max_rounds: 6, rounds_used: 5 } }));
    expect(d.kind).toBe('accept');
    expect(d.twin).toMatchObject({ op: '≥', left: { v: '$340.00' }, right: { v: '$329.00' } });
    expect(row(d.rows, 'band').rel).toBe('≤');
    expect(row(d.rows, 'rounds').rel).toBe('≤');
    expect(row(d.rows, 'present')).toMatchObject({ rel: '>', tone: 'info' });
    expect(anyRowFailed(d.rows)).toBe(false);
    // locked: Rust answers can_owner_accept=false; the comparison stays, the button does not
    expect(diffKind({ ...s, can_owner_accept: false, locked: true }, false)).toBe('accept');
  });
  it('shield HOLD: the rule row is “tripped”, not a failure; a held authorization is the capture comparison', () => {
    const h = buildDiff(dinput(summary({ state: 'AGREED', shield: 'HOLD' })));
    expect(h.kind).toBe('hold');
    expect(row(h.rows, 'rule')).toMatchObject({ rel: '!', tone: 'hold' });
    expect(row(h.rows, 'payees')).toMatchObject({ rel: '∉' });
    expect(anyRowFailed(h.rows)).toBe(false);
    const c = summary({ state: 'AUTHORIZED', paypal: { order: 'O', authorization: 'A1', capture: null, subscription: null } });
    expect(diffKind(c, false)).toBe('capture');
    expect(evidenceVisible(c, false)).toBe(false);
  });
  it('tally counts same/within, differs and the rows this window cannot see', () => {
    const d = buildDiff(dinput(summary({}, { can_open_paypal: true })));
    expect(tally(d.rows)).toMatchObject({ total: 6, bad: 0, unknown: 1 });
  });
});

describe('The Diff · after the hand-off (approved vs what PayPal and the seller report)', () => {
  it('appears on the hand-off and stays as the order moves on; never for a seller or a mismatch', () => {
    expect(evidenceVisible(summary(), false)).toBe(false);
    expect(evidenceVisible(summary(), true)).toBe(true);
    expect(evidenceVisible(summary({ kind: 'haggle', state: 'RECEIPTED' }), false)).toBe(true);
    expect(evidenceVisible(summary({ side: 'seller', state: 'CAPTURED' }), true)).toBe(false);
    expect(evidenceVisible(summary({ state: 'MISMATCH' }), true)).toBe(false);
  });
  it('waits in the browser, = once polled APPROVED, and keeps seller-attested apart from PayPal-verified', () => {
    const wait = buildEvidence({ summary: summary({ kind: 'haggle' }), inBrowser: true, counterparty: 'Dan', transcript: [] });
    expect(wait?.rows.map((r) => r.rel)).toEqual(['…', '…', '…', '…']);
    const attested = buildEvidence({
      summary: summary({ kind: 'haggle', state: 'RECEIPTED', paypal: { order: 'O', authorization: null, capture: 'C1', subscription: null } }, { evidence: { deal_id: 'x', receipt: 'SELLER_ATTESTED', reconciliation: 'pending_reporting' } }),
      inBrowser: false,
      counterparty: 'Dan',
      transcript: [step('RECEIPT', 6400)],
    });
    expect(attested?.rows.map((r) => [r.id, r.rel])).toEqual([['e-order', '='], ['e-receipt', '='], ['e-capture', '?'], ['e-report', '…']]);
    const verified = buildEvidence({
      summary: summary({ kind: 'haggle', state: 'RECONCILED', paypal: { order: 'O', authorization: null, capture: 'C1', subscription: null } }, { evidence: { deal_id: 'x', receipt: 'PAYPAL_VERIFIED', reconciliation: 'mismatch' } }),
      inBrowser: false,
      counterparty: 'Dan',
      transcript: [step('RECEIPT', 6500)],
    });
    expect(verified?.rows.map((r) => r.rel)).toEqual(['=', '≠', '=', '≠']);
  });
});

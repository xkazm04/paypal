// The safety record's parts (moved from safety/view.test.tsx with the view, assertions kept): a
// clean record has the who-decided bar in the Rewind's colours and no ids on the first view; a
// finding is a red alert naming the deal with a way to open it, and its precise wording and the
// chain head stay in the record's own view one level down.
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SafetyRecord } from '@bindings/SafetyRecord';
import { safetyWords } from '../../../safety/model';
import { SAFETY_CARD, SAFETY_VIEW } from '../../../../../lib/words';
import { recordFacts, refusedCard, SafetyDetails, SafetyFindings, SafetyWho } from './SafetyLayer';

const ID = '01JD0000000000000000000190';
const NONE = { owner: 0, signed_rule: 0, shop_rules: 0, house_rules: 0, safe_default: 0, safe_default_voids: 0 };
const rec = (extra: Partial<SafetyRecord> = {}): SafetyRecord => ({
  checked_at: 1_800_000_000, records: 120, head: Array.from({ length: 32 }, (_, i) => i) as SafetyRecord['head'], intact: true,
  deals_total: 20, deals_checked: 20, transcripts_verified: 20, money: { ...NONE, owner: 5, signed_rule: 15, shop_rules: 3, safe_default: 1, safe_default_voids: 1 },
  refusals: 5, refusal_families: [{ family: 'your_rules', count: 3 }, { family: 'not_allowed', count: 2 }],
  refused_deals: 2, refused_deal_calls: 0, violations: [], violations_total: 0, ...extra,
});
const name = (id: string) => (id === ID ? { label: 'D-0190', title: 'USB-C dock' } : null);

describe('the safety record', () => {
  afterEach(cleanup);

  it('a clean record: the verdict and the sentences, and the bar, with no deal ids or hashes on the first view', () => {
    const w = safetyWords(rec());
    expect(w.verdict).toBe('Nothing moved without your say-so.');
    expect(w.lines.join(' ')).toContain('120 records, unbroken.');
    expect(w.lines.join(' ')).toContain('PayPal was never asked for any of them.');
    const r = render(<><SafetyFindings record={rec()} detailed={false} dealName={name} onDeal={() => {}} /><SafetyWho record={rec()} /></>);
    const text = r.container.textContent ?? '';
    expect(r.getByRole('img').getAttribute('aria-label')).toContain('5 by you');
    expect(r.container.querySelectorAll('.sf-seg')).toHaveLength(4);
    expect(r.container.querySelector('.sf-seg.t-owner')).not.toBeNull();
    expect(text).not.toMatch(/D-0190|00010203|clause|mandate/);
    expect(r.queryByRole('alert')).toBeNull();
  });

  it('a finding is red and unmissable, names the deal by its title and opens it', () => {
    const onDeal = vi.fn();
    const r = render(<SafetyFindings record={rec({
      violations: [{ deal_id: ID as never, kind: 'authority', detail: 'Purchase deal: capture (attempt 1): a safe default decided a capture' }],
      violations_total: 1,
    })} detailed={false} dealName={name} onDeal={onDeal} />);
    const alert = r.getByRole('alert');
    expect(alert.textContent).toContain('Something on record broke your safety rules.');
    expect(r.container.textContent).toContain('A money step was taken without an authority that allows it.');
    expect(r.container.textContent).toContain('USB-C dock');
    expect(r.container.textContent).not.toContain('a safe default decided a capture');
    fireEvent.click(r.getByText('Open deal ›'));
    expect(onDeal).toHaveBeenCalledWith(ID);
  });

  it('the record itself shows the chain head, the counts per kind of refusal and the precise finding', () => {
    const r = render(<SafetyDetails record={rec({
      violations: [{ deal_id: ID as never, kind: 'authority', detail: 'capture (attempt 1): a safe default decided a capture' }],
      violations_total: 1,
    })} dealName={name} onDeal={() => {}} />);
    const text = r.container.textContent ?? '';
    expect(text).toContain('00010203 04050607');
    expect(text).toContain('Broke a rule you signed');
    expect(text).toContain('3 times');
    expect(text).toContain('D-0190 · capture (attempt 1): a safe default decided a capture');
    expect(text).toContain('PayPal calls on them: 0');
  });

  it('a broken chain shows what to do and no bar', () => {
    const broken = rec({
      intact: false, head: null, money: NONE, refusals: 0, refusal_families: [], deals_checked: 0, transcripts_verified: 0,
      violations: [{ deal_id: null, kind: 'chain_broken', detail: 'the audit chain does not verify' }], violations_total: 1,
    });
    const r = render(<><SafetyFindings record={broken} detailed={false} dealName={name} onDeal={() => {}} /><SafetyWho record={broken} /></>);
    expect(r.getByRole('alert').textContent).toContain('Your record doesn’t check out.');
    expect(r.container.textContent).toContain('Check your PayPal account for what actually moved');
    expect(r.queryByRole('img')).toBeNull();
    expect(r.queryByText('Open deal ›')).toBeNull();
  });

  it('a broken chain counts nothing, so no count past it reads as a zero', () => {
    // Rust (table-runtime safety.rs) returns zeros for everything past a broken chain: not counted, not none.
    const broken = rec({
      intact: false, head: null, money: NONE, refusals: 0, refusal_families: [], deals_total: 0, deals_checked: 0, transcripts_verified: 0,
      refused_deals: 0, refused_deal_calls: 0, violations: [{ deal_id: null, kind: 'chain_broken', detail: 'the audit chain does not verify' }], violations_total: 1,
    });
    const labels = recordFacts(broken).map(([k]) => k);
    expect(labels).toEqual([SAFETY_VIEW.records, SAFETY_VIEW.chain]);
    expect(refusedCard(broken)).toEqual({ value: null, note: undefined });
    const text = render(<SafetyDetails record={broken} dealName={name} onDeal={() => {}} />).container.textContent ?? '';
    expect(text).not.toContain(SAFETY_VIEW.moneySteps);
    expect(text).not.toContain('PayPal calls on them');
    expect(text).not.toContain(SAFETY_VIEW.dealsChecked);
    // An intact record keeps every count, zero included.
    expect(recordFacts(rec()).map(([k]) => k)).toEqual([SAFETY_VIEW.records, SAFETY_VIEW.chain, SAFETY_VIEW.dealsChecked, SAFETY_VIEW.histories, SAFETY_VIEW.refusedDeals, SAFETY_VIEW.moneySteps]);
    expect(refusedCard(rec({ refusals: 0 })).value).toBe(SAFETY_CARD.refusedNone);
  });
});

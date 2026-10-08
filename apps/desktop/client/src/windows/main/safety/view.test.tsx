// The safety record on screen: a clean record shows the verdict, the sentences and the who-decided
// bar in the Rewind's colours; a finding is a red alert naming the deal with a way to open it, and
// its precise wording and the chain head stay in Details.
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SafetyRecord } from '@bindings/SafetyRecord';
import { SafetyView } from './SafetySheet';

const ID = '01JD0000000000000000000190';
const NONE = { owner: 0, signed_rule: 0, shop_rules: 0, house_rules: 0, safe_default: 0, safe_default_voids: 0 };
const rec = (extra: Partial<SafetyRecord> = {}): SafetyRecord => ({
  checked_at: 1_800_000_000, records: 120, head: Array.from({ length: 32 }, (_, i) => i) as SafetyRecord['head'], intact: true,
  deals_total: 20, deals_checked: 20, transcripts_verified: 20, money: { ...NONE, owner: 5, signed_rule: 15, shop_rules: 3, safe_default: 1, safe_default_voids: 1 },
  refusals: 5, refusal_families: [{ family: 'your_rules', count: 3 }, { family: 'not_allowed', count: 2 }],
  refused_deals: 2, refused_deal_calls: 0, violations: [], violations_total: 0, ...extra,
});
const name = (id: string) => (id === ID ? { label: 'D-0190', title: 'USB-C dock' } : null);

describe('SafetyView', () => {
  afterEach(cleanup);

  it('a clean record: the verdict, the sentences and the bar, with no deal ids or hashes on Layer 1', () => {
    const r = render(<SafetyView record={rec()} detailed={false} dealName={name} onDeal={() => {}} />);
    const text = r.container.textContent ?? '';
    expect(r.getByRole('status').textContent).toContain('Nothing moved without your say-so.');
    expect(text).toContain('120 records, unbroken.');
    expect(text).toContain('PayPal was never asked for any of them.');
    expect(r.getByRole('img').getAttribute('aria-label')).toContain('5 by you');
    expect(r.container.querySelectorAll('.sf-seg')).toHaveLength(4);
    expect(r.container.querySelector('.sf-seg.t-owner')).not.toBeNull();
    expect(text).not.toMatch(/D-0190|00010203|clause|mandate/);
    expect(r.queryByRole('alert')).toBeNull();
  });

  it('a finding is red and unmissable, names the deal by its title and opens it', () => {
    const onDeal = vi.fn();
    const r = render(<SafetyView record={rec({
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

  it('Details shows the chain head, the counts per kind of refusal and the precise finding', () => {
    const r = render(<SafetyView record={rec({
      violations: [{ deal_id: ID as never, kind: 'authority', detail: 'capture (attempt 1): a safe default decided a capture' }],
      violations_total: 1,
    })} detailed dealName={name} onDeal={() => {}} />);
    const text = r.container.textContent ?? '';
    expect(text).toContain('00010203 04050607');
    expect(text).toContain('Broke a rule you signed');
    expect(text).toContain('3 times');
    expect(text).toContain('D-0190 · capture (attempt 1): a safe default decided a capture');
    expect(text).toContain('PayPal calls on them: 0');
  });

  it('a broken chain shows what to do and no bar', () => {
    const r = render(<SafetyView record={rec({
      intact: false, head: null, money: NONE, refusals: 0, refusal_families: [], deals_checked: 0, transcripts_verified: 0,
      violations: [{ deal_id: null, kind: 'chain_broken', detail: 'the audit chain does not verify' }], violations_total: 1,
    })} detailed={false} dealName={name} onDeal={() => {}} />);
    expect(r.getByRole('alert').textContent).toContain('Your record doesn’t check out.');
    expect(r.container.textContent).toContain('Check your PayPal account for what actually moved');
    expect(r.queryByRole('img')).toBeNull();
    expect(r.queryByText('Open deal ›')).toBeNull();
  });
});

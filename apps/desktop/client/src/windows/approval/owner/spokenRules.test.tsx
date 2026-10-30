// A set of rules said in one sentence (Main's Say it, handed over by approval_open): a new set starts from
// it, filled in and marked as such, and "Change it in the form" on a part scrolls to that rule and marks it.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalDraft } from '@bindings/ApprovalDraft';
import { nowUnix } from '../../../lib/format';

const session = { tokenReady: true, pending: null as string | null, unlocking: false, settingsLocked: false, lockedByError: false, call: vi.fn() };
vi.mock('../session', () => ({ useSession: () => session }));
vi.mock('../../../lib/hooks', async (orig) => ({ ...(await orig<typeof import('../../../lib/hooks')>()), useQuery: () => ({ data: undefined, error: null, loading: false, refetch: async () => {} }) }));
vi.mock('../../../lib/runtime', () => ({ backend: () => ({ kind: 'tauri', invoke: vi.fn(), listen: vi.fn() }) }));
vi.mock('./data', () => ({ useSimulation: () => ({ sim: null, error: null, loading: false }) }));

const { MandateEditor } = await import('../MandateEditor');

const now = nowUnix();
const usd = (minor: number) => ({ minor, currency: 'USD' as const });
const seed = (focus?: number): Extract<ApprovalDraft, { type: 'rules' }> => ({
  type: 'rules', agent: 'negotiator', not_before: now, expires: now + 3 * 86400, ...(focus ? { focus } : {}),
  clauses: [
    { type: 'roles', roles: ['buy'] },
    { type: 'counterparties', rule: { type: 'paired' } },
    { type: 'per_deal', kind: 'haggle', max_amount: usd(34000), categories: ['office'] },
    { type: 'band', item_refs: ['monitor-27-4k'], floor: null, ceiling: usd(34000), max_rounds: 6, deadline: now + 3 * 86400 },
    { type: 'velocity', max_deals_day: 2, max_total_day: usd(34000) },
    { type: 'human_present_over', amount: usd(32000) },
    { type: 'payees', payees: [] },
  ],
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

function open(s: ReturnType<typeof seed>) {
  render(<MandateEditor mode={undefined} entries={[]} selected={null} onSelect={() => {}} onClose={() => {}} onSigned={() => {}} onRevoked={() => {}} seedRules={s} />);
}

describe('rules said in one sentence, in the editor', () => {
  it('a new set starts from them, says where they came from, and signs nothing', () => {
    open(seed());
    expect(screen.getByText(/Filled in from what you said/)).toBeTruthy();
    // the said limits are in the levers, as typed strings
    const values = [...document.querySelectorAll<HTMLInputElement>('.ow-lever input.num')].map((i) => i.value);
    expect(values).toContain('340.00');
    expect(values).toContain('320.00');
    expect(session.call).not.toHaveBeenCalled();
    // the ready-made starting points are not offered over what was said
    expect(screen.queryByText(/Start from ready-made rules/)).toBeNull();
  });

  it('opens at the rule a part pointed at and marks it once', () => {
    vi.useFakeTimers();
    open(seed(6));
    act(() => { vi.advanceTimersByTime(500); });
    const el = document.querySelector('[data-clause="6"]');
    expect(el).not.toBeNull();
    expect(el?.classList.contains('ow-flash')).toBe(true);
    act(() => { vi.advanceTimersByTime(2500); });
    expect(el?.classList.contains('ow-flash')).toBe(false);
  });

  it('marks nothing when no part was pointed at', () => {
    vi.useFakeTimers();
    open(seed());
    act(() => { vi.advanceTimersByTime(3000); });
    expect(document.querySelector('.ow-flash')).toBeNull();
  });
});

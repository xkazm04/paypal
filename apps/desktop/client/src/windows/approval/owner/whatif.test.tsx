// T12 what-if in the mandate editor: the one-line summary, the changed-only table (unchanged
// folded, rules named in words) and the debounced call to mandate_simulate.
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MandateSimulateArgs } from '@bindings/MandateSimulateArgs';
import type { MandateSimulation } from '@bindings/MandateSimulation';
import type { SimulatedLine } from '@bindings/SimulatedLine';
import type { SimulatedVerdict } from '@bindings/SimulatedVerdict';
import { SIMULATE_DEBOUNCE_MS, useSimulation } from './data';
import { WhatIfTable } from './WhatIf';
import { changed, hitPhrase, ifWithdrawn, sameVerdict, summaryWords, verdictWords } from './simulation';

const ALLOW: SimulatedVerdict = { type: 'allow' };
const ASK: SimulatedVerdict = { type: 'ask', clause: 6 };
const CATEGORY: SimulatedVerdict = { type: 'refuse', clause: 3, reason: 'max_amount $200 per deal; category compute not allowed' };
const OVER: SimulatedVerdict = { type: 'refuse', clause: 3, reason: 'amount 11960.00 above max_amount $200 per deal' };
const PAYEE: SimulatedVerdict = { type: 'refuse', clause: 7, reason: 'payee not allowed' };
const NONE: SimulatedVerdict = { type: 'not_simulated' };

let n = 0;
function line(label: string, before: SimulatedVerdict, after: SimulatedVerdict, minor = 6400): SimulatedLine {
  n += 1;
  return { deal_id: `01JD${String(n).padStart(22, '0')}`, label, title: `item ${label}`, item_ref: `item-${n}`, kind: 'purchase', side: 'buyer', at: 1_800_000_000, amount: { minor, currency: 'USD' }, unit_price: { minor, currency: 'USD' }, before, after };
}
// Card case (a) and (b) together: the dock now asks, the GPU's binding limit moves, the rest stay.
const WEEK: SimulatedLine[] = [
  line('D-0190', ALLOW, ASK),
  line('D-0192', CATEGORY, OVER, 1_196_000),
  line('D-0186', ALLOW, ALLOW, 4500),
  line('D-0183', ALLOW, ALLOW, 3800),
  line('D-0187', ALLOW, PAYEE),
  line('D-0180', NONE, NONE, 4200),
];

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('what-if words', () => {
  it('the one line above Sign counts the draft’s answers and says what could not be checked', () => {
    expect(summaryWords(WEEK)).toBe('This version would have refused 2, asked you about 1, allowed 2; 1 couldn’t be checked.');
    expect(summaryWords(WEEK.slice(0, 4))).toBe('This version would have refused 1, asked you about 1, allowed 2.');
    expect(summaryWords([], 'These rules')).toBe('No deals this week to try these rules on.');
    expect(summaryWords(ifWithdrawn(WEEK.slice(0, 3)), 'Withdrawing')).toBe('Withdrawing would have refused 3, asked you about 0, allowed 0.');
  });
  it('a verdict changes when its outcome, its rule or the limit that binds changes', () => {
    expect(sameVerdict(CATEGORY, { ...CATEGORY })).toBe(true);
    expect(sameVerdict(CATEGORY, OVER)).toBe(false);
    expect(sameVerdict(ALLOW, ASK)).toBe(false);
    expect(WEEK.filter(changed).map((l) => l.label)).toEqual(['D-0190', 'D-0192', 'D-0187']);
  });
  it('names rules and reasons in words, never a clause number or a field name', () => {
    expect(verdictWords(CATEGORY)).toBe('Limit per deal · compute isn’t an allowed category');
    expect(verdictWords(OVER)).toBe('Limit per deal · the amount is over it');
    expect(verdictWords(PAYEE)).toBe('Approved payees · this payee isn’t on it');
    expect(verdictWords({ type: 'refuse', clause: 1, reason: 'mandate is not active' })).toBe('No rules in force');
    expect(verdictWords(ASK)).toBe('Ask me above');
    expect(verdictWords({ type: 'refuse', clause: 5, reason: 'something new' })).toBe('Daily limit');
    expect(hitPhrase(WEEK)).toBe('refused D-0187 (item D-0187) before PayPal was asked; asked you about D-0190 (item D-0190) instead of letting the agent decide; changed which rule stops D-0192 (item D-0192)');
  });
});

describe('WhatIfTable', () => {
  it('lists only the deals whose answer changes and folds the rest until asked', () => {
    const { container } = render(<WhatIfTable lines={WEEK} error={null} updating={false} signedName="Now" draftName="Your change" />);
    const ids = () => [...container.querySelectorAll('tbody tr .id')].map((e) => e.textContent);
    expect(ids()).toEqual(['D-0190', 'D-0192', 'D-0187']);
    const text = container.textContent ?? '';
    expect(text).toContain('asks you');
    expect(text).toContain('the amount is over it');
    expect(text).not.toMatch(/clause|max_amount|\b[37]\b:/);
    fireEvent.click(screen.getByRole('button', { name: /Show the 3 deals that stay the same/ }));
    expect(ids()).toEqual(['D-0190', 'D-0192', 'D-0187', 'D-0186', 'D-0183', 'D-0180']);
    expect(container.textContent).toContain('not checked');
  });
  it('says so when nothing changes, and shows a REFUSED draft in plain words', () => {
    const same = WEEK.filter((l) => !changed(l));
    const { container, unmount } = render(<WhatIfTable lines={same} error={null} updating={false} signedName="Now" draftName="Unchanged" />);
    expect(container.textContent).toContain('No deal this week would have gone differently.');
    unmount();
    render(<WhatIfTable lines={null} error={{ code: 'REFUSED', message: 'mandate clause 5: empty velocity allowance' } as never} updating={false} signedName="Now" draftName="Your change" />);
    expect(screen.getByText(/These rules can’t be signed: it allows 0 deals a day\./)).toBeTruthy();
  });
});

describe('useSimulation', () => {
  const args = (amount: number): MandateSimulateArgs => ({ draft: { id: null, agent: 'shopper', clauses: [{ type: 'human_present_over', amount: { minor: amount, currency: 'USD' } }], not_before: 0, expires: 1 } });
  const answer = (to: number): MandateSimulation => ({ from: 0, to, lines: [], not_simulated: 0 });

  it('asks once the draft has been still for the debounce, with the latest draft only', async () => {
    vi.useFakeTimers();
    const invoke = vi.fn((a: MandateSimulateArgs) => Promise.resolve(answer(a.draft.clauses.length * 100 + (a.draft.clauses[0]?.type === 'human_present_over' ? a.draft.clauses[0].amount.minor : 0))));
    const { result, rerender } = renderHook(({ a }: { a: MandateSimulateArgs | null }) => useSimulation(a, { invoke }), { initialProps: { a: args(5000) as MandateSimulateArgs | null } });
    expect(result.current.updating).toBe(true);
    rerender({ a: args(5100) });
    act(() => { vi.advanceTimersByTime(SIMULATE_DEBOUNCE_MS - 1); });
    rerender({ a: args(5200) });
    act(() => { vi.advanceTimersByTime(SIMULATE_DEBOUNCE_MS - 1); });
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); await Promise.resolve(); });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]![0]).toEqual(args(5200));
    expect(result.current).toMatchObject({ sim: answer(5300), error: null, updating: false });
    // The same draft again asks nothing; no draft asks nothing.
    rerender({ a: args(5200) });
    rerender({ a: null });
    act(() => { vi.advanceTimersByTime(SIMULATE_DEBOUNCE_MS * 2); });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.current.updating).toBe(false);
  });

  it('keeps a refusal as typed state and clears it with the next answer', async () => {
    vi.useFakeTimers();
    const invoke = vi.fn()
      .mockRejectedValueOnce({ code: 'REFUSED', message: 'mandate clause 1: empty roles' })
      .mockResolvedValueOnce(answer(9));
    const { result, rerender } = renderHook(({ a }: { a: MandateSimulateArgs }) => useSimulation(a, { invoke }), { initialProps: { a: args(1) } });
    await act(async () => { vi.advanceTimersByTime(SIMULATE_DEBOUNCE_MS); await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.error?.code).toBe('REFUSED');
    rerender({ a: args(2) });
    await act(async () => { vi.advanceTimersByTime(SIMULATE_DEBOUNCE_MS); await Promise.resolve(); await Promise.resolve(); });
    expect(result.current).toMatchObject({ sim: answer(9), error: null, updating: false });
  });
});

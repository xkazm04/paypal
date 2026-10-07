// The approval window renders the wallet's checklist verbatim (T5): every line's words exactly,
// its reading as a labelled mark, the Layer-2 fact one click down, and the CHECKING reveal as
// presentation only.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApprovalCheck } from '@bindings/ApprovalCheck';
import { WalletChecks, checksLine } from './Checks';

const CHECKS: ApprovalCheck[] = [
  { id: 'amount', status: 'fail', text: 'The payment request asks $339.00, but you agreed $329.00.', detail: 'SETTLE amount 339.00 USD (attempt 1) ≠ signed terms' },
  { id: 'payee', status: 'pass', text: 'Paid only to the payee their wallet declared when you connected.', detail: 'settlement payee north-desk = declared payee of the paired key kp_47be0d' },
  { id: 'host', status: 'wait', text: 'The PayPal link is checked when the order is made.', detail: 'no approval link yet' },
  { id: 'invoice', status: 'not_applicable', text: 'No PayPal order is used for this step.', detail: 'no SETTLE' },
  { id: 'shield', status: 'pass', text: 'Scam check: looks safe.', detail: 'shield verdict CLEAR' },
  { id: 'mandate', status: 'pass', text: 'Inside your rules: up to $340.00 per deal.', detail: 'mandate M v3: allowed; clause 3 limit per deal 340.00 USD' },
];

afterEach(cleanup);

describe('WalletChecks', () => {
  it('renders every line in the wallet’s order with its exact words and a labelled mark', () => {
    const { container } = render(<WalletChecks checks={CHECKS} />);
    // The line that does not apply folds into one quiet line until asked for.
    expect(container.querySelectorAll('li[data-check]')).toHaveLength(5);
    expect(container.querySelector('li.fold')?.textContent).toContain('1 not needed for this step');
    fireEvent.click(screen.getByRole('button', { name: 'Show the 1 not needed for this step' }));
    const rows = [...container.querySelectorAll('li[data-check]')];
    expect(rows.map((r) => r.getAttribute('data-check'))).toEqual(CHECKS.map((c) => c.id));
    rows.forEach((r, i) => {
      expect(r.querySelector('.cs-name')?.textContent).toBe(CHECKS[i]!.text);
      expect(r.getAttribute('data-status')).toBe(CHECKS[i]!.status);
    });
    expect(within(rows[0] as HTMLElement).getByLabelText('failed')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByLabelText('checked later')).toBeTruthy();
    expect(within(rows[3] as HTMLElement).getByLabelText('not needed')).toBeTruthy();
    expect(container.querySelector('.cs-sum')?.textContent).toBe('3 passed1 failed1 checked later');
    // No Layer-2 words on Layer 1.
    expect(container.querySelector('.cs-list')?.textContent).not.toMatch(/SETTLE|clause|kp_47be0d/);
  });

  it('keeps the Layer-2 fact behind Why? / Proof', () => {
    render(<WalletChecks checks={CHECKS} />);
    expect(screen.queryByText(/SETTLE amount 339.00 USD/)).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Why?' })[0]!);
    expect(screen.getByText('SETTLE amount 339.00 USD (attempt 1) ≠ signed terms')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Proof' })).toHaveLength(3);
  });

  it('the CHECKING reveal only hides lines that are already there', () => {
    const { container } = render(<WalletChecks checks={CHECKS} revealed={2} />);
    const rows = [...container.querySelectorAll('li[data-check]')];
    expect(rows).toHaveLength(6);
    expect(rows.slice(2).every((r) => r.classList.contains('reading') && r.textContent?.includes('checking…'))).toBe(true);
    expect(rows[0]!.querySelector('.cs-name')?.textContent).toBe(CHECKS[0]!.text);
    expect(container.querySelector('.cs-sum')).toBeNull();
  });

  it('folds into one line once decided', () => {
    expect(checksLine(CHECKS)).toBe('3 of 5 passed · 1 failed · 1 checked later');
  });
});

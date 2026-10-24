// After the owner holds a decision the wallet carries out, the window says which checklist it was
// bound to: the one the owner saw, which the wallet checked again before going ahead and recorded
// with the decision (table-runtime service.rs decide / record_decision). Once the deal is past the
// decision, the folded checklist is the wallet's list as it reads now, and says so: it is never
// called the checks "before you decided" (a deal can expire or be withdrawn with no decision at all).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalCheck } from '@bindings/ApprovalCheck';
import type { ApprovalCheckId } from '@bindings/ApprovalCheckId';
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import type { Deal } from '@bindings/Deal';
import { WalletError } from '../../lib/contract';
import { boundLine, checksNowLabel } from './review/Checks';

const hoisted = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../lib/runtime', () => ({ backend: () => ({ kind: 'tauri', invoke: hoisted.invoke, listen: vi.fn(async () => () => {}) }) }));
const session = { tokenReady: true, tokenError: null, pending: null as string | null, unlocking: false, unlockError: null, settings: { n: 0 } as unknown, settingsLocked: false, lockedByError: false, call: vi.fn(), unlock: vi.fn(), refreshSettings: vi.fn() };
vi.mock('./session', () => ({ useSession: () => session }));
vi.mock('./selection', () => ({ useHandoff: () => null }));

const { DealReview } = await import('./DealReview');

const HASH = Array.from({ length: 32 }, (_, i) => i) as ApprovalSummary['terms_hash'];
const IDS: ApprovalCheckId[] = ['amount', 'payee', 'host', 'invoice', 'shield', 'mandate'];
const checks = (wait: ApprovalCheckId[]): ApprovalCheck[] => IDS.map((id) => ({ id, status: wait.includes(id) ? 'wait' : 'pass', text: `${id} line`, detail: `${id} detail` }));

const deal = (state: Deal['state']): Deal => ({
  id: '01JDTESTDEAL0000000000000Q', kind: 'haggle', side: 'buyer', counterparty: 'kp_dan',
  terms: { item_ref: 'monitor', qty: 1, unit_price: { minor: 32900, currency: 'USD' }, currency: 'USD', delivery: { type: 'digital_now' } },
  state, mandate_id: 'M14', mandate_version: 3, transcript_head: HASH,
  paypal: { order: null, authorization: null, capture: null, subscription: null }, mode: 'sandbox', market: null, shield: 'CLEAR',
});
const summary = (state: Deal['state'], list: ApprovalCheck[]): ApprovalSummary => ({
  deal: deal(state), evidence: { deal_id: 'x', receipt: 'NONE', reconciliation: 'not_applicable' }, attempt: 1, terms_hash: HASH,
  counter_hash: state === 'NEGOTIATING' ? HASH : null, can_owner_accept: state === 'NEGOTIATING', locked: false, can_release: false,
  can_open_paypal: false, unavailable_reason: null, checks: list, checks_hash: HASH,
});

// What Maya sees: four lines pass, two are checked later. After her accept the wallet's list moves on.
const SAW = checks(['host', 'invoice']);
const NOW = checks(['host']);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  hoisted.invoke.mockReset();
  session.call.mockReset();
});

describe('a decision names the checklist it was bound to', () => {
  it('after holding “Approve $329.00” the window names the list she saw, not the one that reads now', async () => {
    const before = summary('NEGOTIATING', SAW);
    const after = summary('AGREED', NOW);
    let decided = false;
    hoisted.invoke.mockImplementation((cmd: string) =>
      cmd === 'approval_summary' ? Promise.resolve(decided ? after : before) : Promise.reject(new WalletError({ code: 'UNAVAILABLE', message: `${cmd} unavailable` })));
    session.call.mockImplementation(async (cmd: string) => {
      decided = true;
      return { ok: true, value: cmd === 'deal_owner_accept' ? after.deal : before.deal };
    });
    render(<DealReview dealId={before.deal.id} seed={before} />);
    // The checklist reveal ends before the money button is live.
    const hold = await waitFor(() => {
      const b = screen.getByRole('button', { name: /Hold to approve \$329\.00/ });
      expect((b as HTMLButtonElement).disabled).toBe(false);
      return b;
    }, { timeout: 4000 });
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
    fireEvent.pointerDown(hold, { button: 0 });
    act(() => { vi.advanceTimersByTime(2000); });
    vi.useRealTimers();
    expect(session.call).toHaveBeenCalledWith('deal_owner_accept', expect.anything(), true);

    const line = await screen.findByTestId('bound');
    expect(line.textContent).toBe('✓Before it went ahead, the wallet checked again that these are the checks you saw (4 of 6 passed · 2 checked later), and recorded them with your decision.');
    // Past the decision the fold is the wallet's list as it reads now, under its own name.
    const fold = await screen.findByRole('button', { name: /The wallet’s checks now/ });
    expect(fold.textContent).toBe('The wallet’s checks now · 5 of 6 passed · 1 checked later ›');
    expect(document.body.textContent).not.toMatch(/before you decided/);
  });

  it('a deal that ended with no decision never calls its checklist the one “before you decided”', async () => {
    const ended = summary('EXPIRED', NOW);
    hoisted.invoke.mockImplementation((cmd: string) =>
      cmd === 'approval_summary' ? Promise.resolve(ended) : Promise.reject(new WalletError({ code: 'UNAVAILABLE', message: `${cmd} unavailable` })));
    render(<DealReview dealId={ended.deal.id} seed={ended} />);
    await screen.findByRole('button', { name: /The wallet’s checks now · 5 of 6 passed · 1 checked later/ });
    expect(document.body.textContent).not.toMatch(/before you decided/);
    expect(screen.queryByTestId('bound')).toBeNull();
  });
});

describe('the bound line', () => {
  it('names the tally of the list the owner saw, for every decision bound to a checklist', () => {
    for (const cmd of ['deal_owner_accept', 'deal_countersign', 'deal_capture', 'shield_release', 'rescue_approve'] as const) {
      expect(boundLine(cmd, SAW, false)).toMatch(/the checks you saw \(4 of 6 passed · 2 checked later\)/);
    }
  });
  it('a release of a hold needs no checklist, and the read of a lost hold decides nothing: no line', () => {
    expect(boundLine('deal_void', SAW, false)).toBeNull();
    expect(boundLine('deal_countersign', SAW, true)).toBeNull();
  });
  it('the fold says it is the list now', () => {
    expect(checksNowLabel(NOW)).toBe('The wallet’s checks now · 5 of 6 passed · 1 checked later ›');
  });
});

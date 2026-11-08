// After the owner holds a decision the wallet carries out, the window says which checklist it was
// bound to: the one the owner saw, which the wallet checked again before going ahead and recorded
// with the decision (table-runtime service.rs decide / record_decision). The line is read back from
// that record (ApprovalSummary.decided), never from what the window remembers. Once the deal is past the
// decision, the folded checklist is the wallet's list as it reads now, and says so: it is never
// called the checks "before you decided" (a deal can expire or be withdrawn with no decision at all).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalCheck } from '@bindings/ApprovalCheck';
import type { ApprovalCheckId } from '@bindings/ApprovalCheckId';
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import type { Deal } from '@bindings/Deal';
import { WalletError } from '../../lib/contract';
import type { ApprovalDecided } from '@bindings/ApprovalDecided';
import { checksNowLabel } from './review/Checks';
import { decidedText } from './review/decided';
import { shownTime } from '../main/deal/shown';

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
const AT = 1_793_000_000;
const recorded = (operation: ApprovalDecided['operation'], same: boolean): ApprovalDecided => ({
  decision: 'deal_owner_accept', operation, at: AT, checks_hash: HASH, same_now: same, signed: true, checks: SAW,
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  hoisted.invoke.mockReset();
  session.call.mockReset();
});

describe('a decision names the checklist it was bound to', () => {
  it('after holding “Approve $329.00” the window names the list she saw, not the one that reads now', async () => {
    const before = summary('NEGOTIATING', SAW);
    const after = { ...summary('AGREED', NOW), decided: recorded('accept', false) };
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
    expect(line.textContent).toBe(`✓You accepted their offer at ${shownTime(AT, Math.floor(Date.now() / 1000))} on the checks shown (4 of 6 passed · 2 checked later), recorded with your decision. The list has changed since.`);
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
  it('names the recorded decision, its time and the tally of the list recorded with it', () => {
    const now = AT + 60;
    expect(decidedText(recorded('create', true), now)).toBe(`You approved the order at ${shownTime(AT, now)} on the checks shown (4 of 6 passed · 2 checked later), recorded with your decision. Unchanged since.`);
    expect(decidedText(recorded('hand_off', false), now)).toMatch(/^You opened PayPal at .* The list has changed since\.$/);
    // An older record kept only the list's fingerprint: the line says when, not a tally it can't know.
    expect(decidedText({ ...recorded('capture', true), checks: null }, now)).toBe(`You approved the payment at ${shownTime(AT, now)}, on the checks shown then. Unchanged since.`);
  });
  it('the fold says it is the list now', () => {
    expect(checksNowLabel(NOW)).toBe('The wallet’s checks now · 5 of 6 passed · 1 checked later ›');
  });
});

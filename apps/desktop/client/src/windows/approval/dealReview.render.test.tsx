// A failed refresh after the first read: the review says the wallet stopped answering instead of
// showing the last read as if it were current, and clears the notice on the next good read.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import { WalletError } from '../../lib/contract';

const hoisted = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../lib/runtime', () => ({ backend: () => ({ kind: 'tauri', invoke: hoisted.invoke, listen: vi.fn(async () => () => {}) }) }));
const session = { tokenReady: true, tokenError: null, pending: null as string | null, unlocking: false, unlockError: null, settings: { n: 0 } as unknown, settingsLocked: false, lockedByError: false, call: vi.fn(), unlock: vi.fn(), refreshSettings: vi.fn() };
vi.mock('./session', () => ({ useSession: () => session }));
vi.mock('./selection', () => ({ useHandoff: () => null }));

const { DealReview } = await import('./DealReview');

const HASH = Array.from({ length: 32 }, (_, i) => i) as ApprovalSummary['terms_hash'];
const summary = {
  deal: {
    id: '01JDTESTDEAL0000000000000Q', kind: 'purchase', side: 'buyer', counterparty: 'kp_test',
    terms: { item_ref: 'dock', qty: 1, unit_price: { minor: 6400, currency: 'USD' }, currency: 'USD', delivery: { type: 'digital_now' } },
    state: 'AWAITING_APPROVAL', mandate_id: 'M1', mandate_version: 3, transcript_head: HASH,
    paypal: { order: 'ORD1', authorization: null, capture: null, subscription: null }, mode: 'sandbox', market: null, shield: 'CLEAR',
  },
  evidence: { deal_id: 'x', receipt: 'NONE', reconciliation: 'not_applicable' },
  attempt: 1, terms_hash: HASH, locked: false, can_release: true, can_open_paypal: true, unavailable_reason: null,
  checks: [{ id: 'amount', status: 'pass', text: 'amount line', detail: 'amount detail' }], checks_hash: HASH,
} as unknown as ApprovalSummary;
const STOPPED = /wallet stopped answering/i;

afterEach(() => { cleanup(); hoisted.invoke.mockReset(); session.settings = { n: 0 }; });

function route(summaryAnswer: () => Promise<unknown>) {
  hoisted.invoke.mockImplementation((cmd: string) => (cmd === 'approval_summary' ? summaryAnswer() : Promise.reject(new WalletError({ code: 'UNAVAILABLE', message: `${cmd} unavailable` }))));
}

describe('the review after its first read', () => {
  it('says the wallet stopped answering when a later read fails, without the raw message, and clears it on a good read', async () => {
    let answers = 0;
    route(() => (++answers === 2 ? Promise.reject(new WalletError({ code: 'UNAVAILABLE', message: 'approval_summary raw failure' })) : Promise.resolve(summary)));
    const view = <DealReview dealId={summary.deal.id} seed={summary} />;
    const { rerender, container } = render(view);
    await waitFor(() => expect(hoisted.invoke.mock.calls.some((c) => c[0] === 'approval_summary')).toBe(true));
    expect(screen.queryByText(STOPPED)).toBeNull();
    session.settings = { n: 1 };
    rerender(view);
    await screen.findByText(STOPPED);
    expect(container.textContent).not.toContain('approval_summary raw failure');
    session.settings = { n: 2 };
    rerender(view);
    await waitFor(() => expect(screen.queryByText(STOPPED)).toBeNull());
  });
});

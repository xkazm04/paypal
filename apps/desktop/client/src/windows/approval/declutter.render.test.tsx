// The decluttered review (spark perfection-ten A3): the must-stay-visible lines are in the page text
// without a click, the decision reads before the reference material, and nothing that was safety
// text moved behind an (i).
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import { WalletError } from '../../lib/contract';
import { APPROVAL_SHORT } from '../../lib/words';

const hoisted = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../lib/runtime', () => ({ backend: () => ({ kind: 'tauri', invoke: hoisted.invoke, listen: vi.fn(async () => () => {}) }) }));
const session = { tokenReady: true, tokenError: null, pending: null as string | null, unlocking: false, unlockError: null, settings: { n: 0 } as unknown, settingsLocked: false, lockedByError: false, call: vi.fn(), unlock: vi.fn(), refreshSettings: vi.fn() };
vi.mock('./session', () => ({ useSession: () => session }));
vi.mock('./selection', () => ({ useHandoff: () => null }));

const { DealReview } = await import('./DealReview');

const HASH = Array.from({ length: 32 }, (_, i) => i) as ApprovalSummary['terms_hash'];
const CHECKS = [
  { id: 'amount', status: 'pass', text: 'Their latest offer is $64.00, the price you are approving.', detail: 'd' },
  { id: 'payee', status: 'pass', text: 'Paid only to the payee their wallet declared when you connected.', detail: 'd' },
  { id: 'shield', status: 'pass', text: 'Scam check: looks safe.', detail: 'd' },
  { id: 'limit', status: 'ask', text: 'Above your ask-me limit of $50.00, so it is your call.', detail: 'd' },
  { id: 'order', status: 'pass', text: 'The order number is new for this try (1 of 3).', detail: 'd' },
  { id: 'terms', status: 'pass', text: 'The terms match the deal your agent agreed.', detail: 'd' },
];
const summary = {
  deal: {
    id: '01JDTESTDEAL0000000000000Q', kind: 'purchase', side: 'buyer', counterparty: 'kp_test',
    terms: { item_ref: 'dock', qty: 1, unit_price: { minor: 6400, currency: 'USD' }, currency: 'USD', delivery: { type: 'digital_now' } },
    state: 'AGREED', mandate_id: 'M1', mandate_version: 3, transcript_head: HASH,
    paypal: { order: null, authorization: null, capture: null, subscription: null }, mode: 'sandbox', market: null, shield: 'CLEAR',
  },
  evidence: { deal_id: 'x', receipt: 'NONE', reconciliation: 'not_applicable' },
  attempt: 1, terms_hash: HASH, locked: false, can_release: true, can_open_paypal: true, unavailable_reason: null,
  checks: CHECKS, checks_hash: HASH,
} as unknown as ApprovalSummary;

afterEach(() => { cleanup(); hoisted.invoke.mockReset(); });

describe('the decluttered review', () => {
  it('keeps every checklist line and "if you do nothing" on the page, ahead of the reference material', async () => {
    hoisted.invoke.mockImplementation((cmd: string) => (cmd === 'approval_summary' ? Promise.resolve(summary) : Promise.reject(new WalletError({ code: 'UNAVAILABLE', message: `${cmd} unavailable` }))));
    const { container } = render(<DealReview dealId={summary.deal.id} seed={summary} />);
    // The checking reveal shows one line per tick; once it is done, every line is in the page text.
    await waitFor(() => expect(container.querySelector('.dr.phase-checking')).toBeNull(), { timeout: 4000 });
    const text = container.textContent ?? '';
    for (const c of CHECKS) expect(text).toContain(c.text);
    expect(text).toContain('If you do nothing');
    // No checklist line or deadline line sits in the quieter reference block.
    const aside = container.querySelector(`[aria-label="${APPROVAL_SHORT.aside}"]`);
    expect(aside).not.toBeNull();
    for (const c of CHECKS) expect(aside?.textContent ?? '').not.toContain(c.text);
    expect(aside?.textContent ?? '').not.toContain('If you do nothing');
    // The checks come before the reference block in reading order.
    const checks = container.querySelector('.dr-checks');
    expect(checks && aside ? checks.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING : 0).toBeTruthy();
    // Nothing is settling before any decision.
    expect(container.querySelector('.dr.settled')).toBeNull();
  });
});

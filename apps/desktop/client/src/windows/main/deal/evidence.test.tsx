// The owner's statement check is offered on a deal that ended UNCONFIRMED too, and says what it
// needs when the wallet has no PayPal keys instead of a button that fails (deal-to-settlement A).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../lib/contract';
import { STATEMENT_CHECK_NEEDS_KEYS, unconfirmedMeans } from '../../../lib/words';
import { mockBackend, resetMockState } from '../../../mock/backend';
import { buildMockState } from '../../../mock/fixtures';
import { ToastProvider } from '../ui';
import { EvidenceSheet } from './Evidence';

const hoisted = vi.hoisted(() => ({ current: null as Backend | null }));
vi.mock('../../../lib/runtime', () => ({ backend: () => hoisted.current }));

const world = buildMockState(1_800_000_000);
const buyer = world.deals.find((d) => d.deal.side === 'buyer' && d.deal.kind !== 'purchase')!;
const CHECK = 'Check my PayPal statement';

function withKeys(configured: boolean): Backend {
  const real = mockBackend('main');
  return {
    kind: real.kind,
    label: real.label,
    listen: (e, cb) => real.listen(e, cb),
    invoke: async (cmd, args, opts) => {
      const r = await real.invoke(cmd, args, opts);
      return cmd === 'get_settings' ? ({ ...(r as object), payment_executor_configured: configured } as typeof r) : r;
    },
  };
}
const sheet = (state: 'RECEIPTED' | 'UNCONFIRMED' | 'RECONCILED', statementUnmatched?: boolean | null) => {
  const deal = { ...buyer.deal, state };
  const data = { ...buyer.evidence, receipt: 'SELLER_ATTESTED' as const, reconciliation: 'pending_reporting' as const, statement_unmatched: statementUnmatched };
  return render(<ToastProvider><EvidenceSheet kind="books" deal={deal} ev={{ data, error: null }} band={null} onFresh={() => {}} onClose={() => {}} /></ToastProvider>);
};

describe('the statement check on a deal PayPal has not confirmed', () => {
  beforeEach(() => { resetMockState(); });
  afterEach(() => { cleanup(); hoisted.current = null; });

  it('is offered on UNCONFIRMED, as it is on RECEIPTED', async () => {
    hoisted.current = withKeys(true);
    sheet('UNCONFIRMED');
    expect(await screen.findByRole('button', { name: CHECK })).not.toBeNull();
    cleanup();
    sheet('RECEIPTED');
    expect(await screen.findByRole('button', { name: CHECK })).not.toBeNull();
  });

  it('is not offered once the deal is reconciled', async () => {
    hoisted.current = withKeys(true);
    sheet('RECONCILED');
    await screen.findByRole('button', { name: 'Done' });
    expect(screen.queryByRole('button', { name: CHECK })).toBeNull();
  });

  it('shows what it needs, not a button, when the wallet has no PayPal keys', async () => {
    hoisted.current = withKeys(false);
    sheet('UNCONFIRMED');
    expect(await screen.findByText(STATEMENT_CHECK_NEEDS_KEYS)).not.toBeNull();
    expect(screen.queryByRole('button', { name: CHECK })).toBeNull();
  });
});

describe('the UNCONFIRMED end is worded by whether a statement read happened', () => {
  beforeEach(() => { resetMockState(); hoisted.current = withKeys(true); });
  afterEach(() => { cleanup(); hoisted.current = null; });

  it.each([
    [true, 'did not show the payment'],
    [false, 'did not check PayPal’s statement'],
    [null, 'has no match for it on PayPal’s statement'],
  ] as const)('read %s', async (read, phrase) => {
    sheet('UNCONFIRMED', read);
    expect(await screen.findByText(unconfirmedMeans(read), { exact: false })).not.toBeNull();
    expect(unconfirmedMeans(read)).toContain(phrase);
    // Only a read that came back unmatched may say the statement did not show it.
    expect(/did not show|never showed/.test(unconfirmedMeans(read))).toBe(read === true);
  });
});

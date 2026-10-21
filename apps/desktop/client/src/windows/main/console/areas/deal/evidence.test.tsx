// The owner's statement check is offered on a deal that ended UNCONFIRMED too, and says what it
// needs when the wallet has no PayPal keys instead of a button that fails (deal-to-settlement A).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { nowUnix } from '../../../../../lib/format';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../../../lib/contract';
import { DEAL_PROOF, DEAL_RECORD, STATEMENT_CHECK_NEEDS_KEYS, unconfirmedMeans } from '../../../../../lib/words';
import { mockBackend, resetMockState } from '../../../../../mock/backend';
import { buildMockState } from '../../../../../mock/fixtures';
import { ToastProvider } from '../../../ui';
import { EvidenceSheet, ProofPanel, TranscriptSheet, type EvidenceKind } from './Evidence';

const hoisted = vi.hoisted(() => ({ current: null as Backend | null }));
vi.mock('../../../../../lib/runtime', () => ({ backend: () => hoisted.current }));

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
const sheet = (state: 'RECEIPTED' | 'UNCONFIRMED' | 'RECONCILED', statementUnmatched?: boolean | null, kind: EvidenceKind = 'books') => {
  const deal = { ...buyer.deal, state };
  const data = { ...buyer.evidence, receipt: 'SELLER_ATTESTED' as const, reconciliation: 'pending_reporting' as const, statement_unmatched: statementUnmatched };
  return render(<ToastProvider><EvidenceSheet kind={kind} deal={deal} ev={{ data, error: null }} band={null} onFresh={() => {}} onClose={() => {}} /></ToastProvider>);
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

describe('an ended deal is never called a delay', () => {
  const DELAY = /a delay, not a doubt/;
  beforeEach(() => { resetMockState(); hoisted.current = withKeys(true); });
  afterEach(() => { cleanup(); hoisted.current = null; });

  it('the books and paypal sheets do not say it on UNCONFIRMED', async () => {
    sheet('UNCONFIRMED', true);
    await screen.findByRole('button', { name: 'Done' });
    expect(screen.queryByText(DELAY)).toBeNull();
    cleanup();
    sheet('UNCONFIRMED', true, 'paypal');
    await screen.findByRole('button', { name: 'Done' });
    expect(screen.queryByText(DELAY)).toBeNull();
  });

  it('the books sheet still says it on RECEIPTED', async () => {
    sheet('RECEIPTED');
    expect(await screen.findByText(DELAY, { exact: false })).not.toBeNull();
  });

  it('the paypal sheet shows the UNCONFIRMED words exactly once', async () => {
    sheet('UNCONFIRMED', false, 'paypal');
    await screen.findByRole('button', { name: 'Done' });
    expect(screen.getAllByText(unconfirmedMeans(false), { exact: false })).toHaveLength(1);
  });

  it('the proof panel does not say it on UNCONFIRMED', () => {
    const deal = { ...buyer.deal, state: 'UNCONFIRMED' as const };
    const data = { ...buyer.evidence, receipt: 'SELLER_ATTESTED' as const, reconciliation: 'pending_reporting' as const, statement_unmatched: true };
    render(<ProofPanel deal={deal} ev={{ data, error: null }} band={null} onOpen={() => {}} />);
    expect(screen.queryByText(DELAY)).toBeNull();
    expect(screen.getByText(unconfirmedMeans(true), { exact: false })).not.toBeNull();
  });
});

describe('a deal PayPal knows only by its subscription', () => {
  // A failed renewal waits at AGREED holding the subscriber's PayPal subscription id and no order.
  const rescue = world.deals.find((d) => d.deal.kind === 'rescue' && d.deal.state === 'AGREED')!;
  const deal = { ...rescue.deal, paypal: { order: null, authorization: null, capture: null, subscription: 'I-SUB0042' } };
  beforeEach(() => { resetMockState(); hoisted.current = withKeys(true); });
  afterEach(() => { cleanup(); hoisted.current = null; });

  it('the proof panel shows the subscription, as the card and the records sheet do, not "nothing sent"', () => {
    render(<ProofPanel deal={deal} ev={{ data: undefined, error: null }} band={null} onOpen={() => {}} />);
    expect(screen.queryByText(DEAL_PROOF.nothingSent)).toBeNull();
    expect(screen.queryByText(DEAL_PROOF.notCreated)).toBeNull();
    expect(screen.getByText(DEAL_PROOF.refs.subscription)).not.toBeNull();
  });

  it('the record sheet lists the subscription id with the other PayPal ids', async () => {
    render(<ToastProvider><TranscriptSheet deal={deal} label="the renewal" steps={[]} error={null} band={null} theirName="S-14" onClose={() => {}} /></ToastProvider>);
    await screen.findByRole('button', { name: 'Done' });
    expect(document.body.textContent).toContain('I-SUB0042');
  });

  it('a record with no messages does not claim every signature was checked', async () => {
    render(<ToastProvider><TranscriptSheet deal={deal} label="the renewal" steps={[]} error={null} band={null} theirName="S-14" onClose={() => {}} /></ToastProvider>);
    await screen.findByRole('button', { name: 'Done' });
    expect(document.body.textContent).not.toContain(DEAL_RECORD.everyChecked);
    expect(document.body.textContent).toContain(DEAL_RECORD.none);
  });
});

describe('the statement check looks where the payment can be', () => {
  afterEach(() => { cleanup(); hoisted.current = null; });

  it('reads back to the deal’s start, not only the last three days, within PayPal’s 31-day window', async () => {
    const sent: { start: number; end: number }[] = [];
    const real = withKeys(true);
    hoisted.current = { ...real, invoke: async (cmd, args, opts) => { if (cmd === 'deal_reconcile') sent.push(args as { start: number; end: number }); return real.invoke(cmd, args, opts); } } as Backend;
    const now = nowUnix();
    const old = { ...buyer.deal, state: 'RECEIPTED' as const, created_at: now - 10 * 86400, updated_at: now - 9 * 86400 };
    const data = { ...buyer.evidence, receipt: 'SELLER_ATTESTED' as const, reconciliation: 'pending_reporting' as const };
    render(<ToastProvider><EvidenceSheet kind="books" deal={old} ev={{ data, error: null }} band={null} onFresh={() => {}} onClose={() => {}} /></ToastProvider>);
    fireEvent.click(await screen.findByRole('button', { name: CHECK }));
    await waitFor(() => expect(sent).toHaveLength(1));
    const w = sent[0]!;
    expect(w.start).toBeLessThanOrEqual(old.created_at);
    expect(w.end - w.start).toBeLessThanOrEqual(31 * 86400);
  });
});

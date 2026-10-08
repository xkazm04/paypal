// T1 owner-key anchor: the owner can see and send their whole key id, and "Check a proof file" shows
// a file's owner key whole, says whether it is this wallet's own, and reads a check the file could
// not support as "not checked" rather than failed.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProofReport } from '@bindings/ProofReport';
import { keyGroups, keyMatch } from '../lib/format';
import { AUDIT_BROKEN, OWNER_KEY, PROOF_KEY_ANCHOR, PROOF_KEY_MATCH, PROOF_NOT_CHECKED, PROOF_SOME_UNCHECKED } from '../lib/words';
import { MOCK_OWNER_KEY_ID } from '../mock/fixtures';
import { mockBackend } from '../mock/backend';
import { ProofReportView } from '../windows/main/modules/book/ProofCheck';
import { OwnerKey } from './ownerKey';

const OTHER = 'a'.repeat(64);
const report = (owner: string, checks: ProofReport['checks'], verified = false): ProofReport => ({
  deal_id: '01JD0000000000000000000000' as ProofReport['deal_id'], mode: 'sandbox', owner_key_id: owner, verified, checks,
});
const ok = (id: string) => ({ id, ok: true, checked: true, detail: `${id} holds` });

describe('the owner key anchor', () => {
  afterEach(cleanup);

  it('groups a key id in fours and keeps every character', () => {
    const groups = keyGroups(MOCK_OWNER_KEY_ID);
    expect(groups).toHaveLength(16);
    expect(groups.every((g) => g.length === 4)).toBe(true);
    expect(groups.join('')).toBe(MOCK_OWNER_KEY_ID);
    expect(keyMatch(MOCK_OWNER_KEY_ID, MOCK_OWNER_KEY_ID.toUpperCase())).toBe('mine');
    expect(keyMatch(OTHER, MOCK_OWNER_KEY_ID)).toBe('other');
    expect(keyMatch(OTHER, null)).toBeNull();
  });

  it('owner facts carry the whole key id to the main and approval windows, never to the mini window', async () => {
    for (const label of ['main', 'approval'] as const) {
      const facts = await mockBackend(label).invoke('owner_facts', null);
      expect(facts.owner_key_id).toMatch(/^[0-9a-f]{64}$/);
    }
    await expect(mockBackend('tumbler').invoke('owner_facts', null)).rejects.toMatchObject({ code: 'PERMISSION' });
  });

  it('shows the whole key and copies all of it, or says to read it out when copy is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const r = render(<OwnerKey id={MOCK_OWNER_KEY_ID} />);
    expect(r.container.querySelectorAll('.key-id > span')).toHaveLength(16);
    expect(r.container.textContent).toContain(OWNER_KEY.why);
    fireEvent.click(r.getByRole('button', { name: /copy your owner key/i }));
    await waitFor(() => expect(r.container.textContent).toContain(OWNER_KEY.copied));
    expect(writeText).toHaveBeenCalledWith(MOCK_OWNER_KEY_ID);
    cleanup();
    writeText.mockRejectedValue(new Error('denied'));
    const again = render(<OwnerKey id={MOCK_OWNER_KEY_ID} />);
    fireEvent.click(again.getByRole('button', { name: /copy your owner key/i }));
    await waitFor(() => expect(again.container.textContent).toContain(OWNER_KEY.noCopy));
  });

  it('a proof file of this wallet says so; another wallet’s file asks for the comparison', () => {
    const mine = render(<ProofReportView report={report(MOCK_OWNER_KEY_ID, [ok('format')], true)} own={MOCK_OWNER_KEY_ID} />);
    expect(mine.container.querySelector('.key-id')?.textContent).toBe(MOCK_OWNER_KEY_ID);
    expect(mine.container.textContent).toContain(PROOF_KEY_MATCH.mine);
    expect(mine.container.textContent).not.toContain(PROOF_KEY_ANCHOR);
    cleanup();
    const other = render(<ProofReportView report={report(OTHER, [ok('format')], true)} own={MOCK_OWNER_KEY_ID} />);
    expect(other.container.textContent).toContain(PROOF_KEY_MATCH.other);
    cleanup();
    // This wallet's key unknown: no verdict on the key, only the comparison to make.
    const unknown = render(<ProofReportView report={report(OTHER, [ok('format')], true)} own={null} />);
    expect(unknown.container.textContent).not.toContain(PROOF_KEY_MATCH.other);
    expect(unknown.container.textContent).toContain(PROOF_KEY_ANCHOR);
  });

  it('an order record the file lacks reads "not checked", not failed, and the file is not verified', () => {
    const unchecked = { id: 'paypal_order', ok: false, checked: false, detail: 'not checked: POST /v2/checkout/orders' };
    const r = render(<ProofReportView report={report(OTHER, [ok('format'), unchecked])} own={null} />);
    expect(r.container.textContent).toContain(PROOF_SOME_UNCHECKED);
    expect(r.container.textContent).not.toContain('Some checks did not pass');
    expect(r.container.textContent).not.toContain('Every check passed');
    expect(r.container.textContent).toContain(PROOF_NOT_CHECKED);
    expect(r.getByLabelText('not checked')).toBeTruthy();
    cleanup();
    const failed = render(<ProofReportView report={report(OTHER, [unchecked, { id: 'audit', ok: false, checked: true, detail: 'row 3' }])} own={null} />);
    expect(failed.container.textContent).toContain('Some checks did not pass');
  });
});

describe('the audit trail when the records fail their link check', () => {
  it('the preview answers as the wallet does (no rows), and the words say what it means and what to do', async () => {
    const before = location.href;
    history.replaceState(null, '', '?records=broken');
    try {
      await expect(mockBackend('main').invoke('audit_page', { before: null, limit: 50 })).rejects.toMatchObject({ code: 'LEDGER_TRUST' });
    } finally {
      history.replaceState(null, '', before);
    }
    expect(AUDIT_BROKEN.todo.length).toBeGreaterThan(0);
    const text = [AUDIT_BROKEN.title, AUDIT_BROKEN.means, ...AUDIT_BROKEN.todo].join(' ');
    expect(text).not.toMatch(/\b(Rust|hash|chain|LEDGER_TRUST|audit_page|ledger|row)\b/);
    // Never a money action: the advice is to keep the files and look at PayPal.
    expect(text).not.toMatch(/refund|capture|release the hold|pay now/i);
  });
});

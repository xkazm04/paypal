// The Proof page's "Owner's checklist" on the files the page ships: each owner decision as a receipt (the
// six lines in the owner's words, the owner key's signature, the lines checked later), and the two tampers
// that break it, `checklist` and `forged decision`, each turning the owner's checklist line red in the
// report and the card that it is about. Runs the real checker on the real recorded files.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTHORITY_MANIFEST } from '@bindings/authority';
import { decisionReceipts } from '../../lib/proof/receipts';
import { SAMPLE_PROOF } from '../../lib/proof/practice';
import { HOUSE_PROOF } from '../../lib/proof/sample';
import { editsFor } from '../../lib/proof/tamper';
import { applyEdits } from '../../lib/proof/edits';
import { PROOF_RECEIPT } from '../../lib/words';
import { OwnerChecklist } from './OwnerChecklist';
import { ProofChecker } from './ProofChecker';

vi.setConfig({ testTimeout: 40_000 });
const TIMEOUT = { timeout: 30_000 };

beforeEach(() => { document.documentElement.classList.add('calm'); });
afterEach(() => { cleanup(); document.documentElement.classList.remove('calm'); });

const tampered = (text: string, id: 'checklist' | 'forged-decision'): unknown => {
  const doc: unknown = JSON.parse(text);
  const edits = editsFor(id, doc);
  if (!edits) throw new Error(`${id} is not offered on this file`);
  applyEdits(doc, edits);
  return doc;
};

describe('the receipts in a file', () => {
  it('on the practice sale: two decisions, each signed, its six lines hashing again, and the lines checked later passed before money moved', async () => {
    const r = await decisionReceipts(JSON.parse(SAMPLE_PROOF.text));
    expect(r.map((x) => [x.operation, x.linesState, x.signature, x.lines?.length])).toEqual([
      ['create', 'again', 'signed', 6],
      ['capture', 'again', 'signed', 6],
    ]);
    expect(r[0]?.later).toEqual({ waiting: 3, passed: 3, beforeMoney: true });
    expect(r[1]?.later.waiting).toBe(0);
  });

  it('read a changed line as changed, and a decision signed with another key as not the owner’s', async () => {
    const changed = await decisionReceipts(tampered(SAMPLE_PROOF.text, 'checklist'));
    expect(changed[0]?.linesState).toBe('changed');
    const forged = await decisionReceipts(tampered(SAMPLE_PROOF.text, 'forged-decision'));
    expect(forged.map((x) => x.signature)).toEqual(['signed', 'signed', 'not-owner']);
  });
});

describe('the card', () => {
  it('shows the house haggle’s accept in the owner’s words, signed by the owner key', async () => {
    const { container } = render(<OwnerChecklist document={JSON.parse(HOUSE_PROOF.text)} />);
    const section = await screen.findByRole('region', { name: PROOF_RECEIPT.head }, TIMEOUT);
    const card = container.querySelector('.pk-receipt') as HTMLElement;
    expect(within(card).getByRole('heading', { name: PROOF_RECEIPT.step.accept as string })).toBeTruthy();
    expect(within(card).getAllByRole('listitem')).toHaveLength(6);
    expect(within(card).getByText(/^Owner key signed · \d\d:\d\d$/)).toBeTruthy();
    expect(within(card).getByText(PROOF_RECEIPT.lines.again)).toBeTruthy();
    // the line for the agreed price, in the owner's words, and each line's outcome for a screen reader
    expect(within(card).getByText(/Their latest offer is \$[\d,.]+, the price you’re approving\./)).toBeTruthy();
    expect(within(card).getAllByText(/^(Passed|Checked later|Not needed):$/).length).toBe(6);
    // what the signature proves, said once, and never that a person was present
    expect(within(section).getByText(PROOF_RECEIPT.keyNote)).toBeTruthy();
    expect(section.textContent).not.toMatch(/was present|in person/i);
  });

  it('shows an older file’s decision as a fingerprint only, dashed', async () => {
    const doc = JSON.parse(SAMPLE_PROOF.text) as { audit: Array<{ action: string; detail_json: string }> };
    for (const row of doc.audit.filter((r) => r.action === 'owner.decision')) {
      const d = JSON.parse(row.detail_json) as Record<string, unknown>;
      for (const k of ['checks', 'operation', 'owner_key', 'signature']) delete d[k];
      row.detail_json = JSON.stringify(d);
    }
    const { container } = render(<OwnerChecklist document={doc} />);
    await screen.findAllByText(PROOF_RECEIPT.lines['hash-only'], {}, TIMEOUT);
    expect(container.querySelectorAll('.pk-rnote.dashed')).toHaveLength(2);
    expect(screen.getAllByText(PROOF_RECEIPT.notSigned)).toHaveLength(2);
    expect(container.querySelector('.pk-receipt.bad')).toBeNull();
  });
});

describe('on the Proof page’s checker', () => {
  const rows = (container: HTMLElement): Record<string, HTMLElement> => Object.fromEntries([...container.querySelectorAll<HTMLElement>('.pk-row')].map((r) => [r.dataset.check ?? '', r]));
  const red = (container: HTMLElement): string[] => Object.entries(rows(container)).filter(([, r]) => r.classList.contains('bad')).map(([id]) => id);
  const mount = () => render(<ProofChecker source={{ ...HOUSE_PROOF }} samples={[HOUSE_PROOF]} own={AUTHORITY_MANIFEST} ownerChecklist />);
  const checked = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Check this proof' }));
    await screen.findByText('Every check that applies passed', {}, TIMEOUT);
  };

  it('the card appears once the file is checked, and the two tampers are offered', async () => {
    const { container } = mount();
    expect(container.querySelector('.pk-owner')).toBeNull();
    await checked();
    await screen.findByRole('region', { name: PROOF_RECEIPT.head }, TIMEOUT);
    expect(screen.getByRole('button', { name: /Change what the owner saw/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add an approval the owner never gave/ })).toBeTruthy();
  });

  it('`checklist` turns the owner’s checklist red, and the card says the lines changed', async () => {
    const { container } = mount();
    await checked();
    fireEvent.click(screen.getByRole('button', { name: /Change what the owner saw/ }));
    await screen.findByText('This file does not check out', {}, TIMEOUT);
    expect(red(container)).toEqual(['audit', 'owner_saw', 'evidence']);
    await screen.findByText(PROOF_RECEIPT.lines.changed, {}, TIMEOUT);
    expect(container.querySelectorAll('.pk-receipt.bad')).toHaveLength(1);
  });

  it('`forged decision` turns only the owner’s checklist red: the record and the seal hold, the owner key does not', async () => {
    const { container } = mount();
    await checked();
    fireEvent.click(screen.getByRole('button', { name: /Add an approval the owner never gave/ }));
    await screen.findByText('This file does not check out', {}, TIMEOUT);
    expect(red(container)).toEqual(['owner_saw']);
    expect(within(rows(container).owner_saw as HTMLElement).getByText(/is not signed by the owner key/)).toBeTruthy();
    await screen.findByText(PROOF_RECEIPT.notOwner, {}, TIMEOUT);
    expect(screen.getAllByText(/^Owner key signed · /)).toHaveLength(1);
  });
});

// "Check this proof" as a person meets it: the checks tick, a tamper turns the right ones red and
// names the first, hand edits and dropped files are checked the same way, and a dashed line is never
// a pass. Runs the real checker on the real sample file (calm motion, so no pacing between lines).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AUTHORITY_MANIFEST } from '@bindings/authority';
import { CHECK_IDS } from '../../lib/proof/checks';
import { SAMPLE_PROOF } from '../../lib/proof/sample';
import { ProofChecker } from './ProofChecker';

const TIMEOUT = { timeout: 20_000 };
const mount = () => render(<ProofChecker source={{ ...SAMPLE_PROOF }} sample={{ ...SAMPLE_PROOF }} own={AUTHORITY_MANIFEST} />);
const rows = (container: HTMLElement): Record<string, HTMLElement> => Object.fromEntries([...container.querySelectorAll<HTMLElement>('.pk-row')].map((r) => [r.dataset.check ?? '', r]));
const kind = (row: HTMLElement | undefined): string => (['ok', 'bad', 'dashed', 'wait', 'now'].find((k) => row?.classList.contains(k)) ?? '');
const checked = async () => { fireEvent.click(screen.getByRole('button', { name: 'Check this proof' })); await screen.findByText('Every check that applies passed', {}, TIMEOUT); };

beforeEach(() => { document.documentElement.classList.add('calm'); });
afterEach(() => { cleanup(); document.documentElement.classList.remove('calm'); });

describe('the checks', () => {
  it('start unchecked, with nothing to tamper with until the file has been checked', () => {
    const { container } = mount();
    expect(screen.getByText('Not checked yet')).toBeTruthy();
    expect(Object.values(rows(container))).toHaveLength(CHECK_IDS.length);
    expect(Object.values(rows(container)).every((r) => kind(r) === 'wait')).toBe(true);
    expect(screen.getByText('Check the file first, then break it.')).toBeTruthy();
    for (const b of container.querySelectorAll<HTMLButtonElement>('.pk-tamper')) expect(b.disabled).toBe(true);
  });

  it('pass one by one, and a dashed line is never a pass', async () => {
    const { container } = mount();
    await checked();
    const r = rows(container);
    const kinds = Object.fromEntries(CHECK_IDS.map((id) => [id, kind(r[id])]));
    // every line that applies to the sample deal passed ...
    for (const id of ['format', 'mandate', 'transcript', 'countersign', 'authority', 'paypal_order', 'audit', 'receipt', 'owner_saw', 'permissions', 'evidence']) expect(kinds[id], id).toBe('ok');
    // ... and the five it has nothing to say about are dashed, not green
    for (const id of ['one_request', 'group', 'shield', 'house_record', 'market']) expect(kinds[id], id).toBe('dashed');
    expect(screen.getAllByText(/5 lines are dashed/).length).toBeGreaterThan(0); // shown, and announced
    // a screen reader hears each line's outcome
    expect(within(r.mandate as HTMLElement).getByText(/passed\./)).toBeTruthy();
    expect(within(r.market as HTMLElement).getByText(/not checked\./)).toBeTruthy();
    // the owner key is shown whole, with the words and colours to compare by eye
    expect(container.querySelector('.key-id')?.textContent?.replace(/\s/g, '')).toMatch(/^[0-9a-f]{64}$/);
    expect(container.querySelectorAll('.pk-print .fp')).toHaveLength(4);
    expect(screen.getByText(/Made by the same version/)).toBeTruthy();
    for (const b of container.querySelectorAll<HTMLButtonElement>('.pk-tamper')) expect(b.disabled).toBe(false);
  });
});

describe('a tamper', () => {
  it('turns exactly the right checks red, names the first and says what changed', async () => {
    const { container } = mount();
    await checked();
    fireEvent.click(screen.getByRole('button', { name: /Raise the price/ }));
    await screen.findByText('This file does not check out', {}, TIMEOUT);
    const r = rows(container);
    expect(CHECK_IDS.filter((id) => kind(r[id]) === 'bad')).toEqual(['countersign', 'paypal_order', 'receipt', 'evidence']);
    // the others that held still hold
    expect(kind(r.transcript)).toBe('ok');
    expect(kind(r.audit)).toBe('ok');
    // the first broken row is marked, in report order, and the strip names every catch
    expect(container.querySelectorAll('.pk-row.first')).toHaveLength(1);
    expect(r.countersign?.classList.contains('first')).toBe(true);
    expect(screen.getByText('First to catch it')).toBeTruthy();
    const strip = container.querySelector('.pk-caught') as HTMLElement;
    expect([...strip.querySelectorAll('.ui-chip')].map((c) => c.textContent?.replace('■', '').trim())).toEqual(['Approvals', 'PayPal’s order', 'Receipt', 'The seal']);
    expect(screen.getByText(/\$212\.00 → \$296\.80/, { selector: '.pk-changed span' })).toBeTruthy();
    // the file's facts follow the file
    expect(container.querySelector('.pk-facts')?.textContent).toContain('$296.80');
    // the seal's line says it is only the seal
    expect(within(r.evidence as HTMLElement).getByText(/any change at all breaks that seal/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check the file again' })).toBeTruthy();
  });

  it('puts the file back', async () => {
    const { container } = mount();
    await checked();
    fireEvent.click(screen.getByRole('button', { name: /Damage a signature/ }));
    await screen.findByText('This file does not check out', {}, TIMEOUT);
    expect(CHECK_IDS.filter((id) => kind(rows(container)[id]) === 'bad')).toEqual(['transcript', 'evidence']);
    fireEvent.click(screen.getByRole('button', { name: 'Put the file back' }));
    await screen.findByText('Every check that applies passed', {}, TIMEOUT);
    expect(container.querySelector('.pk-changed')).toBeNull();
  });

  it('is offered only where the file has something to change', async () => {
    const lonely = JSON.parse(SAMPLE_PROOF.text) as { closed_mandates: unknown[] };
    lonely.closed_mandates = [];
    render(<ProofChecker source={{ name: 'x.tableproof', text: JSON.stringify(lonely) }} own={null} />);
    expect((screen.getByRole('button', { name: /Pay someone else/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Raise the price/ }) as HTMLButtonElement).disabled).toBe(true); // until the first check
  });
});

describe('the person’s own edits and files', () => {
  it('checks a hand edit of the file’s text', async () => {
    const { container } = mount();
    await checked();
    fireEvent.click(screen.getByRole('button', { name: 'Edit the file yourself' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go to the price' }));
    const text = container.querySelector('.pk-text') as HTMLTextAreaElement;
    expect(text.value.slice(text.selectionStart, text.selectionEnd)).toBe('21200');
    fireEvent.change(text, { target: { value: text.value.slice(0, text.selectionStart) + '19900' + text.value.slice(text.selectionEnd) } });
    // no button press: the checks follow the typing
    await screen.findByText('This file does not check out', {}, TIMEOUT);
    expect(CHECK_IDS.filter((id) => kind(rows(container)[id]) === 'bad')).toEqual(['countersign', 'paypal_order', 'receipt', 'evidence']);
    expect(container.querySelector('.pk-changed')?.textContent).toContain('21200 → 19900');
    // typing the old number back makes every line hold again
    fireEvent.change(text, { target: { value: text.value.replace('19900', '21200') } });
    await screen.findByText('Every check that applies passed', {}, TIMEOUT);
    expect(container.querySelector('.pk-changed')).toBeNull();
  });

  it('says plainly that a file that is not JSON is not a proof file', async () => {
    const { container } = mount();
    await checked();
    fireEvent.click(screen.getByRole('button', { name: 'Edit the file yourself' }));
    fireEvent.change(container.querySelector('.pk-text') as HTMLTextAreaElement, { target: { value: '{ not json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check the edited file' }));
    await waitFor(() => expect(container.querySelector('.pk-refused')?.textContent).toMatch(/not a proof file/), TIMEOUT);
    expect(screen.getByText(/isn’t valid JSON/)).toBeTruthy();
  });

  it('checks a file picked or dropped, and a copy the person saved comes back as the same file', async () => {
    const { container } = mount();
    const picker = container.querySelector('input[type="file"]') as HTMLInputElement;
    const tampered = JSON.parse(SAMPLE_PROOF.text) as { receipts: Array<{ amount_minor: number }> };
    tampered.receipts[0]!.amount_minor = 1;
    fireEvent.change(picker, { target: { files: [new File([JSON.stringify(tampered)], 'theirs.tableproof')] } });
    await screen.findByText('This file does not check out', {}, TIMEOUT);
    expect(CHECK_IDS.filter((id) => kind(rows(container)[id]) === 'bad')).toEqual(['receipt', 'evidence']);
    expect(container.querySelector('.pk-name .mono')?.textContent).toBe('theirs.tableproof');
    // not a proof file at all
    fireEvent.change(picker, { target: { files: [new File(['[]'], 'other.json')] } });
    await waitFor(() => expect(container.querySelector('.pk-refused')?.textContent).toMatch(/not a proof file/), TIMEOUT);
  });
});

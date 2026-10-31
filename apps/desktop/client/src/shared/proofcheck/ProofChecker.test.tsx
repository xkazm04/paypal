// "Check this proof" as a person meets it: the checks tick, a tamper turns the right ones red and
// names the first, hand edits and dropped files are checked the same way, and a dashed line is never
// a pass. Runs the real checker on the real sample file (calm motion, so no pacing between lines).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTHORITY_MANIFEST } from '@bindings/authority';
import { CHECK_IDS } from '../../lib/proof/checks';
import { BUYER_PROOF, SAMPLE_PROOF } from '../../lib/proof/practice';
import { ProofChecker } from './ProofChecker';

// the real checker runs here, and a busy machine slows it: a generous clock keeps the tests about behaviour
vi.setConfig({ testTimeout: 40_000 });
const TIMEOUT = { timeout: 30_000 };
const mount = () => render(<ProofChecker source={{ ...SAMPLE_PROOF }} samples={[SAMPLE_PROOF]} own={AUTHORITY_MANIFEST} />);
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
    // a file with no approval has no payee to swap: the button is not there at all
    expect(screen.queryByRole('button', { name: /Pay someone else/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Rewrite a market price/ })).toBeNull();
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
    expect(screen.getByText(/isn’t JSON the wallet can read/)).toBeTruthy();
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

  it('refuses a file the wallet would refuse for how it is written, which tidying it through JSON would hide', async () => {
    const { container } = mount();
    const picker = container.querySelector('input[type="file"]') as HTMLInputElement;
    const twice = SAMPLE_PROOF.text.replace('"format"', '"format": "table.proof.v2",\n  "format"');
    fireEvent.change(picker, { target: { files: [new File([twice], 'twice.tableproof')] } });
    await waitFor(() => expect(container.querySelector('.pk-refused')?.textContent).toMatch(/not a proof file/), TIMEOUT);
    expect(screen.queryByText('Every check that applies passed')).toBeNull();
    // a byte-order mark: the wallet reads bytes, and a mark is not JSON
    const marked = new File([Uint8Array.from([0xef, 0xbb, 0xbf]), SAMPLE_PROOF.text], 'marked.tableproof');
    fireEvent.change(picker, { target: { files: [marked] } });
    await waitFor(() => expect(container.querySelector('.pk-refused')?.textContent).toMatch(/not a proof file/), TIMEOUT);
    expect(screen.queryByText('Every check that applies passed')).toBeNull();
  });
});

describe('the buyer’s file and the other side', () => {
  const mountBoth = () => render(<ProofChecker source={{ ...SAMPLE_PROOF }} samples={[SAMPLE_PROOF, BUYER_PROOF]} own={AUTHORITY_MANIFEST} />);

  it('shows a line that passed only for want of anything to compare as dashed, not as a tick', async () => {
    const { container } = render(<ProofChecker source={{ ...BUYER_PROOF }} own={AUTHORITY_MANIFEST} />);
    await checked();
    const r = rows(container);
    for (const id of ['countersign', 'authority', 'paypal_order']) {
      expect(kind(r[id]), id).toBe('dashed');
      expect(within(r[id] as HTMLElement).getByText(/Nothing to check/)).toBeTruthy();
    }
    // ... while what the file does carry is checked: its messages, its record, the receipt, its seal
    for (const id of ['transcript', 'audit', 'receipt', 'evidence']) expect(kind(r[id]), id).toBe('ok');
    // and the verdict is the verifier's: every line that applies passed
    expect(screen.getAllByText('Every check that applies passed').length).toBeGreaterThan(0);
  });

  it('puts the other side’s file beside this one and says the two tell the same story', async () => {
    const { container } = mountBoth();
    expect(container.querySelector('.pk-sides')).toBeNull(); // nothing to set beside before the file is checked
    await checked();
    fireEvent.click(await screen.findByRole('button', { name: /Use: The same sale, from the buyer/ }));
    await screen.findByText('The two files tell the same story', {}, TIMEOUT);
    expect(container.querySelectorAll('.pk-alist li.ok')).toHaveLength(7);
    expect(container.querySelector('.pk-alist li.bad')).toBeNull();
  });

  it('shows the line a change is about when the files stop agreeing, and again when it is put back', async () => {
    const { container } = mountBoth();
    await checked();
    fireEvent.click(await screen.findByRole('button', { name: /Use: The same sale, from the buyer/ }));
    await screen.findByText('The two files tell the same story', {}, TIMEOUT);
    fireEvent.click(screen.getByRole('button', { name: /Raise the price/ }));
    await screen.findByText('The two files do not agree', {}, TIMEOUT);
    const bad = [...container.querySelectorAll('.pk-alist li.bad')].map((li) => li.textContent);
    expect(bad).toHaveLength(2);
    expect(bad.join(' ')).toMatch(/Each file checks out on its own/);
    expect(bad.join(' ')).toMatch(/They agree on the price/);
    fireEvent.click(screen.getByRole('button', { name: 'Put the file back' }));
    await screen.findByText('The two files tell the same story', {}, TIMEOUT);
  });

  it('says plainly when the other file is not a proof file', async () => {
    const { container } = mountBoth();
    await checked();
    const picker = container.querySelector('.pk-sides input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [new File(['{"nope":1}'], 'nope.json')] } });
    await waitFor(() => expect(container.querySelector('.pk-sides .pk-refused')?.textContent).toMatch(/not a proof file/), TIMEOUT);
  });
});

describe('the report as text', () => {
  it('copies one line per check with the checker’s own line under it, and says where it was made', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => { written.push(t); } } });
    mount();
    await checked();
    fireEvent.click(screen.getByRole('button', { name: 'Copy the report' }));
    await screen.findByText('Report copied', {}, TIMEOUT);
    const text = written[0] ?? '';
    expect(text).toContain('Every check that applies passed');
    expect(text).toMatch(/✓ The owner signed the rules this deal ran under\.\n {4}mandate 01K8W2R6Q0F4H8J2KMNPQRSTVW v2/);
    expect(text).toMatch(/– A payment the wallet checked again with PayPal was never sent a second time\.\n {4}not checked: no money step/);
    expect(text).toContain('Checked in the browser, not by the wallet.');
  });
});

describe('dropping a file', () => {
  it('on the other side’s card makes it the other side’s file; anywhere else it replaces this one', async () => {
    const { container } = render(<ProofChecker source={{ ...SAMPLE_PROOF }} samples={[SAMPLE_PROOF, BUYER_PROOF]} own={AUTHORITY_MANIFEST} />);
    await checked();
    fireEvent.drop(container.querySelector('.pk-sides') as HTMLElement, { dataTransfer: { files: [new File([BUYER_PROOF.text], 'theirs.tableproof')] } });
    await screen.findByText('The two files tell the same story', {}, TIMEOUT);
    expect(container.querySelector('.pk-name .mono')?.textContent).toBe(SAMPLE_PROOF.name); // this file stayed
    expect(container.querySelector('.pk-agreed .dim')?.textContent).toBe('theirs.tableproof');
    // anywhere else: it replaces the file being checked
    fireEvent.drop(container.querySelector('.pk-grid') as HTMLElement, { dataTransfer: { files: [new File([BUYER_PROOF.text], 'mine-now.tableproof')] } });
    await waitFor(() => expect(container.querySelector('.pk-name .mono')?.textContent).toBe('mine-now.tableproof'), TIMEOUT);
  });
});

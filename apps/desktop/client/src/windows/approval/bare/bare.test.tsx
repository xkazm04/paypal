// spark abstract-first-home round 4: the approval window's bare mode, on the mock backend (first-run world).
// It renders only the one form (no header, tab, badges, demo strip or tour); the keys form checks shape
// before it offers Save and calls the SAME privileged set_credentials (with the session token, which
// the page never shows); rules sign through mandate_sign and pairing through pairing_confirm the
// same way; a page without the approval label gets no capability and so cannot save anything.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend, WindowLabel } from '../../../lib/contract';
import { mockBackend, resetMockState } from '../../../mock/backend';
import { cleanKey, keyProblem, keysReady, pairProblem, splitPair } from './keyShape';
import { BARE_KINDS, bareHeadless, bareKind, postToHost } from './protocol';
import { ruleLines, starterKey } from './BareRules';
import { templateDraft } from '../templates';
import { BARE_GATE, BARE_KEYS, BARE_PAIRING, BARE_RULES, KEY_PROBLEM } from './words';

const h = vi.hoisted(() => ({ current: null as Backend | null, calls: [] as { cmd: string; args: unknown; token: boolean }[] }));
vi.mock('../../../lib/runtime', () => ({ backend: () => h.current }));

const { BareApp } = await import('./Bare');

const ID = 'AYSq3RDGsmBLJE-otTkBtM-jBRd1TCQwFf9RGfwddNXWz0uFU9ztymylOhRS';
const SECRET = 'EGnHDxD_qRPdaLdZz8iCr8N7_MzF-YHPTkjs6NKYQvQSBngp4PTTVWkPZRbL';
const PIN = new Date('2026-11-06T09:30:00');
const post = vi.fn();

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) });
  }
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(PIN);
  h.calls = [];
  post.mockClear();
  Object.defineProperty(window, 'opener', { configurable: true, value: { postMessage: post } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetMockState();
  localStorage.clear();
  history.replaceState(null, '', '/');
  Object.defineProperty(window, 'opener', { configurable: true, value: null });
});

/** The bare page on the first-run world, as `label` (the approval window unless a test says not). */
function open(search: string, label: WindowLabel = 'approval', prep?: (main: ReturnType<typeof mockBackend>) => Promise<void>) {
  history.replaceState(null, '', `/approval.html?first_run=1&${search}`);
  resetMockState();
  const real = mockBackend(label);
  h.current = {
    kind: real.kind, label: real.label, listen: real.listen,
    invoke: async (cmd, args, opts) => { h.calls.push({ cmd, args, token: !!opts?.token }); return real.invoke(cmd, args, opts); },
  };
  return { real, prep };
}
const sent = (cmd: string) => h.calls.filter((c) => c.cmd === cmd);
const type = (el: HTMLElement, v: string) => { fireEvent.change(el, { target: { value: v } }); fireEvent.blur(el); };

describe('the bare protocol', () => {
  it('reads the kind and the headless switch from the address, nothing else', () => {
    expect(bareKind('?bare=keys')).toBe('keys');
    expect(bareKind('?bare=rules&first_run=1')).toBe('rules');
    expect(bareKind('?bare=pairing')).toBe('pairing');
    expect(bareKind('?bare=deal')).toBeNull();
    expect(bareKind('')).toBeNull();
    expect(BARE_KINDS).toEqual(['keys', 'rules', 'pairing']);
    expect(bareHeadless('?bare=keys&head=0')).toBe(true);
    expect(bareHeadless('?bare=keys')).toBe(false);
  });

  it('posts only to its own origin (the host side pins the same literals)', () => {
    postToHost({ type: 'secure-size', height: 120 });
    postToHost({ type: 'secure-done', kind: 'keys' });
    postToHost({ type: 'secure-cancel' });
    expect(post.mock.calls).toEqual([
      [{ type: 'secure-size', height: 120 }, location.origin],
      [{ type: 'secure-done', kind: 'keys' }, location.origin],
      [{ type: 'secure-cancel' }, location.origin],
    ]);
  });
});

describe('the key shape check', () => {
  it('trims what is pasted and accepts a key-shaped value', () => {
    expect(cleanKey(`  ${ID}\n`)).toBe(ID);
    expect(keyProblem(`  ${ID}\n`)).toBeNull();
    expect(keyProblem('')).toBeNull();
  });
  it('names what is wrong: inner space, odd characters, too short, too long, the same twice', () => {
    expect(keyProblem('AYSq3 RDGsmBLJE-otTkBtM')).toBe(KEY_PROBLEM.inner);
    expect(keyProblem('AYSq3RDGsmBLJE+otTkBtM/')).toBe(KEY_PROBLEM.chars);
    expect(keyProblem('AYSq3')).toBe(KEY_PROBLEM.short);
    expect(keyProblem('A'.repeat(1025))).toBe(KEY_PROBLEM.long);
    expect(pairProblem(ID, ` ${ID} `)).toBe(KEY_PROBLEM.same);
    expect(keysReady(ID, ID)).toBe(false);
    expect(keysReady(ID, SECRET)).toBe(true);
    expect(keysReady(ID, '')).toBe(false);
  });
  it('splits both keys pasted at once, and only a clean pair', () => {
    expect(splitPair(`${ID}\n${SECRET}`)).toEqual({ id: ID, secret: SECRET });
    expect(splitPair(`${ID}\t ${SECRET}  `)).toEqual({ id: ID, secret: SECRET });
    expect(splitPair(ID)).toBeNull();
    expect(splitPair(`${ID} ${ID}`)).toBeNull();
    expect(splitPair(`${ID} short`)).toBeNull();
  });
});

describe('bare keys', () => {
  it('renders only the form: no window header, Approvals tab, badges, demo strip or tour', async () => {
    open('bare=keys');
    const { container } = render(<BareApp kind="keys" />);
    expect(await screen.findByRole('heading', { name: BARE_KEYS.title })).toBeTruthy();
    expect(container.querySelector('.aw-head, .aw-tab, .aw-demo-strip, .ui-coach, header.aw-head')).toBeNull();
    expect(screen.queryByText(/Back to The Table/)).toBeNull();
    expect(screen.queryByText(/Sandbox/)).toBeNull();
    expect(document.body.classList.contains('w-bare')).toBe(true);
    expect(screen.getByRole('link', { name: new RegExp(BARE_KEYS.get) }).getAttribute('href')).toBe(BARE_KEYS.getHref);
  });

  it('offers Save only for key-shaped, different values, then saves through the privileged call', async () => {
    open('bare=keys');
    render(<BareApp kind="keys" />);
    const id = await screen.findByLabelText(BARE_KEYS.id);
    const secret = screen.getByLabelText(BARE_KEYS.secret);
    const save = () => screen.getByRole('button', { name: BARE_KEYS.save }) as HTMLButtonElement;
    await waitFor(() => expect(sent('approval_token').length).toBeGreaterThan(0));
    expect(save().disabled).toBe(true);
    type(id, 'AYSq3 RDGs');
    expect(screen.getByText(`${BARE_KEYS.id} ${KEY_PROBLEM.inner}`)).toBeTruthy();
    type(id, `  ${ID}\n`);
    expect((id as HTMLInputElement).value).toBe(ID);
    type(secret, ID);
    expect(screen.getByText(KEY_PROBLEM.same)).toBeTruthy();
    expect(save().disabled).toBe(true);
    type(secret, SECRET);
    expect((secret as HTMLInputElement).type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: BARE_KEYS.showLabel }));
    expect((secret as HTMLInputElement).type).toBe('text');
    await waitFor(() => expect(save().disabled).toBe(false));
    await act(async () => { fireEvent.click(save()); });
    expect(await screen.findByText(BARE_KEYS.saved)).toBeTruthy();
    // The same command and gate as the approval window: only WHICH key, with the capability.
    expect(sent('set_credentials')).toEqual([{ cmd: 'set_credentials', args: 'paypal_sandbox', token: true }]);
    // The values never travel: no call carried them.
    expect(JSON.stringify(h.calls)).not.toContain(SECRET);
    expect(JSON.stringify(h.calls)).not.toContain(ID);
    expect(post).toHaveBeenCalledWith({ type: 'secure-done', kind: 'keys' }, location.origin);
  });

  it('pasting both keys into Client ID fills both fields', async () => {
    open('bare=keys');
    render(<BareApp kind="keys" />);
    const id = await screen.findByLabelText(BARE_KEYS.id);
    fireEvent.paste(id, { clipboardData: { getData: () => `${ID}\n${SECRET}` } });
    expect((id as HTMLInputElement).value).toBe(ID);
    expect((screen.getByLabelText(BARE_KEYS.secret) as HTMLInputElement).value).toBe(SECRET);
  });

  it('idle-locked: the form shows Unlock with Windows Hello instead of Save', async () => {
    open('bare=keys&locked=1');
    render(<BareApp kind="keys" />);
    expect(await screen.findByRole('button', { name: BARE_GATE.unlock })).toBeTruthy();
    expect(screen.queryByRole('button', { name: BARE_KEYS.save })).toBeNull();
  });

  it('outside the approval window there is no capability: nothing can be saved', async () => {
    open('bare=keys', 'main');
    render(<BareApp kind="keys" />);
    expect(await screen.findByText(new RegExp(BARE_GATE.token))).toBeTruthy();
    expect(screen.queryByRole('button', { name: BARE_KEYS.save })).toBeNull();
    expect(sent('set_credentials')).toEqual([]);
  });
});

describe('bare rules', () => {
  it('the starter reads as one plain line per rule (the careful starter: six)', () => {
    expect(starterKey('?template=haggle')).toBe('haggle');
    expect(starterKey('?template=nope')).toBe('careful');
    const lines = ruleLines(templateDraft('careful', PIN.getTime() / 1000, { payees: ['HOUSE'] }));
    expect(lines).toHaveLength(6);
    expect(lines.join(' · ')).toContain('$100.00');
  });

  it('signs the starter with the owner key through mandate_sign, once a payee is named', async () => {
    open('bare=rules&template=careful');
    render(<BareApp kind="rules" />);
    expect(await screen.findByRole('heading', { name: BARE_RULES.title })).toBeTruthy();
    // No wallet is connected yet, so the starter asks who they may pay before it can be signed.
    const payees = await screen.findByLabelText(BARE_RULES.payeesAsk);
    const sign = () => screen.getByRole('button', { name: BARE_RULES.sign }) as HTMLButtonElement;
    expect(sign().disabled).toBe(true);
    fireEvent.change(payees, { target: { value: 'HOUSE' } });
    await waitFor(() => expect(sign().disabled).toBe(false));
    await act(async () => { fireEvent.click(sign()); });
    expect(await screen.findByText(BARE_RULES.signed)).toBeTruthy();
    const call = sent('mandate_sign');
    expect(call).toHaveLength(1);
    expect(call[0]?.token).toBe(true);
    expect(post).toHaveBeenCalledWith({ type: 'secure-done', kind: 'rules' }, location.origin);
  });

  it('Edit opens the numbers in place, and a broken number blocks signing', async () => {
    open('bare=rules&template=careful');
    render(<BareApp kind="rules" />);
    fireEvent.change(await screen.findByLabelText(BARE_RULES.payeesAsk), { target: { value: 'HOUSE' } });
    fireEvent.click(screen.getByRole('button', { name: BARE_RULES.edit }));
    const perDeal = screen.getByLabelText(BARE_RULES.perDeal);
    fireEvent.change(perDeal, { target: { value: '' } });
    expect((screen.getByRole('button', { name: BARE_RULES.sign }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(perDeal, { target: { value: '80.00' } });
    expect(await screen.findByText(/Up to \$80\.00 per purchase/)).toBeTruthy();
  });
});

describe('bare pairing', () => {
  it('shows the four words from the wallet and confirms through pairing_confirm', async () => {
    // The Table starts the practice shop's pairing; the window is selected for it (as approval_open does).
    history.replaceState(null, '', '/index.html?first_run=1');
    resetMockState();
    const main = mockBackend('main');
    await main.invoke('house_wake', null);
    const r = await main.invoke('pairing_join', { code: 'HOUSE', side: 'buyer', payee: 'practice-buyer', peer: null });
    history.replaceState(null, '', `/approval.html?first_run=1&bare=pairing&target=pairing&pairing=${encodeURIComponent(JSON.stringify(r.pairing_id))}`);
    const real = mockBackend('approval');
    h.current = { kind: real.kind, label: real.label, listen: real.listen, invoke: async (cmd, args, opts) => { h.calls.push({ cmd, args, token: !!opts?.token }); return real.invoke(cmd, args, opts); } };
    render(<BareApp kind="pairing" />);
    expect(await screen.findByRole('heading', { name: BARE_PAIRING.title })).toBeTruthy();
    for (const w of r.words) expect(screen.getByText(w)).toBeTruthy();
    const confirm = screen.getByRole('button', { name: BARE_PAIRING.confirm }) as HTMLButtonElement;
    await waitFor(() => expect(confirm.disabled).toBe(false));
    await act(async () => { fireEvent.click(confirm); });
    expect(await screen.findByText(BARE_PAIRING.connected(BARE_PAIRING.useHouse))).toBeTruthy();
    expect(sent('pairing_confirm').map((c) => c.token)).toEqual([true]);
    expect(post).toHaveBeenCalledWith({ type: 'secure-done', kind: 'pairing' }, location.origin);
  });
});

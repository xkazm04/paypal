// The secure step's host side: the sheet in a browser on the mock world, the approval window in the
// desktop app; the bare page's address in this page's world; the message filter (own origin, own
// window, known shapes only); the sheet's and the desktop card's first states.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../../lib/contract';

const h = vi.hoisted(() => ({ current: null as Backend | null }));
vi.mock('../../../../lib/runtime', () => ({ backend: () => { if (!h.current) throw new Error('no backend'); return h.current; } }));

const { bareUrl, openArgs, readSecureMessage, secureInPage } = await import('./messages');
const { SecureStep, shownAs } = await import('./SecureStep');
const { SC } = await import('./words');

const mock = (invoke = vi.fn(async () => null)) => { h.current = { kind: 'mock', label: 'main', invoke, listen: vi.fn(async () => () => {}) } as unknown as Backend; return invoke; };

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) });
  }
});
afterEach(() => {
  cleanup();
  h.current = null;
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  history.replaceState(null, '', '/');
});

describe('where the step shows', () => {
  it('a page can show the step only in a browser on the mock world; elsewhere it is the approval window', () => {
    expect(secureInPage()).toBe(false); // no backend
    mock();
    expect(secureInPage()).toBe(true);
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    expect(secureInPage()).toBe(false);
    expect(shownAs(true)).toBe('sheet');
    expect(shownAs(false)).toBe('window');
  });
});

describe('the bare page address and the desktop fallback', () => {
  it('keys, rules (a draft or a starter) and pairing, in this page’s world', () => {
    const fr = { world: 'first_run', degrade: false, locked: false } as const;
    expect(bareUrl('keys', null, null, fr)).toBe('approval.html?bare=keys&target=credentials&first_run=1');
    const draft = JSON.stringify({ type: 'rules', agent: 'shopper', not_before: 1, expires: 2, clauses: [] });
    const r = new URLSearchParams(bareUrl('rules', draft, null, fr).split('?')[1]);
    expect(r.get('bare')).toBe('rules');
    expect(r.get('target')).toBe('mandate');
    expect(r.get('draft')).toBe(draft);
    expect(new URLSearchParams(bareUrl('rules', 'haggle', null, null).split('?')[1]).get('template')).toBe('haggle');
    expect(new URLSearchParams(bareUrl('rules', 'drop table', null, null).split('?')[1]).has('template')).toBe(false);
    const p = new URLSearchParams(bareUrl('pairing', null, '[1,2,3]', fr).split('?')[1]);
    expect([p.get('bare'), p.get('target'), p.get('pairing'), p.get('first_run')]).toEqual(['pairing', 'pairing', '[1,2,3]', '1']);
  });
  it('approval_open gets the same step', () => {
    expect(openArgs('keys', null, null)).toEqual({ deal_id: null, target: 'credentials' });
    const draft = { type: 'rules', agent: 'shopper', not_before: 1, expires: 2, clauses: [] };
    expect(openArgs('rules', JSON.stringify(draft), null)).toEqual({ deal_id: null, target: 'mandate', draft });
    expect(openArgs('rules', 'careful', null)).toEqual({ deal_id: null, target: 'mandate', draft: null });
    expect(openArgs('pairing', null, '[1,2]')).toEqual({ deal_id: null, pairing: [1, 2], target: 'pairing' });
  });
});

describe('messages from the secure page', () => {
  const from = {} as Window;
  const ev = (data: unknown, over: Partial<{ origin: string; source: unknown }> = {}) => ({ data, origin: over.origin ?? location.origin, source: (over.source ?? from) as MessageEventSource });
  it('reads the three messages from its own window and origin', () => {
    expect(readSecureMessage(ev({ type: 'secure-size', height: 321 }), from)).toEqual({ type: 'secure-size', height: 321 });
    expect(readSecureMessage(ev({ type: 'secure-done', kind: 'rules' }), from)).toEqual({ type: 'secure-done', kind: 'rules' });
    expect(readSecureMessage(ev({ type: 'secure-cancel' }), from)).toEqual({ type: 'secure-cancel' });
  });
  it('ignores another origin, another window and unknown shapes', () => {
    expect(readSecureMessage(ev({ type: 'secure-done', kind: 'keys' }, { origin: 'https://evil.example' }), from)).toBeNull();
    expect(readSecureMessage(ev({ type: 'secure-done', kind: 'keys' }, { source: {} }), from)).toBeNull();
    expect(readSecureMessage(ev({ type: 'secure-done', kind: 'deal' }), from)).toBeNull();
    expect(readSecureMessage(ev({ type: 'secure-size', height: -1 }), from)).toBeNull();
    expect(readSecureMessage(ev('secure-done'), from)).toBeNull();
    expect(readSecureMessage(ev({ type: 'secure-done', kind: 'keys' }), null)).toBeNull();
  });
});

describe('the sheet and the desktop card', () => {
  it('sheet: opens over the app at once, headless form inside, ✕ cancels and leaves a way back', async () => {
    mock();
    history.replaceState(null, '', '/index.html?first_run=1');
    const onCancel = vi.fn();
    render(<SecureStep kind="keys" draft={null} pairing={null} done={false} onCancel={onCancel} />);
    const dialog = screen.getByRole('dialog', { name: SC.sheetTitle.keys });
    const frame = dialog.querySelector('iframe');
    expect(frame?.getAttribute('src')).toBe('approval.html?bare=keys&target=credentials&first_run=1&head=0');
    expect(frame?.getAttribute('title')).toBe(SC.frameTitle('keys'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: SC.close })); });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: `${SC.sheetTitle.keys}…` })).toBeTruthy();
  });

  it('the desktop app: the step opens the real approval window through approval_open', async () => {
    const invoke = mock();
    h.current = { ...h.current!, kind: 'tauri' } as Backend;
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    history.replaceState(null, '', '/index.html');
    const { container } = render(<SecureStep kind="keys" draft={null} pairing={null} done={false} onCancel={vi.fn()} />);
    expect(container.querySelector('iframe')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: SC.open.keys })); });
    expect(invoke).toHaveBeenCalledWith('approval_open', { deal_id: null, target: 'credentials' }, undefined);
    expect(await screen.findByText(SC.waiting)).toBeTruthy();
  });
});

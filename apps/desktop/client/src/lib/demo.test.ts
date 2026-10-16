// Demo mode (polish wave, builder B): which backend a page gets, and that a demo page can never
// reach the wallet. The rule is lib/preview.ts resolveDemo (pure); lib/runtime.ts applies it once at
// startup and seals the shell's IPC in a desktop demo; the mock opens the sample approval in the
// main window's own webview, and it comes back to the route it left. No test here touches the network: fetch, XHR and WebSocket are spies
// that must stay silent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke as shellInvoke } from '@tauri-apps/api/core';
import {
  DEMO_KEY, demoFromSearch, demoNow, demoPageUrl, firstRunPreview, formatDemo, DEMO_FALLBACK_KEY, DEMO_RETURN_KEY, demoApprovalPage, leaveDemoApproval, parseDemo, pinDemo, previewSearch, resolveDemo, scalePreview, takeDemoNotice,
  withDemoSearch, type DemoEnv,
} from './preview';
import { backend, DEMO_SEALED, demoEnv, initBackend, resetBackendForTests } from './runtime';
import { fakeUlid } from '../mock/fixtures';
import { resetMockState } from '../mock/backend';

type Internals = { invoke: (cmd: string, args?: unknown, opts?: unknown) => Promise<unknown>; ipc: () => void; metadata: unknown; transformCallback: () => number };
type Win = { __TAURI_INTERNALS__?: Internals };

/** A stand-in for the shell's injected IPC: every call it receives is recorded. */
function fakeShell(): { calls: string[]; internals: Internals } {
  const calls: string[] = [];
  const internals: Internals = {
    invoke: (cmd) => { calls.push(cmd); return Promise.resolve(cmd === 'get_settings' ? { mode: 'sandbox' } : null); },
    ipc: () => { calls.push('ipc'); },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
    transformCallback: () => 0,
  };
  (window as unknown as Win).__TAURI_INTERNALS__ = internals;
  return { calls, internals };
}

class LocalChannel {
  static peers: LocalChannel[] = [];
  callback?: (event: { data: unknown }) => void;
  constructor(_name: string) { LocalChannel.peers.push(this); }
  addEventListener(_name: string, cb: (event: { data: unknown }) => void) { this.callback = cb; }
  postMessage(data: unknown) { for (const p of LocalChannel.peers) if (p !== this) p.callback?.({ data }); }
}

const env = (o: Partial<DemoEnv>): DemoEnv => ({ native: true, label: 'main', framed: false, search: '', stored: null, returnTo: null, ...o });

describe('demo choice (lib/preview.ts)', () => {
  afterEach(() => pinDemo(null));

  it('stores a world with its flags, and reads back only what it wrote', () => {
    expect(formatDemo(null)).toBe('off');
    expect(formatDemo({ world: 'large', degrade: true, locked: false })).toBe('large+degrade');
    expect(formatDemo({ world: 'first_run', degrade: true, locked: true })).toBe('first_run+degrade+locked');
    for (const w of ['small', 'large', 'first_run', 'sample'] as const) expect(parseDemo(formatDemo({ world: w, degrade: false, locked: true }))).toEqual({ world: w, degrade: false, locked: true });
    // off, absent and anything unreadable are the live wallet, never a guessed world
    for (const raw of ['off', '', null, undefined, 'huge', 'LARGE', '{"world":"large"}']) expect(parseDemo(raw)).toBeNull();
  });

  it('a browser page takes its world from the address; no parameter is the sample week', () => {
    expect(demoFromSearch('')).toEqual({ world: 'sample', degrade: false, locked: false });
    expect(demoFromSearch('?scale=large&degrade=1')).toEqual({ world: 'large', degrade: true, locked: false });
    expect(demoFromSearch('?scale=small&locked=1')).toEqual({ world: 'small', degrade: false, locked: true });
    // a brand-new wallet has nothing to scale: first_run wins, as scalePreview says
    expect(demoFromSearch('?scale=large&first_run=1').world).toBe('first_run');
    expect(scalePreview('?scale=large&first_run=1')).toBeNull();
  });

  it('rewrites only the world parameters of an address', () => {
    expect(withDemoSearch('?scale=large&records=broken', { world: 'small', degrade: false, locked: true })).toBe('?records=broken&scale=small&locked=1');
    expect(withDemoSearch('?first_run=1&degrade=1', { world: 'sample', degrade: false, locked: false })).toBe('');
    expect(withDemoSearch('', { world: 'first_run', degrade: true, locked: false })).toBe('?first_run=1&degrade=1');
  });

  it('resolveDemo: a browser is always on sample data and ignores what is stored', () => {
    expect(resolveDemo(env({ native: false, search: '?scale=large', stored: 'small' }))).toEqual({ kind: 'demo', state: { world: 'large', degrade: false, locked: false }, source: 'address' });
    expect(resolveDemo(env({ native: false, stored: 'off' }))).toMatchObject({ kind: 'demo', state: { world: 'sample' } });
  });

  it('resolveDemo: the desktop app is live unless the main window (or the sample approval it opened) was switched', () => {
    expect(resolveDemo(env({}))).toEqual({ kind: 'live' });
    expect(resolveDemo(env({ stored: 'off' }))).toEqual({ kind: 'live' });
    expect(resolveDemo(env({ stored: 'nonsense' }))).toEqual({ kind: 'live' });
    // the stored choice beats the address in the desktop app (its address carries no world)
    expect(resolveDemo(env({ stored: 'large+locked', search: '?scale=small' }))).toEqual({ kind: 'demo', state: { world: 'large', degrade: false, locked: true }, source: 'stored' });
    // the Tumbler and the real approval window never read it
    expect(resolveDemo(env({ label: 'tumbler', stored: 'large' }))).toEqual({ kind: 'live' });
    expect(resolveDemo(env({ label: 'approval', stored: 'large' }))).toEqual({ kind: 'live' });
    expect(resolveDemo(env({ label: 'approval', stored: 'large', search: '?deal=x&demo=1' }))).toEqual({ kind: 'live' });
    expect(resolveDemo(env({ label: 'approval', returnTo: '/index.html', stored: 'large', search: '?deal=x' }))).toEqual({ kind: 'live' });
    // the sample approval the demo main window frames follows it
    // the sample approval the demo main window opened in its own webview (marked, with its way back) follows it
    expect(resolveDemo(env({ label: 'approval', returnTo: '/index.html#m=book', stored: 'large', search: '?deal=x&demo=1' }))).toMatchObject({ kind: 'demo', state: { world: 'large' } });
    // a framed main window (not the app's own) stays live
    expect(resolveDemo(env({ framed: true, stored: 'large' }))).toEqual({ kind: 'live' });
  });

  it('a stored world reaches every preview reader (mock, tour, badges) through previewSearch', () => {
    history.replaceState(null, '', '/index.html?records=broken');
    pinDemo({ kind: 'demo', state: { world: 'first_run', degrade: true, locked: false }, source: 'stored' });
    expect(previewSearch()).toBe('?records=broken&first_run=1&degrade=1');
    expect(firstRunPreview()).toBe(true);
    pinDemo({ kind: 'demo', state: { world: 'large', degrade: false, locked: false }, source: 'stored' });
    expect(scalePreview()).toBe('large');
    // a browser page reads its own address, unchanged
    pinDemo({ kind: 'demo', state: { world: 'small', degrade: false, locked: false }, source: 'address' });
    expect(previewSearch()).toBe('?records=broken');
    pinDemo({ kind: 'live' });
    expect(previewSearch()).toBe('?records=broken');
    history.replaceState(null, '', '/index.html');
  });

  it('the sample approval page carries the world and the demo mark', () => {
    expect(demoPageUrl('approval.html?deal=abc&scale=large', { world: 'large', degrade: true, locked: false })).toBe('approval.html?deal=abc&scale=large&degrade=1&demo=1');
    expect(demoPageUrl('approval.html', { world: 'sample', degrade: false, locked: true })).toBe('approval.html?locked=1&demo=1');
  });
});

describe('demo backend (lib/runtime.ts)', () => {
  const net = { fetch: vi.fn(), xhr: vi.fn(), ws: vi.fn() };
  beforeEach(() => {
    resetBackendForTests();
    LocalChannel.peers = [];
    vi.stubGlobal('BroadcastChannel', LocalChannel);
    net.fetch = vi.fn(() => Promise.reject(new Error('network')));
    net.xhr = vi.fn();
    net.ws = vi.fn();
    vi.stubGlobal('fetch', net.fetch);
    vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(net.xhr);
    vi.stubGlobal('WebSocket', net.ws);
    vi.spyOn(window, 'open').mockImplementation(() => null);
    localStorage.clear(); sessionStorage.clear(); resetMockState();
    history.replaceState(null, '', '/index.html');
  });
  afterEach(() => {
    resetBackendForTests();
    delete (window as unknown as Win).__TAURI_INTERNALS__;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('desktop app, demo off: the real shell, every call reaches it', async () => {
    const shell = fakeShell();
    const b = await initBackend('main', env({ stored: 'off' }));
    expect(b.kind).toBe('tauri');
    await b.invoke('get_settings', null);
    expect(shell.calls).toEqual(['get_settings']);
    expect(demoNow()).toEqual({ native: true, state: null });
  });

  it('desktop app, demo on: the shell is never reached, by the backend or by any direct import', async () => {
    const shell = fakeShell();
    localStorage.setItem(DEMO_KEY, 'large');
    const go = vi.fn();
    history.replaceState(null, '', '/index.html#m=book');
    const b = await initBackend('main', demoEnv('main'), { go });
    expect(b.kind).toBe('mock');
    expect(demoNow()).toEqual({ native: true, state: { world: 'large', degrade: false, locked: false } });
    const s = await b.invoke('get_settings', null);
    expect(s.mode).toBeDefined();
    const deals = await b.invoke('list_deals', null);
    expect(deals.length).toBeGreaterThan(100); // the busy merchant's world, not the live wallet
    await expect(shellInvoke('get_settings')).rejects.toMatchObject({ message: DEMO_SEALED });
    await expect(shell.internals.invoke('deal_countersign')).rejects.toMatchObject({ message: DEMO_SEALED });
    expect(shell.calls).toEqual([]);
    // the approval hand-off goes to the sample approval in this webview, never a window, and
    // leaves the way back (the route included) in this webview's session
    const top = (await b.invoke('attention_list', null)).items[0];
    await b.invoke('approval_open', { deal_id: top?.deal_id ?? null });
    expect(window.open).not.toHaveBeenCalled();
    expect(go).toHaveBeenCalledTimes(1);
    expect(go.mock.calls[0]?.[0]).toMatch(/^approval\.html\?deal=.+&scale=large&demo=1$/);
    expect(sessionStorage.getItem(DEMO_RETURN_KEY)).toBe('/index.html#m=book');
    expect(shell.calls).toEqual([]);
    expect(net.fetch).not.toHaveBeenCalled();
    expect(net.xhr).not.toHaveBeenCalled();
    expect(net.ws).not.toHaveBeenCalled();
  });

  it('switching demo off (a reload) gives the page the real shell again', async () => {
    fakeShell();
    await initBackend('main', env({ stored: 'small' }));
    expect(backend().kind).toBe('mock');
    // the switcher stores "off" and reloads: a fresh page with a fresh shell
    resetBackendForTests();
    const shell = fakeShell();
    const b = await initBackend('main', env({ stored: 'off' }));
    expect(b.kind).toBe('tauri');
    await b.invoke('get_settings', null);
    expect(shell.calls).toEqual(['get_settings']);
  });

  it('the Tumbler and the real approval window stay live whatever the main window chose', async () => {
    for (const label of ['tumbler', 'approval'] as const) {
      resetBackendForTests();
      const shell = fakeShell();
      const b = await initBackend(label, env({ label, stored: 'large' }));
      expect(b.kind).toBe('tauri');
      await b.invoke('get_settings', null);
      expect(shell.calls).toEqual(['get_settings']);
    }
  });

  it('a sample approval inside the demo: approving on the mock is simulated, nothing reaches the shell or the network', async () => {
    const shell = fakeShell();
    const id = fakeUlid('D-0193');
    history.replaceState(null, '', `/approval.html?deal=${id}&demo=1`);
    sessionStorage.setItem(DEMO_RETURN_KEY, '/index.html#d=x');
    const go = vi.fn();
    const a = await initBackend('approval', env({ label: 'approval', search: location.search, stored: 'sample', returnTo: '/index.html#d=x' }), { go });
    expect(a.kind).toBe('mock');
    const token = await a.invoke('approval_token', null);
    const s = await a.invoke('approval_summary', { deal_id: id });
    const d = await a.invoke('deal_owner_accept', { deal_id: id, attempt: s.attempt, terms_hash: s.terms_hash, counter_hash: s.counter_hash, checks_hash: s.checks_hash }, { token });
    expect(d.decided_by).toMatchObject({ type: 'human' });
    expect(shell.calls).toEqual([]);
    expect(net.fetch).not.toHaveBeenCalled();
    expect(net.xhr).not.toHaveBeenCalled();
    expect(net.ws).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
  });

  it('Back to The Table on the sample approval returns to the route it was opened from, once', async () => {
    fakeShell();
    history.replaceState(null, '', '/approval.html?demo=1');
    sessionStorage.setItem(DEMO_RETURN_KEY, '/index.html#p=rules');
    await initBackend('approval', env({ label: 'approval', search: location.search, stored: 'small', returnTo: '/index.html#p=rules' }));
    expect(demoApprovalPage()).toBe(true);
    const go = vi.fn();
    expect(leaveDemoApproval(go)).toBe(true);
    expect(go).toHaveBeenCalledWith('/index.html#p=rules');
    expect(demoApprovalPage()).toBe(false);
    expect(leaveDemoApproval(go)).toBe(false);
  });

  it('the real approval window is never the sample approval: no way back, its close stays its own', async () => {
    fakeShell();
    history.replaceState(null, '', '/approval.html?deal=x');
    const b = await initBackend('approval', env({ label: 'approval', search: location.search, stored: 'large' }));
    expect(b.kind).toBe('tauri');
    expect(demoApprovalPage()).toBe(false);
    expect(leaveDemoApproval(vi.fn())).toBe(false);
  });

  it('desktop app: when the sample data cannot load, it clears the choice, reloads once into live and notes it once', async () => {
    const shell = fakeShell();
    localStorage.setItem(DEMO_KEY, 'large');
    const reload = vi.fn();
    const loadMock = () => Promise.reject(new Error('chunk missing'));
    void initBackend('main', demoEnv('main'), { loadMock, reload });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(DEMO_KEY)).toBe('off');
    expect(sessionStorage.getItem(DEMO_FALLBACK_KEY)).toBe('1');
    resetBackendForTests();
    const b = await initBackend('main', demoEnv('main'), { loadMock, reload });
    expect(b.kind).toBe('tauri');
    expect(reload).toHaveBeenCalledTimes(1);
    await b.invoke('get_settings', null);
    expect(shell.calls).toEqual(['get_settings']);
    expect(sessionStorage.getItem(DEMO_FALLBACK_KEY)).toBeNull();
    expect(takeDemoNotice()).toBe(true);
    expect(takeDemoNotice()).toBe(false);
  });

  it('no reload loop: a second failure in the same session goes live in place', async () => {
    const shell = fakeShell();
    sessionStorage.setItem(DEMO_FALLBACK_KEY, '1');
    const reload = vi.fn();
    const b = await initBackend('main', env({ stored: 'small' }), { loadMock: () => Promise.reject(new Error('chunk missing')), reload });
    expect(reload).not.toHaveBeenCalled();
    expect(b.kind).toBe('tauri');
    await b.invoke('get_settings', null);
    expect(shell.calls).toEqual(['get_settings']);
    expect(demoNow()).toEqual({ native: true, state: null });
  });

  it('a browser preview keeps its windows (the director frames them) and its address', async () => {
    history.replaceState(null, '', '/index.html?scale=small');
    const b = await initBackend('main', env({ native: false, framed: true, search: location.search }));
    expect(b.kind).toBe('mock');
    expect(demoNow()).toEqual({ native: false, state: { world: 'small', degrade: false, locked: false } });
    await b.invoke('approval_open', { deal_id: null });
    expect(window.open).toHaveBeenCalledWith('approval.html?scale=small', 'the-table-approval', 'width=744,height=660');
  });

  it('a browser preview, top level: the sample approval opens in place of the main page', async () => {
    history.replaceState(null, '', '/index.html?scale=small#w=waiting');
    const go = vi.fn();
    const b = await initBackend('main', env({ native: false, search: location.search }), { go });
    await b.invoke('approval_open', { deal_id: null });
    expect(window.open).not.toHaveBeenCalled();
    expect(go).toHaveBeenCalledWith('approval.html?scale=small&demo=1');
    expect(sessionStorage.getItem(DEMO_RETURN_KEY)).toBe('/index.html?scale=small#w=waiting');
  });

  it('a browser load error is not hidden: no fallback outside the desktop app', async () => {
    await expect(initBackend('main', env({ native: false }), { loadMock: () => Promise.reject(new Error('chunk missing')), reload: vi.fn() })).rejects.toThrow('chunk missing');
  });
});

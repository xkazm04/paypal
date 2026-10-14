// A part that throws while drawing shows the calm fallback (never the error, a stack or a name),
// "Try again" draws it again and reads again what failed; a route change resets it; uncaught errors
// and rejections go to the console only. Drawing only: nothing here moves money.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOUNDARY_RETRY, BOUNDARY_TEXT, BOUNDARY_TITLE, BOUNDARY_WINDOW_TITLE, LAYER_LOADING } from '../../lib/words';
import { WalletError } from '../../lib/contract';
import { createDataClient } from '../../lib/data/client';
import { DataProvider } from '../../lib/data/provider';
import { ErrorBoundary, installErrorLogging, LayerSuspense } from './index';
import { staleBannerOf } from './staleBanner';

const ctl = { throws: true };
function Fragile() {
  if (ctl.throws) throw new Error('get_settings exploded at Rust frame 7');
  return <p>drawn</p>;
}

let logged: unknown[][] = [];
beforeEach(() => {
  ctl.throws = true;
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { logged.push(a); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ErrorBoundary', () => {
  it('shows the calm fallback and no internals, and Try again recovers', () => {
    render(<ErrorBoundary layer="panel"><Fragile /></ErrorBoundary>);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(BOUNDARY_TITLE);
    expect(alert.textContent).toContain(BOUNDARY_TEXT);
    expect(alert.textContent).not.toMatch(/exploded|Rust|get_settings|Error|Fragile|frame/);
    // the failure went to the console
    expect(logged.some((a) => String(a[0]).includes('[boundary:panel]'))).toBe(true);
    ctl.throws = false;
    fireEvent.click(screen.getByRole('button', { name: BOUNDARY_RETRY }));
    expect(screen.getByText('drawn')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('the window layer says the window; a still-failing retry shows the fallback again', () => {
    render(<ErrorBoundary layer="window"><Fragile /></ErrorBoundary>);
    expect(screen.getByRole('alert').textContent).toContain(BOUNDARY_WINDOW_TITLE);
    fireEvent.click(screen.getByRole('button', { name: BOUNDARY_RETRY }));
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('a change of its reset keys (a route) draws the children again', () => {
    const r = render(<ErrorBoundary layer="view" resetKeys={['home']}><Fragile /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toBeTruthy();
    ctl.throws = false;
    r.rerender(<ErrorBoundary layer="view" resetKeys={['book']}><Fragile /></ErrorBoundary>);
    expect(screen.getByText('drawn')).toBeTruthy();
  });

  it('Try again reads again only the reads that failed', async () => {
    const client = createDataClient({ retry: false });
    const failed = vi.fn(() => Promise.reject(new WalletError({ code: 'UNAVAILABLE', message: 'x' })));
    const fine = vi.fn(() => Promise.resolve(1));
    await client.prefetchQuery({ queryKey: ['bad'], queryFn: failed });
    await client.prefetchQuery({ queryKey: ['good'], queryFn: fine });
    render(<DataProvider client={client}><ErrorBoundary layer="panel"><Fragile /></ErrorBoundary></DataProvider>);
    ctl.throws = false;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: BOUNDARY_RETRY })); });
    expect(failed).toHaveBeenCalledTimes(2);
    expect(fine).toHaveBeenCalledTimes(1);
  });
});

describe('LayerSuspense', () => {
  it('shows a calm loading line while a part loads, then the part', async () => {
    let resolve: () => void = () => {};
    const ready = new Promise<void>((r) => { resolve = r; });
    let done = false;
    void ready.then(() => { done = true; });
    function Lazy() {
      if (!done) throw ready;
      return <p>loaded</p>;
    }
    render(<LayerSuspense layer="view"><Lazy /></LayerSuspense>);
    expect(screen.getByRole('status').textContent).toBe(LAYER_LOADING);
    await act(async () => { resolve(); await ready; });
    expect(await screen.findByText('loaded')).toBeTruthy();
  });
});

describe('installErrorLogging', () => {
  it('logs uncaught errors and unhandled rejections to the console, and uninstalls', () => {
    const off = installErrorLogging(window);
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('boom'), message: 'boom' }));
    const rej = new Event('unhandledrejection') as Event & { reason?: unknown };
    rej.reason = 'nope';
    window.dispatchEvent(rej);
    expect(logged.some((a) => a[0] === '[window:error]')).toBe(true);
    expect(logged.some((a) => a[0] === '[window:unhandledrejection]' && a[1] === 'nope')).toBe(true);
    off();
    const before = logged.filter((a) => a[0] === '[window:error]').length;
    window.dispatchEvent(new ErrorEvent('error', { message: 'later' }));
    expect(logged.filter((a) => a[0] === '[window:error]').length).toBe(before);
  });
});

describe('the stale banner contract', () => {
  const err = new WalletError({ code: 'UNAVAILABLE', message: 'attention_list timed out' });
  it('is null when every read answered', () => {
    expect(staleBannerOf({ settings: { error: null, hasData: true }, deals: { error: null, hasData: true } })).toBeNull();
  });
  it('says out of date when an older answer is shown, naming the parts in plain words', () => {
    const b = staleBannerOf({ attention: { error: err, hasData: true }, runs: { error: err, hasData: true }, deals: { error: null, hasData: true } });
    expect(b).toMatchObject({ kind: 'stale', parts: ['what needs you', 'your agents'], retry: true });
    expect(b?.text).toMatch(/If you do nothing, no money moves/);
    expect(JSON.stringify(b)).not.toMatch(/UNAVAILABLE|attention_list|timed out/);
  });
  it('says not available yet when a part never answered (never a zero)', () => {
    const b = staleBannerOf({ deals: { error: err, hasData: false }, settings: { error: err, hasData: true } });
    expect(b?.kind).toBe('unread');
    expect(b?.parts).toEqual(['your deals', 'your settings']);
  });
});

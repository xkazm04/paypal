// Live mode against a mocked fetch: no sandbox reads as the recorded cards and is asked again only on
// focus or "Connect my agent app" (never on a timer), a sandbox that answers reads as live with the
// agent's tool calls mapped from its journal, a note is POSTed with the bridge's header, and nothing is
// ever sent under the director, a take or the desktop app. No socket is opened.
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_PORT, sendLiveNote, useLive } from './live';
import { askForLive, LIVE_ASK_EVENT, liveApplies } from './liveReach';

const BASE = 'http://127.0.0.1:1443';

type Call = { url: string; init: RequestInit | undefined };
let calls: Call[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const ENTRIES = [
  { seq: 1, at: 1_761_868_800_000, method: 'initialize', tool: null, outcome: 'protocol', code: null, rule: 'connected to the wallet’s MCP server', paypal: 0 },
  { seq: 2, at: 1_761_868_801_000, method: 'tools/call', tool: 'table_view', outcome: 'answered', code: null, rule: 'read only: the table as the wallet sees it', paypal: 0 },
  { seq: 3, at: 1_761_868_802_000, method: 'tools/call', tool: 'send_offer', outcome: 'refused', code: 'outside_band', clause: 4, rule: 'Rule 4 held: never offer over $340.00', paypal: 0 },
  { seq: 4, at: 1_761_868_803_000, method: 'house/note', tool: null, outcome: 'protocol', code: null, rule: 'The house seller sent a note', paypal: 0, marker: true, seller_note: true },
];

/** A sandbox on the port: hello names `table`, the journal serves `entries` after `?after=`. */
function sandbox(table: string | null, entries: unknown[] = ENTRIES) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === `${BASE}/api/arena/hello`) return json(table === null ? { sandbox: 'table-sandbox', version: 1 } : { sandbox: 'table-sandbox', version: 1, table });
    if (url.startsWith(`${BASE}/api/journal`)) {
      const after = Number(new URL(url).searchParams.get('after') ?? '0');
      return json((entries as { seq: number }[]).filter((e) => e.seq > after));
    }
    if (url === `${BASE}/api/arena/note`) return json({ accepted: true });
    return new Response('not found', { status: 404 });
  });
}

/** Lets the mocked fetches and their `.json()` settle. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

describe('live mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reads as the recorded cards when no sandbox answers, silently', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetch);
    const error = vi.spyOn(console, 'error');
    const { result } = renderHook(() => useLive());
    await settle();
    expect(result.current).toEqual({ status: 'recorded' });
    expect(fetch).toHaveBeenCalledTimes(1);
    // Nobody there: it does not keep knocking (each refused probe is a console error in Chrome).
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ status: 'recorded' });
    expect(error).not.toHaveBeenCalled();
  });

  it('looks again when the window gets the focus back, once for a focus and a visibility change together', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetch);
    renderHook(() => useLive());
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    // just after the mount's probe: no second knock
    act(() => { window.dispatchEvent(new Event('focus')); });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('looks when "Connect my agent app" asks, and goes live if the sandbox is up by then', async () => {
    let up = false;
    const live = sandbox('D1', []);
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!up) throw new TypeError('Failed to fetch');
      return live(input, init);
    });
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useLive());
    await settle();
    expect(result.current).toEqual({ status: 'recorded' });
    up = true;
    act(() => { askForLive(); });
    await settle();
    expect(fetch.mock.calls.filter(([u]) => String(u).endsWith('/api/arena/hello'))).toHaveLength(2);
    expect(result.current).toEqual({ status: 'live', table: 'D1', answers: [] });
    expect(LIVE_ASK_EVENT).toBe('table:live-ask');
  });

  it('never probes under the director, a take or the film capture, nor in the desktop app', async () => {
    const fetch = vi.fn(async () => json({ sandbox: 'table-sandbox', version: 1, table: 'D1' }));
    vi.stubGlobal('fetch', fetch);
    for (const search of ['?take=1', '?take=film', '?frame=director', '?auto=1']) {
      history.replaceState(null, '', `/${search}`);
      const { result, unmount } = renderHook(() => useLive());
      await settle();
      act(() => { window.dispatchEvent(new Event('focus')); askForLive(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(result.current, search).toEqual({ status: 'recorded' });
      unmount();
    }
    history.replaceState(null, '', '/');
    const w = window as unknown as { __TAURI_INTERNALS__?: unknown };
    w.__TAURI_INTERNALS__ = {};
    try {
      const { result } = renderHook(() => useLive());
      await settle();
      act(() => { askForLive(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(result.current).toEqual({ status: 'recorded' });
    } finally {
      delete w.__TAURI_INTERNALS__;
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('applies only on a plain browser page: not framed (the director’s frames), not a take, not the desktop app', () => {
    expect(liveApplies({ search: '', framed: false, desktop: false })).toBe(true);
    expect(liveApplies({ search: '?story=try', framed: false, desktop: false })).toBe(true);
    expect(liveApplies({ search: '', framed: true, desktop: false })).toBe(false);
    expect(liveApplies({ search: '?take=1', framed: false, desktop: false })).toBe(false);
    expect(liveApplies({ search: '', framed: false, desktop: true })).toBe(false);
  });

  it('gives up on a probe after 1 s', async () => {
    let aborted = false;
    vi.stubGlobal('fetch', vi.fn((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')); });
    })));
    const { result } = renderHook(() => useLive());
    await act(async () => { await vi.advanceTimersByTimeAsync(999); });
    expect(aborted).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(aborted).toBe(true);
    expect(result.current).toEqual({ status: 'recorded' });
  });

  it('does not take a stranger on the port for the sandbox', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ hello: 'world' })));
    const { result } = renderHook(() => useLive());
    await settle();
    expect(result.current).toEqual({ status: 'recorded' });
  });

  it('goes live on the sandbox and maps the agent’s calls from the journal', async () => {
    const fetch = sandbox('01JTABLE0000000000000000D1');
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useLive());
    await settle();
    expect(LIVE_PORT).toBe(1443);
    expect(result.current).toEqual({
      status: 'live',
      table: '01JTABLE0000000000000000D1',
      answers: [
        { at: '2025-10-31T00:00:01.000Z', tool: 'table_view', verdict: 'yes', rule: null, sentence: 'read only: the table as the wallet sees it', paypalAsked: 0 },
        { at: '2025-10-31T00:00:02.000Z', tool: 'send_offer', verdict: 'no', rule: 'outside_band', sentence: 'Rule 4 held: never offer over $340.00', paypalAsked: 0 },
      ],
    });
    // Every request carries the bridge's header and goes to the loopback port.
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      expect(call.url.startsWith(BASE)).toBe(true);
      expect((call.init?.headers as Record<string, string>)['x-sandbox']).toBe('arena');
    }
    // The journal is read again every 1.5 s, from the last entry seen.
    const before = calls.filter((c) => c.url.includes('/api/journal')).length;
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    const reads = calls.filter((c) => c.url.includes('/api/journal'));
    expect(reads.length).toBe(before + 1);
    expect(reads[reads.length - 1]?.url).toBe(`${BASE}/api/journal?after=4`);
  });

  it('says no table when the sandbox has none open, and drops back to recorded when it stops', async () => {
    let up = true;
    const live = sandbox(null, []);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!up) throw new TypeError('Failed to fetch');
      return live(input, init);
    }));
    const { result } = renderHook(() => useLive());
    await settle();
    expect(result.current).toEqual({ status: 'live', table: null, answers: [] });
    up = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    await settle();
    expect(result.current).toEqual({ status: 'recorded' });
  });

  it('sends a note as a POST with the bridge header and reads 200 as accepted', async () => {
    const fetch = sandbox('D1');
    vi.stubGlobal('fetch', fetch);
    await expect(sendLiveNote('Final offer: $329, today only.')).resolves.toBe(true);
    const sent = calls.find((c) => c.url === `${BASE}/api/arena/note`);
    expect(sent?.init?.method).toBe('POST');
    expect(sent?.init?.headers).toMatchObject({ 'x-sandbox': 'arena', 'content-type': 'application/json' });
    expect(JSON.parse(String(sent?.init?.body))).toEqual({ text: 'Final offer: $329, today only.' });

    vi.stubGlobal('fetch', vi.fn(async () => json({ accepted: false, why: 'no table is open' }, 409)));
    await expect(sendLiveNote('anyone there?')).resolves.toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(sendLiveNote('anyone there?')).resolves.toBe(false);
  });
});

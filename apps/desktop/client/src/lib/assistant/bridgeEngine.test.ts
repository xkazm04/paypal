import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_PATH, type BridgeRequest } from './contract';
import { BRIDGE_TIMEOUT_MS, bridgeAvailable, createBridgeEngine } from './bridgeEngine';
import { mayaWeek } from './fixtures';

const res = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const reply = { v: 1, say: 'hi', ops: [] };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('createBridgeEngine', () => {
  it('posts the question and the digest and returns the reply of an ok response', async () => {
    const fetchMock = vi.fn(async () => res({ ok: true, engine: 'claude-code', ms: 12, reply }));
    vi.stubGlobal('fetch', fetchMock);
    const input = mayaWeek();
    const out = await createBridgeEngine().ask('What needs me?', input);
    expect(out).toEqual(reply);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(BRIDGE_PATH);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ question: 'What needs me?', digest: input } satisfies BridgeRequest);
  });

  it('reports itself as the claude-code engine', () => {
    expect(createBridgeEngine().info).toEqual({ id: 'claude-code', label: 'claude-code' });
  });

  it('throws Error(reason) for each ok:false reason', async () => {
    for (const reason of ['unavailable', 'timeout', 'bad_output', 'busy', 'bad_request']) {
      vi.stubGlobal('fetch', vi.fn(async () => res({ ok: false, reason }, 502)));
      await expect(createBridgeEngine().ask('q', mayaWeek())).rejects.toThrow(new Error(reason));
    }
  });

  it('turns an unknown reason, a non-JSON body and a network failure into unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ ok: false, reason: 'secret internal text' })));
    await expect(createBridgeEngine().ask('q', mayaWeek())).rejects.toThrow('unavailable');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>nope</html>', { status: 404 })));
    await expect(createBridgeEngine().ask('q', mayaWeek())).rejects.toThrow('unavailable');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(createBridgeEngine().ask('q', mayaWeek())).rejects.toThrow('unavailable');
  });

  it('does not trust ok:true on a failing status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ ok: true, engine: 'claude-code', ms: 1, reply }, 500)));
    await expect(createBridgeEngine().ask('q', mayaWeek())).rejects.toThrow('unavailable');
  });

  it('honours the caller AbortSignal', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_r, rej) => { init.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))); })));
    const ctl = new AbortController();
    const p = createBridgeEngine().ask('q', mayaWeek(), ctl.signal);
    ctl.abort();
    await expect(p).rejects.toThrow('aborted');
    const done = new AbortController();
    done.abort();
    await expect(createBridgeEngine().ask('q', mayaWeek(), done.signal)).rejects.toThrow('aborted');
  });

  it('times out after 45 seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_r, rej) => { init.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))); })));
    const p = createBridgeEngine().ask('q', mayaWeek());
    const assertion = expect(p).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(BRIDGE_TIMEOUT_MS - 1);
    expect(BRIDGE_TIMEOUT_MS).toBe(45_000);
    await vi.advanceTimersByTimeAsync(2);
    await assertion;
  });
});

describe('bridgeAvailable', () => {
  it('is true only for {ok:true} on a probe', async () => {
    const fetchMock = vi.fn(async () => res({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await bridgeAvailable()).toBe(true);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(`${BRIDGE_PATH}?probe=1`);
  });

  it('is false for anything else and never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ ok: false })));
    expect(await bridgeAvailable()).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => res({ ok: true }, 404)));
    expect(await bridgeAvailable()).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));
    expect(await bridgeAvailable()).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await bridgeAvailable()).toBe(false);
  });
});

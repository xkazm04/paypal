// The query layer: one read for N components (dedupe), one refetch for a burst of events
// (coalescing), per-deal narrowing, one listener per event, a 10 s time limit, the last good answer
// kept on a failed refetch, and retry only for an unavailable read. Read-only: no command here moves
// money, and mutations do not go through this layer.
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletError } from '../contract';

const h = vi.hoisted(() => ({
  calls: [] as { cmd: string; args: unknown }[],
  answer: (_cmd: string, _args: unknown): Promise<unknown> => Promise.resolve(null),
  cbs: new Map<string, Set<(p: unknown) => void>>(),
  listens: [] as string[],
}));
vi.mock('../runtime', () => ({
  backend: () => ({
    kind: 'mock',
    label: 'main',
    invoke: (cmd: string, args: unknown) => { h.calls.push({ cmd, args }); return h.answer(cmd, args); },
    listen: async (e: string, cb: (p: unknown) => void) => {
      h.listens.push(e);
      const s = h.cbs.get(e) ?? new Set();
      s.add(cb);
      h.cbs.set(e, s);
      return () => { s.delete(cb); };
    },
  }),
}));

import { useQuery } from '../hooks';
import { createDataClient, shouldRetry } from './client';
import { INVOKE_TIMEOUT_MS, readBudget, readCommand, resetReadBudget } from './invoke';
import { DataProvider } from './provider';

const count = (cmd: string) => h.calls.filter((c) => c.cmd === cmd).length;
const fire = (e: string, p: unknown) => { for (const cb of h.cbs.get(e) ?? []) cb(p); };
const dealEvent = (id: string) => ({ deal: { id }, mode: 'sandbox' });
const listening = (e: string) => waitFor(() => expect(h.cbs.get(e)?.size ?? 0).toBeGreaterThan(0));

beforeEach(() => {
  h.calls = [];
  h.cbs = new Map();
  h.listens = [];
  h.answer = (cmd, args) => Promise.resolve({ cmd, args, n: h.calls.length });
  resetReadBudget();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

function Reader({ cmd, args = null, refreshOn, onData }: { cmd: string; args?: unknown; refreshOn?: string[]; onData?: (d: unknown) => void }) {
  const q = useQuery(cmd as never, args as never, { refreshOn: refreshOn as never });
  onData?.(q.data);
  return <span>{q.data ? 'ready' : 'loading'}</span>;
}

const inProvider = (children: ReactNode) => render(<DataProvider>{children}</DataProvider>);

describe('dedupe', () => {
  it('N components asking for the same read make one IPC call', async () => {
    const seen: unknown[] = [];
    const r = inProvider(<>{Array.from({ length: 6 }, (_, i) => <Reader key={i} cmd="owner_facts" onData={(d) => d && seen.push(d)} />)}</>);
    await waitFor(() => expect(r.getAllByText('ready')).toHaveLength(6));
    expect(count('owner_facts')).toBe(1);
    // and every component got the same answer object
    expect(new Set(seen).size).toBe(1);
  });

  it('a world read shares its entry with any component that asks the same command', async () => {
    const r = inProvider(<><Reader cmd="get_settings" refreshOn={['settings:changed']} /><Reader cmd="get_settings" /><Reader cmd="get_settings" /></>);
    await waitFor(() => expect(r.getAllByText('ready')).toHaveLength(3));
    expect(count('get_settings')).toBe(1);
  });
});

describe('events', () => {
  it('listens once per event, however many reads name it', async () => {
    inProvider(<>{Array.from({ length: 5 }, (_, i) => <Reader key={i} cmd="deal_history" args={{ deal_id: null, from: i, to: null }} refreshOn={['deal:changed']} />)}</>);
    await listening('deal:changed');
    expect(h.listens.filter((e) => e === 'deal:changed')).toHaveLength(1);
  });

  it('coalesces a burst of deal:changed into one refetch per key', async () => {
    const r = inProvider(<Reader cmd="list_deals" refreshOn={['deal:changed']} />);
    await waitFor(() => r.getByText('ready'));
    await listening('deal:changed');
    expect(count('list_deals')).toBe(1);
    await act(async () => { for (let i = 0; i < 25; i += 1) fire('deal:changed', dealEvent(`D${i}`)); });
    await waitFor(() => expect(count('list_deals')).toBe(2));
    await act(async () => { await new Promise((res) => setTimeout(res, 50)); });
    expect(count('list_deals')).toBe(2);
  });

  it('an event while the read is running gets one trailing read, not one per event', async () => {
    let release: () => void = () => {};
    const r = inProvider(<Reader cmd="list_deals" />);
    await waitFor(() => r.getByText('ready'));
    await listening('deal:changed');
    // the next read hangs until released
    h.answer = (cmd, args) => new Promise((res) => { release = () => res({ cmd, args, late: true }); });
    await act(async () => { fire('deal:changed', dealEvent('A')); });
    await waitFor(() => expect(count('list_deals')).toBe(2));
    await act(async () => { for (let i = 0; i < 10; i += 1) fire('deal:changed', dealEvent(`B${i}`)); });
    expect(count('list_deals')).toBe(2);
    h.answer = (cmd, args) => Promise.resolve({ cmd, args, trailing: true });
    await act(async () => { release(); });
    await waitFor(() => expect(count('list_deals')).toBe(3));
    await act(async () => { await new Promise((res) => setTimeout(res, 50)); });
    expect(count('list_deals')).toBe(3);
  });

  it('a change to one deal re-reads that deal’s transcript only', async () => {
    const r = inProvider(<>
      <Reader cmd="deal_transcript" args={{ deal_id: 'A' }} refreshOn={['deal:changed']} />
      <Reader cmd="deal_transcript" args={{ deal_id: 'B' }} refreshOn={['deal:changed']} />
    </>);
    await waitFor(() => expect(r.getAllByText('ready')).toHaveLength(2));
    await listening('deal:changed');
    await act(async () => { fire('deal:changed', dealEvent('A')); });
    await waitFor(() => expect(h.calls.filter((c) => c.cmd === 'deal_transcript' && (c.args as { deal_id: string }).deal_id === 'A')).toHaveLength(2));
    await act(async () => { await new Promise((res) => setTimeout(res, 50)); });
    expect(h.calls.filter((c) => c.cmd === 'deal_transcript' && (c.args as { deal_id: string }).deal_id === 'B')).toHaveLength(1);
  });
});

describe('the plain scope (approval and tumbler windows)', () => {
  it('applies no event map: a read follows only its own refreshOn', async () => {
    const r = render(<DataProvider scope="plain">
      <Reader cmd="deal_transcript" args={{ deal_id: 'A' }} />
      <Reader cmd="rescue_book" refreshOn={['deal:changed']} />
    </DataProvider>);
    await waitFor(() => expect(r.getAllByText('ready')).toHaveLength(2));
    await listening('deal:changed');
    await act(async () => { fire('deal:changed', dealEvent('A')); });
    await waitFor(() => expect(count('rescue_book')).toBe(2));
    await act(async () => { await new Promise((res) => setTimeout(res, 50)); });
    expect(count('deal_transcript')).toBe(1);
  });

  it('reads again on every mount, as before the layer; the main scope keeps a named read', async () => {
    const plain = render(<DataProvider scope="plain"><Reader cmd="get_settings" /></DataProvider>);
    await waitFor(() => plain.getByText('ready'));
    plain.rerender(<DataProvider scope="plain"><span /></DataProvider>);
    await act(async () => { await new Promise((res) => setTimeout(res, 10)); });
    plain.rerender(<DataProvider scope="plain"><Reader cmd="get_settings" /></DataProvider>);
    await waitFor(() => plain.getByText('ready'));
    expect(count('get_settings')).toBe(2);
    plain.unmount();
    h.calls = [];
    const main = render(<DataProvider><Reader cmd="get_settings" /></DataProvider>);
    await waitFor(() => main.getByText('ready'));
    main.rerender(<DataProvider><span /></DataProvider>);
    await act(async () => { await new Promise((res) => setTimeout(res, 10)); });
    main.rerender(<DataProvider><Reader cmd="get_settings" /></DataProvider>);
    await waitFor(() => main.getByText('ready'));
    expect(count('get_settings')).toBe(1);
  });
});

describe('failures', () => {
  it('a read that does not answer rejects after 10 s with an availability error', async () => {
    vi.useFakeTimers();
    h.answer = () => new Promise(() => {});
    const p = readCommand('owner_facts', null);
    let settled: unknown = 'pending';
    p.then(() => { settled = 'resolved'; }, (e: unknown) => { settled = e; });
    await vi.advanceTimersByTimeAsync(INVOKE_TIMEOUT_MS - 1);
    expect(settled).toBe('pending');
    expect(readBudget.inFlight).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBeInstanceOf(WalletError);
    expect((settled as WalletError).code).toBe('UNAVAILABLE');
    expect(readBudget.inFlight).toBe(0);
    expect(readBudget.total).toBe(1);
  });

  it('keeps the last good answer when a refetch fails, and says it is stale', async () => {
    const { result } = renderHook(() => useQuery('owner_facts', null), { wrapper: ({ children }) => <DataProvider retry={false}>{children}</DataProvider> });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const good = result.current.data;
    h.answer = () => Promise.reject(new WalletError({ code: 'UNAVAILABLE', message: 'down' }));
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.error?.code).toBe('UNAVAILABLE'));
    expect(result.current.data).toBe(good);
    expect((result.current as { stale?: boolean }).stale).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('retries once, and only a read the shell said is unavailable', async () => {
    expect(shouldRetry(0, new WalletError({ code: 'UNAVAILABLE', message: '' }))).toBe(true);
    expect(shouldRetry(1, new WalletError({ code: 'UNAVAILABLE', message: '' }))).toBe(false);
    for (const code of ['LOCKED', 'PERMISSION', 'REFUSED', 'INVALID', 'NOT_FOUND', 'LEDGER_TRUST', 'UNSUPPORTED'] as const) {
      expect(shouldRetry(0, new WalletError({ code, message: '' }))).toBe(false);
    }
    // an unregistered command or a transport failure reads as UNAVAILABLE (contract.ts)
    expect(shouldRetry(0, new Error('transport'))).toBe(true);
  });

  it('with the window client, a first unavailable read is tried once more and then shows', async () => {
    let n = 0;
    h.answer = () => (n++ === 0 ? Promise.reject(new WalletError({ code: 'UNAVAILABLE', message: 'starting' })) : Promise.resolve({ ok: true }));
    const client = createDataClient();
    const { result } = renderHook(() => useQuery('owner_facts', null), { wrapper: ({ children }) => <DataProvider client={client}>{children}</DataProvider> });
    await waitFor(() => expect(result.current.data).toEqual({ ok: true }), { timeout: 3000 });
    expect(count('owner_facts')).toBe(2);
    expect(result.current.error).toBeNull();
  });
});

describe('stable answers', () => {
  it('returns the same object across renders while nothing changed', async () => {
    const { result, rerender } = renderHook(() => useQuery('owner_facts', null), { wrapper: ({ children }) => <DataProvider>{children}</DataProvider> });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const first = result.current;
    rerender();
    rerender();
    expect(result.current).toBe(first);
  });

  it('an equal answer to a refetch keeps the previous data object (no re-render downstream)', async () => {
    h.answer = () => Promise.resolve({ same: [1, 2, 3] });
    const { result } = renderHook(() => useQuery('owner_facts', null), { wrapper: ({ children }) => <DataProvider>{children}</DataProvider> });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const data = result.current.data;
    await act(async () => { await result.current.refetch(); });
    expect(count('owner_facts')).toBe(2);
    expect(result.current.data).toBe(data);
  });
});

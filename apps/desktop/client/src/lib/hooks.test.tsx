import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// useQuery must never show one request's answer under another request's arguments (a deal
// switch), and a slow old answer must not overwrite a newer one.
const pending = new Map<string, (v: unknown) => void>();
const fake = {
  invoke: vi.fn((_cmd: string, args: { deal_id: string }) => new Promise((res) => { pending.set(args.deal_id, res); })),
  listen: vi.fn(async () => () => {}),
};
vi.mock('./runtime', () => ({ backend: () => fake }));

import { useQuery } from './hooks';

afterEach(() => { cleanup(); pending.clear(); });

const run = () => renderHook(({ id }) => useQuery('deal_display' as never, { deal_id: id } as never) as { data: unknown; loading: boolean }, { initialProps: { id: 'A' } });

describe('useQuery', () => {
  it('drops the old answer while the new arguments load', async () => {
    const h = run();
    await act(async () => { pending.get('A')?.({ label: 'deal A' }); });
    await waitFor(() => expect(h.result.current.data).toEqual({ label: 'deal A' }));
    h.rerender({ id: 'B' });
    expect(h.result.current.data).toBeUndefined();
    expect(h.result.current.loading).toBe(true);
    await act(async () => { pending.get('B')?.({ label: 'deal B' }); });
    await waitFor(() => expect(h.result.current.data).toEqual({ label: 'deal B' }));
    expect(h.result.current.loading).toBe(false);
  });

  it('ignores a slow answer for arguments that are no longer asked', async () => {
    const h = run();
    h.rerender({ id: 'B' });
    await act(async () => { pending.get('B')?.({ label: 'deal B' }); });
    await waitFor(() => expect(h.result.current.data).toEqual({ label: 'deal B' }));
    await act(async () => { pending.get('A')?.({ label: 'deal A' }); });
    expect(h.result.current.data).toEqual({ label: 'deal B' });
  });
});

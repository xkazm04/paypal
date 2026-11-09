// At scale (hundreds of deals) the displays arrive in batches, live deals first, and every batch is
// shown when it lands: the window no longer waits for the last read to show a label or a band.
// `ready` turns true once a whole pass has been read, so a deep link by label can tell "not yet"
// from "not here". Read-only: nothing here can move money.
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deal } from '@bindings/Deal';
import { buildMockState } from '../../mock/fixtures';

// The first `free` reads answer at once; the others wait for `open()` (or fail, for ids in `bad`).
const gate = { free: Infinity, calls: [] as string[], bad: new Set<string>(), release: () => {} };
let opened: Promise<void>;
const shown = (id: string) => ({ deal_id: id, label: `L-${id}`, title: id, deadline: null, on_silence: null, band: null });
const fake = {
  invoke: vi.fn(async (_cmd: string, args: { deal_id: string }) => {
    gate.calls.push(args.deal_id);
    if (gate.calls.length > gate.free) await opened;
    if (gate.bad.has(args.deal_id)) throw new Error('read failed');
    return shown(args.deal_id);
  }),
  listen: vi.fn(async () => () => {}),
};
vi.mock('../../lib/runtime', () => ({ backend: () => fake }));

import { DISPLAY_BATCH, DISPLAY_SWEEP_MS, displayReadOrder, useDisplays } from './displays';

beforeEach(() => { gate.free = Infinity; gate.calls = []; gate.bad = new Set(); opened = new Promise<void>((r) => { gate.release = r; }); });
afterEach(() => { cleanup(); fake.invoke.mockClear(); });

const template = buildMockState(1_800_000_000).deals[0]!.deal;
const deal = (id: string, state: Deal['state']): Deal => ({ ...template, id, state, shield: null, updated_at: 100 });

describe('displayReadOrder', () => {
  it('reads the live deals first, each group in its own order', () => {
    const ds = [deal('A', 'EXPIRED'), deal('B', 'NEGOTIATING'), deal('C', 'RECEIPTED'), deal('D', 'AGREED')];
    expect(displayReadOrder(ds, ['A', 'B', 'C', 'D'])).toEqual(['B', 'D', 'A', 'C']);
    expect(displayReadOrder(ds, ['C', 'A'])).toEqual(['C', 'A']);
  });
});

describe('useDisplays', () => {
  it('shows a batch when it lands, live deals first, and is ready only after the last batch', async () => {
    const n = DISPLAY_BATCH * 2 + 5;
    const ds = Array.from({ length: n }, (_, i) => deal(`E${String(i).padStart(3, '0')}`, i % 10 === 0 ? 'NEGOTIATING' : 'RECEIPTED'));
    gate.free = DISPLAY_BATCH;
    const { result } = renderHook(() => useDisplays(ds));
    await waitFor(() => expect(result.current.map.size).toBe(DISPLAY_BATCH));
    expect(result.current.ready).toBe(false);
    // the live deals were in the first batch
    for (const d of ds.filter((x) => x.state === 'NEGOTIATING')) expect(result.current.map.has(d.id)).toBe(true);
    gate.release();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.map.size).toBe(n);
    expect(result.current.error).toBeNull();
    expect(fake.invoke).toHaveBeenCalledTimes(n);
  });

  it('is ready at once when there is nothing to read', async () => {
    const none = renderHook(() => useDisplays([]));
    await waitFor(() => expect(none.result.current.ready).toBe(true));
    expect(none.result.current.map.size).toBe(0);
  });

  it('reads the live deals again on the sweep, with no event and no list change, and leaves the ended ones', async () => {
    // Only the sweep's interval is faked (waitFor polls on the real timers).
    let sweep: (() => void) | null = null;
    const real = globalThis.setInterval;
    const spy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, ms?: number) => {
      if (ms === DISPLAY_SWEEP_MS) { sweep = fn; return 0 as never; }
      return real(fn, ms);
    }) as typeof setInterval);
    try {
      const ds = [deal('L1', 'NEGOTIATING'), deal('L2', 'AUTHORIZED'), deal('P', 'CAPTURED'), deal('E', 'EXPIRED')];
      const h = renderHook(() => useDisplays(ds));
      await waitFor(() => expect(h.result.current.ready).toBe(true));
      expect(fake.invoke).toHaveBeenCalledTimes(4);
      expect(sweep).not.toBeNull();
      gate.calls = [];
      await new Promise((r) => setTimeout(r, 50));
      expect(gate.calls).toEqual([]);
      (sweep as unknown as () => void)();
      await waitFor(() => expect([...gate.calls].sort()).toEqual(['L1', 'L2', 'P']));
    } finally {
      spy.mockRestore();
    }
  });

  it('a failed read leaves that deal out, sets the error, and the pass still finishes', async () => {
    const ds = [deal('X', 'RECEIPTED'), deal('Y', 'RECEIPTED')];
    gate.bad.add('X');
    const h = renderHook(() => useDisplays(ds));
    await waitFor(() => expect(h.result.current.ready).toBe(true));
    expect(h.result.current.map.has('X')).toBe(false);
    expect(h.result.current.map.has('Y')).toBe(true);
    expect(h.result.current.error).not.toBeNull();
  });
});

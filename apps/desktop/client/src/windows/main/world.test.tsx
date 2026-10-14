// The World on the query layer: failures surface as flags (a failed get_settings flips `stale`),
// narrow selectors re-render only for their own slice, and the read budget on the 500-deal
// `?scale=large` world: every deal's display read once on load, at most 8 at a time, and a change to
// the ledger reads again only what displaysToRead names. Read-only: nothing here moves money.
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deal } from '@bindings/Deal';
import type { Backend, EventName, PayloadOf } from '../../lib/contract';
import { WalletError } from '../../lib/contract';
import { readBudget, resetReadBudget } from '../../lib/data/invoke';
import { READ_CONCURRENCY } from '../../lib/readEach';
import { mockBackend, resetMockState } from '../../mock/backend';
import { SCALE_NOW, buildScaleState } from '../../mock/scale';

const h = vi.hoisted(() => ({
  current: null as Backend | null,
  cbs: new Map<string, Set<(p: unknown) => void>>(),
  failSettings: false,
  bump: new Set<string>(),
}));
vi.mock('../../lib/runtime', () => ({ backend: () => h.current }));

import { DISPLAY_BATCH, displaysToRead, displayToken } from './displays';
import { isTerminal } from './logic';
import { useDeals, useNeeds, useRuns, useStaleBanner, useWorldHealth, WorldProvider, type WorldHealth } from './world';

function wrap(real: Backend): Backend {
  return {
    kind: real.kind,
    label: real.label,
    invoke: async (cmd, args, opts) => {
      if (cmd === 'get_settings' && h.failSettings) throw new WalletError({ code: 'UNAVAILABLE', message: 'settings store is busy' });
      const r = await real.invoke(cmd, args, opts);
      if (cmd === 'list_deals' && h.bump.size) return (r as Deal[]).map((d) => (h.bump.has(d.id) ? { ...d, updated_at: (d.updated_at ?? 0) + 1 } : d)) as typeof r;
      return r;
    },
    listen: async <E extends EventName>(e: E, cb: (p: PayloadOf<E>) => void) => {
      const s = h.cbs.get(e) ?? new Set();
      s.add(cb as (p: unknown) => void);
      h.cbs.set(e, s);
      return () => { s.delete(cb as (p: unknown) => void); };
    },
  };
}
const fire = (e: string, p: unknown) => { for (const cb of h.cbs.get(e) ?? []) cb(p); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Waits until no read has been out for a while. */
async function quiet(): Promise<void> {
  let last = -1;
  while (readBudget.total !== last || readBudget.inFlight > 0) {
    last = readBudget.total;
    await act(async () => { await sleep(150); });
  }
}

beforeEach(() => {
  localStorage.clear();
  h.cbs = new Map();
  h.failSettings = false;
  h.bump = new Set();
  resetReadBudget();
});
afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

describe('world failures surface as flags', () => {
  it('a failed get_settings flips stale and names the part, and a later success clears it', async () => {
    resetMockState();
    h.current = wrap(mockBackend('main'));
    h.failSettings = true;
    const seen: WorldHealth[] = [];
    let banner: ReturnType<typeof useStaleBanner> = null;
    function Probe() { seen.push(useWorldHealth()); banner = useStaleBanner(); return null; }
    render(<WorldProvider><Probe /></WorldProvider>);
    await waitFor(() => expect(seen.at(-1)?.stale).toBe(true));
    expect(seen.at(-1)?.settingsError?.code).toBe('UNAVAILABLE');
    expect(seen.at(-1)?.attentionError).toBeNull();
    expect(banner).toMatchObject({ kind: 'unread', parts: ['your settings'], retry: true });
    // the banner's words carry no code, no command and not the error's own message
    expect(JSON.stringify(banner)).not.toMatch(/UNAVAILABLE|get_settings|busy/);
    h.failSettings = false;
    await act(async () => { fire('settings:changed', {}); });
    await waitFor(() => expect(seen.at(-1)?.stale).toBe(false));
    expect(banner).toBeNull();
  });
});

describe('narrow selectors', () => {
  it('a needs consumer does not re-render when only the agent runs change', async () => {
    resetMockState();
    const real = mockBackend('main');
    let runsChanged = false;
    const base = wrap(real);
    h.current = { ...base, invoke: async (cmd, args, opts) => {
      const r = await base.invoke(cmd, args, opts);
      // A different runs answer (one agent started) once the agents change.
      if (cmd === 'agent_runs' && runsChanged) return buildScaleState('large', SCALE_NOW).runs.slice(0, 1) as typeof r;
      return r;
    } };
    let needsRenders = 0;
    let runsRenders = 0;
    let dealsRenders = 0;
    function Needs() { useNeeds(); needsRenders += 1; return null; }
    function Runs() { useRuns(); runsRenders += 1; return null; }
    function Deals() { useDeals(); dealsRenders += 1; return null; }
    render(<WorldProvider><Needs /><Runs /><Deals /></WorldProvider>);
    await quiet();
    const before = { needs: needsRenders, runs: runsRenders, deals: dealsRenders };
    runsChanged = true;
    await act(async () => { fire('agent:changed', {}); });
    await quiet();
    expect(runsRenders).toBeGreaterThan(before.runs);
    expect(needsRenders).toBe(before.needs);
    expect(dealsRenders).toBe(before.deals);
  });
});

describe('the read budget on ?scale=large (500 deals)', () => {
  it('reads every display once on load, 8 at a time, and after a change only what displaysToRead names', async () => {
    history.replaceState(null, '', '/index.html?scale=large');
    resetMockState();
    const real = mockBackend('main');
    h.current = wrap(real);
    const deals = await real.invoke('list_deals', null);
    expect(deals.length).toBe(500);
    resetReadBudget();
    render(<WorldProvider><span /></WorldProvider>);
    await quiet();
    const load = readBudget.byCommand.get('deal_display');
    // every deal once (no duplicate reads), never more than the pass width at a time
    expect(load?.total).toBe(500);
    expect(load?.maxInFlight).toBeLessThanOrEqual(READ_CONCURRENCY);
    expect(readBudget.byCommand.get('list_deals')?.total).toBe(1);
    expect(readBudget.byCommand.get('get_settings')?.total).toBe(1);
    expect(readBudget.byCommand.get('attention_list')?.total).toBe(1);
    expect(readBudget.byCommand.get('agent_runs')?.total).toBe(1);
    expect(Math.ceil(500 / DISPLAY_BATCH)).toBe(5);

    // An event storm with nothing changed: one list read, no display read.
    resetReadBudget();
    await act(async () => { for (const d of deals.slice(0, 20)) fire('deal:changed', { deal: d, mode: d.mode }); });
    await quiet();
    expect(readBudget.byCommand.get('list_deals')?.total).toBe(1);
    expect(readBudget.byCommand.get('deal_display')?.total ?? 0).toBe(0);

    // Ten ended deals change: one list read, then exactly the deals displaysToRead names (the live
    // deals, the paid ones whose money check can still close, and the ten), live first, 8 at a time.
    const ended = deals.filter((d) => isTerminal(d) && d.state !== 'CAPTURED' && d.state !== 'RECEIPTED').slice(0, 10);
    expect(ended).toHaveLength(10);
    for (const d of ended) h.bump.add(d.id);
    const cache = new Map(deals.map((d) => [d.id, { token: displayToken(d) }]));
    const next = deals.map((d) => (h.bump.has(d.id) ? { ...d, updated_at: (d.updated_at ?? 0) + 1 } : d));
    const expected = displaysToRead(next, cache).length;
    const live = deals.filter((d) => !isTerminal(d)).length;
    expect(expected).toBeGreaterThanOrEqual(live + 10);
    expect(expected).toBeLessThan(500);
    resetReadBudget();
    await act(async () => { for (const d of ended) fire('deal:changed', { deal: d, mode: d.mode }); });
    await quiet();
    expect(readBudget.byCommand.get('list_deals')?.total).toBe(1);
    expect(readBudget.byCommand.get('deal_display')?.total).toBe(expected);
    expect(readBudget.byCommand.get('deal_display')?.maxInFlight).toBeLessThanOrEqual(READ_CONCURRENCY);
  }, 60_000);
});

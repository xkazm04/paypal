// The footer's engine and agents chips read only what they say (settings, agent runs, engine status):
// a change to the deals or the attention list, which they never show, does not redraw them.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deal } from '@bindings/Deal';
import type { Backend, EventName, PayloadOf } from '../../lib/contract';
import { readBudget, resetReadBudget } from '../../lib/data/invoke';
import { mockBackend, resetMockState } from '../../mock/backend';

const h = vi.hoisted(() => ({ current: null as Backend | null, cbs: new Map<string, Set<(p: unknown) => void>>(), bump: 0, engineRenders: 0 }));
vi.mock('../../lib/runtime', () => ({ backend: () => h.current }));
// The engine chip reads engine_status once per render: counting those calls counts its renders.
vi.mock('../../lib/hooks', async (orig) => {
  const real = await orig<typeof import('../../lib/hooks')>();
  return { ...real, useQuery: ((cmd: string, ...rest: unknown[]) => { if (cmd === 'engine_status') h.engineRenders += 1; return (real.useQuery as (...a: unknown[]) => unknown)(cmd, ...rest); }) as typeof real.useQuery };
});

import { StatusChips } from './Status';
import { WorldProvider } from './world';

function wrap(real: Backend): Backend {
  return {
    kind: real.kind,
    label: real.label,
    invoke: async (cmd, args, opts) => {
      const r = await real.invoke(cmd, args, opts);
      // A deal that changed: the list's answer differs, so the World takes a new identity.
      if (cmd === 'list_deals' && h.bump) return (r as Deal[]).map((d, i) => (i === 0 ? { ...d, updated_at: (d.updated_at ?? 0) + h.bump } : d)) as typeof r;
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
/** Two quiet windows in a row: no read out and none started. */
async function quiet(): Promise<void> {
  let last = -1;
  let still = 0;
  while (still < 2) {
    still = readBudget.total === last && readBudget.inFlight <= 0 ? still + 1 : 0;
    last = readBudget.total;
    await act(async () => { await sleep(150); });
  }
}

beforeEach(() => { localStorage.clear(); h.cbs = new Map(); h.bump = 0; h.engineRenders = 0; resetReadBudget(); resetMockState(); h.current = wrap(mockBackend('main')); });
afterEach(() => { cleanup(); });

describe('the footer chips', () => {
  it('say they are checking, dashed, until settings and the agent runs are read (never "none" or "idle" unread)', async () => {
    const real = h.current as Backend;
    h.current = { ...real, invoke: (cmd, args, opts) => (cmd === 'get_settings' || cmd === 'agent_runs' ? new Promise<never>(() => {}) : real.invoke(cmd, args, opts)) };
    render(<WorldProvider><StatusChips onSettings={() => {}} /></WorldProvider>);
    await act(async () => { await sleep(200); });
    const [engine, agents] = screen.getAllByRole('button');
    expect(engine?.textContent).not.toMatch(/No agent app/);
    expect(agents?.textContent).not.toMatch(/idle/);
    expect(engine?.classList.contains('dashed')).toBe(true);
    expect(agents?.classList.contains('dashed')).toBe(true);
  });

  it('do not redraw when a deal changes and the attention list is read again', async () => {
    render(<WorldProvider><StatusChips onSettings={() => {}} /></WorldProvider>);
    await quiet();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    const before = h.engineRenders;
    const lists = readBudget.byCommand.get('list_deals')?.total ?? 0;
    h.bump = 1;
    await act(async () => { fire('deal:changed', {}); fire('attention:changed', {}); });
    await quiet();
    // the World did change underneath (the reads came back), the chips did not redraw
    expect(readBudget.byCommand.get('list_deals')?.total ?? 0).toBeGreaterThan(lists);
    expect(h.engineRenders - before, 'engine chip redraws for reads it does not show').toBe(0);
  }, 30_000);
});

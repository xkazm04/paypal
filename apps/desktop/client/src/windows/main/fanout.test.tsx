// One deal:changed, counted (client perf, the event fan-out). The event names its deal and carries
// its row: the World patches that row into the cached deal list instead of reading the whole ledger
// again, and reads that one deal's display, not every live deal's. A deal the list does not have yet
// (a new deal) is not patched: the list and what needs the owner are read again, so the new deal
// shows in both. Measured on the mock's ?scale=large (500 deals) and ?scale=xl (5,000 deals) worlds.
// Read-only: nothing here moves money.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { AttentionSnapshot } from '@bindings/AttentionSnapshot';
import type { Deal } from '@bindings/Deal';
import type { Backend, EventName, PayloadOf } from '../../lib/contract';
import { readBudget, resetReadBudget } from '../../lib/data/invoke';
import { mockBackend, resetMockState } from '../../mock/backend';

const h = vi.hoisted(() => ({
  current: null as Backend | null,
  cbs: new Map<string, Set<(p: unknown) => void>>(),
  calls: [] as { cmd: string; args: unknown }[],
  /** Rows the shell has changed since the mock answered (list_deals answers them). */
  changed: new Map<string, Deal>(),
  /** A deal the shell has that the mock does not (list_deals and attention_list answer it). */
  extra: null as { deal: Deal; need: AttentionItem } | null,
}));
vi.mock('../../lib/runtime', () => ({ backend: () => h.current }));

import { isTerminal } from './logic';
import { useDeals, useNeeds, WorldProvider } from './world';

function wrap(real: Backend): Backend {
  return {
    kind: real.kind,
    label: real.label,
    invoke: async (cmd, args, opts) => {
      h.calls.push({ cmd, args });
      const r = await real.invoke(cmd, args, opts);
      if (cmd === 'list_deals') {
        const ds = (r as Deal[]).map((d) => h.changed.get(d.id) ?? d);
        return (h.extra ? [...ds, h.extra.deal] : ds) as typeof r;
      }
      if (cmd === 'attention_list' && h.extra) {
        const a = r as AttentionSnapshot;
        return { ...a, items: [...a.items, h.extra.need] } as typeof r;
      }
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
async function quiet(): Promise<void> {
  let last = -1;
  let still = 0;
  while (still < 2) {
    still = readBudget.total === last && readBudget.inFlight <= 0 ? still + 1 : 0;
    last = readBudget.total;
    await act(async () => { await sleep(150); });
  }
}
const count = (cmd: string) => readBudget.byCommand.get(cmd)?.total ?? 0;
const displayIds = () => h.calls.filter((c) => c.cmd === 'deal_display').map((c) => (c.args as { deal_id: string }).deal_id);

beforeEach(() => {
  localStorage.clear();
  h.cbs = new Map();
  h.calls = [];
  h.changed = new Map();
  h.extra = null;
  resetReadBudget();
});
afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

const report: string[] = [];

async function openWorld(scale: 'large' | 'xl') {
  history.replaceState(null, '', `/index.html?scale=${scale}`);
  resetMockState();
  const real = mockBackend('main');
  h.current = wrap(real);
  const deals = await real.invoke('list_deals', null);
  let seen: Deal[] | undefined;
  let needs: AttentionItem[] = [];
  function Probe() { seen = useDeals().data; needs = useNeeds(); return null; }
  render(<WorldProvider><Probe /></WorldProvider>);
  await quiet();
  return { deals, seen: () => seen, needs: () => needs };
}

describe.each([['large', 500], ['xl', 5_000]] as const)('one deal:changed on ?scale=%s', (scale, size) => {
  it(`reads that deal's display only, and patches the list instead of reading ${size} deals`, async () => {
    const w = await openWorld(scale);
    expect(w.deals).toHaveLength(size);
    const live = w.deals.filter((d) => !isTerminal(d));
    const [x, y] = live;
    if (!x || !y) throw new Error('the scale world has live deals');
    // The shell moved deal X: its row is new (as list_deals would now answer it).
    const moved: Deal = { ...x, updated_at: (x.updated_at ?? 0) + 7 };
    h.changed.set(x.id, moved);
    resetReadBudget();
    h.calls = [];
    await act(async () => { fire('deal:changed', { deal: moved, mode: moved.mode }); });
    await quiet();
    report.push(`${scale.padEnd(5)} ${size} deals, ${live.length} live: list_deals ${count('list_deals')}, attention_list ${count('attention_list')}, deal_display ${count('deal_display')}, all reads ${readBudget.total}`);
    // X's display, never Y's
    expect(displayIds()).toEqual([x.id]);
    expect(displayIds()).not.toContain(y.id);
    // the list is patched, not read: the World shows X's new row
    expect(count('list_deals')).toBe(0);
    expect(w.seen()?.find((d) => d.id === x.id)?.updated_at).toBe(moved.updated_at);
    // what needs the owner is the shell's to say: read once
    expect(count('attention_list')).toBe(1);
  }, 120_000);
});

describe('a new deal', () => {
  it('is not patched in: the list and attention are read again and it shows in both', async () => {
    const w = await openWorld('large');
    const template = w.deals.find((d) => !isTerminal(d));
    if (!template) throw new Error('a live deal');
    const fresh: Deal = { ...template, id: '01ZZZZZZZZZZZZZZZZZZZZZZZZ', updated_at: (template.updated_at ?? 0) + 1 };
    const need = { ...(w.needs()[0] as AttentionItem), deal_id: fresh.id };
    h.extra = { deal: fresh, need };
    resetReadBudget();
    h.calls = [];
    await act(async () => { fire('deal:changed', { deal: fresh, mode: fresh.mode }); });
    await quiet();
    expect(count('list_deals')).toBe(1);
    expect(count('attention_list')).toBe(1);
    expect(w.seen()?.some((d) => d.id === fresh.id)).toBe(true);
    expect(w.needs().some((n) => n.deal_id === fresh.id)).toBe(true);
    // and only the new deal's display is read
    expect(displayIds()).toEqual([fresh.id]);
  }, 60_000);
});

describe('report', () => {
  it('prints the counts', () => {
    console.info(`\n${report.join('\n')}`);
    expect(report.length).toBe(2);
  });
});

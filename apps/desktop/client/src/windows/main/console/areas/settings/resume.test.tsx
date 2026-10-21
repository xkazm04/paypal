// Resume's restart (runtime-actor-and-engines B): resume_all_agents returns the tables waiting on
// your agent; the owner restarts them in one click, never more than the run limit at once, each
// through its own agent_start. A refused start is shown for that table and never retried.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_AGENTS, SETTINGS_CARD } from '../../../../../lib/words';
import type { WaitingTable } from '@bindings/WaitingTable';
import { mockBackend, resetMockState } from '../../../../../mock/backend';
import { renderLayerAtScale, settle } from '../../testing/scaleSmoke';
import { restartPlan, restartTables, RUN_CAP } from './resume';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

// The preview worlds the layer harness draws have no open haggle, so the layer test hands the
// Resume a report naming five of the world's tables; the mock's own report is checked below.
const canned: { report: WaitingTable[] | null } = { report: null };
vi.mock('../../../../../mock/backend', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../../mock/backend')>();
  return {
    ...real,
    mockBackend: (...a: Parameters<typeof real.mockBackend>) => {
      const b = real.mockBackend(...a);
      return {
        ...b,
        invoke: async (cmd: string, args: unknown, opts?: unknown) => {
          const out = await (b.invoke as (c: string, x: unknown, o?: unknown) => Promise<unknown>)(cmd, args, opts);
          return cmd === 'resume_all_agents' && canned.report ? { waiting: canned.report } : out;
        },
      } as typeof b;
    },
  };
});

afterEach(() => { cleanup(); canned.report = null; history.replaceState(null, '', '/'); });

describe('restartPlan', () => {
  it('plans with the run limit the wallet refuses past (engines.rs start_agent)', () => {
    const src = readFileSync(resolve(process.cwd(), '../../../crates/table-runtime/src/engines.rs'), 'utf8').replace(/\/\/[^\n]*/g, '');
    const body = src.slice(src.indexOf('fn start_agent('), src.indexOf('RUN_LIMIT', src.indexOf('fn start_agent(')));
    const cap = /self\.runs\.len\(\)\s*>=\s*(\d+)/.exec(body);
    expect(cap, 'start_agent no longer refuses past a literal run count').not.toBeNull();
    expect(RUN_CAP).toBe(Number(cap![1]));
    // The Restart button's words say the same limit ("Four work at once").
    const word = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'][RUN_CAP]!;
    expect(SETTINGS_AGENTS.restartTitle.toLowerCase()).toContain(`${word} work at once`);
    expect(SETTINGS_AGENTS.later(2)).toContain(`(${word} work at once)`);
  });
  it('starts as many as the free run slots allow, in the order given; the rest wait', () => {
    expect(RUN_CAP).toBe(4);
    expect(restartPlan(['A', 'B', 'C', 'D', 'E'], 1, 4)).toEqual({ start: ['A', 'B', 'C'], later: ['D', 'E'] });
    expect(restartPlan([], 0, 4)).toEqual({ start: [], later: [] });
    expect(restartPlan(['A', 'B'], 4, 4)).toEqual({ start: [], later: ['A', 'B'] });
    expect(restartPlan(['A'], 9, 4)).toEqual({ start: [], later: ['A'] });
    expect(restartPlan(['A', 'B'], 0)).toEqual({ start: ['A', 'B'], later: [] });
  });
});

describe('restartTables', () => {
  it('calls start once per table, in order, and reports a refused one without retrying it', async () => {
    const seen: string[] = [];
    const out = await restartTables(['A', 'B', 'C'], async (id) => {
      seen.push(id);
      if (id === 'B') throw new Error('Agents paused or run limit reached');
      return { run: `run-${id}` };
    });
    expect(seen).toEqual(['A', 'B', 'C']);
    expect(out.started).toEqual(['A', 'C']);
    expect(out.refused.map((r) => r.deal_id)).toEqual(['B']);
  });
});

describe('the preview wallet’s Resume', () => {
  it('names the open haggles whose next move is ours, soonest first, and drops one once it runs', async () => {
    history.replaceState(null, '', '/index.html');
    resetMockState();
    const b = mockBackend('main');
    await b.invoke('pause_all_agents', null);
    const report = await b.invoke('resume_all_agents', null);
    const deals = await b.invoke('list_deals', null);
    const open = deals.filter((d) => d.kind === 'haggle' && (d.state === 'NEGOTIATING' || d.state === 'LISTED'));
    expect(report.waiting.length).toBeGreaterThan(0);
    for (const w of report.waiting) expect(open.map((d) => d.id)).toContain(w.deal_id);
    const deadlines = report.waiting.map((w) => w.deadline);
    expect([...deadlines].sort((x, y) => x - y)).toEqual(deadlines);
    // Resume started nothing; a started table is no longer waiting.
    const first = report.waiting[0]!.deal_id;
    expect((await b.invoke('agent_runs', null)).filter((r) => r.deal_id === first && r.state === 'running')).toHaveLength(0);
    await b.invoke('agent_start', { deal_id: first });
    expect((await b.invoke('resume_all_agents', null)).waiting.map((w) => w.deal_id)).not.toContain(first);
  });
});

describe('Settings · Your agents after Resume', () => {
  const card = (layer: HTMLElement, label: string) => {
    const c = [...layer.querySelectorAll<HTMLButtonElement>('button.pf-card')].find((b) => b.querySelector('.sc-label')?.textContent?.startsWith(label));
    if (!c) throw new Error(`no card ${label}`);
    return c;
  };

  it('lists the waiting tables and restarts them with one click, one agent_start per table in order, within the run limit', async () => {
    const r = await renderLayerAtScale(async (w) => {
      const now = Math.floor(Date.now() / 1000);
      canned.report = (await w.invoke('list_deals', null)).slice(0, 5).map((d, i) => ({ deal_id: d.id, deadline: now + 600 * (i + 1) }));
      return { level: 'place', place: 'settings' };
    }, 'small');
    const report = canned.report!;
    expect(report).toHaveLength(5);
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => { fireEvent.keyDown(window, { key: 'p' }); });
    await settle();
    fireEvent.click(card(r.layer, SETTINGS_CARD.agents));
    const view = await waitFor(() => { const v = r.layer.querySelector<HTMLElement>('.pf-view'); if (!v) throw new Error('no view'); return v; });
    fireEvent.click(await waitFor(() => within(view).getByRole('button', { name: SETTINGS_AGENTS.resume })));
    await settle();
    expect(r.calls.filter((c) => c.cmd === 'resume_all_agents')).toHaveLength(1);
    // Resume itself starts nothing.
    expect(r.calls.filter((c) => c.cmd === 'agent_start')).toHaveLength(0);
    const list = await waitFor(() => within(view).getByRole('list', { name: SETTINGS_AGENTS.waitingTitle(5) }));
    expect(list.querySelectorAll('li')).toHaveLength(5);
    const runs = await mockBackend('main').invoke('agent_runs', null);
    const plan = restartPlan(report.map((w) => w.deal_id), runs.filter((x) => x.state === 'running' || x.state === 'starting').length);
    expect(plan.start.length).toBeGreaterThan(0);
    expect(plan.later.length).toBeGreaterThan(0);
    expect(within(view).getByText(SETTINGS_AGENTS.later(plan.later.length))).toBeTruthy();
    const before = r.calls.length;
    fireEvent.click(within(view).getByRole('button', { name: SETTINGS_AGENTS.restart(plan.start.length) }));
    await settle();
    const starts = r.calls.slice(before).filter((c) => c.cmd === 'agent_start');
    expect(starts.map((c) => (c.args as { deal_id: string }).deal_id)).toEqual(plan.start);
    // The started tables leave the list; the rest still wait for the owner's next click.
    await waitFor(() => expect(within(view).getByRole('list', { name: SETTINGS_AGENTS.waitingTitle(plan.later.length) }).querySelectorAll('li')).toHaveLength(plan.later.length));
  }, 60_000);
});

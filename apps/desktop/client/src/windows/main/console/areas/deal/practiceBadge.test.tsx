// Acceptance E2, the client half: the "Practice agent" badge is drawn beside a scripted-engine run
// on the deal page (its working chip and its Details) and on the Settings agent rows, and beside
// no sandbox run. The runs come from the mock backend: the preview wallet's own sandbox runs, plus
// one of them shown as a Practice agent run (see the canned answer below).
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunSnapshot } from '@bindings/RunSnapshot';
import type { Backend } from '../../../../../lib/contract';
import { DEAL_ACT, SETTINGS_AGENTS, SETTINGS_CARD, modeWord } from '../../../../../lib/words';
import { renderLayerAtScale, settle } from '../../testing/scaleSmoke';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); canned.practice = null; history.replaceState(null, '', '/'); });

const PRACTICE = modeWord('scripted_engine');
const badges = (root: ParentNode) => [...root.querySelectorAll('.badge.scripted_engine')];

// The large preview wallet runs its agents on the sandbox only (the Practice agent is not among
// its running ones), so the mock's agent_runs answer is edited: its first run is a Practice agent
// run, the rest stay the sandbox runs the wallet already has.
const canned: { practice: string | null } = { practice: null };
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
          if (cmd !== 'agent_runs' || !canned.practice) return out;
          return (out as RunSnapshot[]).map((r) => (r.deal_id === canned.practice ? { ...r, engine: 'scripted', mode: 'scripted_engine', playbook: null } : r));
        },
      } as typeof b;
    },
  };
});

/** One deal on a Practice agent run, one on a sandbox run. */
async function twoRuns(w: Backend) {
  const runs = await w.invoke('agent_runs', null);
  const [practice, sandbox] = runs.filter((r) => r.mode === 'sandbox' && r.state === 'running' && r.engine === 'claude-code');
  canned.practice = practice!.deal_id;
  return { practice: practice!, sandbox: sandbox! };
}

const openDeal = (pick: (x: Awaited<ReturnType<typeof twoRuns>>) => string) =>
  renderLayerAtScale(async (w) => ({ level: 'deal' as const, deal: pick(await twoRuns(w)) }), 'large');

const openDetails = async (layer: HTMLElement) => {
  fireEvent.click(within(layer).getByRole('button', { name: DEAL_ACT.details }));
  await settle();
  return waitFor(() => { const p = document.querySelector<HTMLElement>('.dv-pop'); if (!p) throw new Error('no details'); return p; });
};

describe('the Practice agent badge on the deal page', () => {
  it('renders beside a practice run, on the working chip and in Details', async () => {
    const r = await openDeal((x) => x.practice.deal_id);
    await waitFor(() => expect(r.layer.textContent).toContain(DEAL_ACT.agentRun('running')));
    expect(badges(r.layer).map((b) => b.textContent)).toEqual([PRACTICE]);
    const pop = await openDetails(r.layer);
    expect(badges(pop).map((b) => b.textContent)).toEqual([PRACTICE]);
  }, 60_000);

  it('does not render beside a sandbox run, on the chip or in Details', async () => {
    const r = await openDeal((x) => x.sandbox.deal_id);
    await waitFor(() => expect(r.layer.textContent).toContain(DEAL_ACT.agentRun('running')));
    expect(badges(r.layer)).toHaveLength(0);
    const pop = await openDetails(r.layer);
    expect(pop.textContent).toContain('claude-code');
    expect(badges(pop)).toHaveLength(0);
  }, 60_000);
});

describe('the Practice agent badge on the Settings agent rows', () => {
  it('renders on the practice run’s row and on no sandbox run’s row', async () => {
    const r = await renderLayerAtScale(async (w) => { await twoRuns(w); return { level: 'place', place: 'settings' }; }, 'large');
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => { fireEvent.keyDown(window, { key: 'p' }); });
    await settle();
    const card = [...r.layer.querySelectorAll<HTMLButtonElement>('button.pf-card')].find((b) => b.querySelector('.sc-label')?.textContent?.startsWith(SETTINGS_CARD.agents))!;
    fireEvent.click(card);
    const view = await waitFor(() => { const v = r.layer.querySelector<HTMLElement>('.pf-view'); if (!v) throw new Error('no view'); return v; });
    const now = await waitFor(() => within(view).getByRole('heading', { name: SETTINGS_AGENTS.now }));
    const rows = [...(now.nextElementSibling as HTMLElement).querySelectorAll('li')];
    expect(rows.length).toBeGreaterThan(1);
    const withBadge = rows.filter((li) => badges(li).length > 0);
    expect(withBadge).toHaveLength(1);
    expect(withBadge[0]!.textContent).toContain(SETTINGS_AGENTS.practice);
    for (const li of rows.filter((x) => x !== withBadge[0])) {
      expect(badges(li)).toHaveLength(0);
      expect(li.textContent).not.toContain(PRACTICE);
    }
  }, 60_000);
});

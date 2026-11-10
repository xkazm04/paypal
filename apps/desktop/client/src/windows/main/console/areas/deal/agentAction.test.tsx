// Start agent waits until the wallet knows whether an agent is running or paused: a read that has
// not answered (loading) or failed with nothing held is not "no run". The world's two queries are
// set by hand here; the mock backend never refuses a second start, so the refusal is not the test.
import { cleanup, render } from '@testing-library/react';
import type { RunSnapshot } from '@bindings/RunSnapshot';
import type { SettingsSnapshot } from '@bindings/SettingsSnapshot';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WalletError } from '../../../../../lib/contract';
import { DEAL_ACT } from '../../../../../lib/words';
import { buildMockState } from '../../../../../mock/fixtures';
import { ToastProvider } from '../../../ui';

const q = vi.hoisted(() => ({
  runs: { data: undefined, error: null, loading: true, refetch: async () => {} } as { data: unknown; error: unknown; loading: boolean; refetch: () => Promise<void> },
  settings: { data: undefined, error: null, loading: true, refetch: async () => {} } as { data: unknown; error: unknown; loading: boolean; refetch: () => Promise<void> },
}));
vi.mock('../../../../../lib/runtime', () => ({ backend: () => { throw new Error('no backend in this test'); } }));
vi.mock('../../../world', async (orig) => ({ ...(await orig<typeof import('../../../world')>()), useRuns: () => q.runs, useSettings: () => q.settings }));

import { AgentAction } from './DealPage';

const NOW = 1_800_000_000;
const state = buildMockState(NOW);
const haggle = state.deals.find((d) => d.deal.kind === 'haggle' && d.deal.state === 'NEGOTIATING')!.deal;
const settings = (paused: boolean) => ({ ...state.settings, agents_paused: paused }) as unknown as SettingsSnapshot;
const run = (over: Partial<RunSnapshot> = {}): RunSnapshot => ({ run: 'R1', deal_id: haggle.id, engine: 'policy', mode: haggle.mode, state: 'running', ...over }) as unknown as RunSnapshot;
const known = (data: unknown) => ({ data, error: null, loading: false, refetch: async () => {} });
const unreadable = { data: undefined, error: new WalletError({ code: 'UNAVAILABLE', message: 'no' } as never), loading: false, refetch: async () => {} };

const draw = (needs = false) => render(<ToastProvider><AgentAction deal={haggle} label="D" needs={needs} /></ToastProvider>);
const button = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('button')!;

afterEach(cleanup);

describe('Start agent while the wallet is not sure', () => {
  it('is disabled while the runs have not answered, and says it is still reading', () => {
    q.runs = { ...known(undefined), loading: true }; q.settings = known(settings(false));
    const { container } = draw();
    expect(button(container).disabled).toBe(true);
    expect(button(container).title).toBe(DEAL_ACT.startAgentReading);
  });

  it('is disabled while the settings have not answered', () => {
    q.runs = known([]); q.settings = { ...known(undefined), loading: true };
    const { container } = draw();
    expect(button(container).disabled).toBe(true);
    expect(button(container).title).toBe(DEAL_ACT.startAgentReading);
  });

  it('is disabled when the runs read failed with nothing held, and says it could not read', () => {
    q.runs = unreadable; q.settings = known(settings(false));
    const { container } = draw();
    expect(button(container).disabled).toBe(true);
    expect(button(container).title).toBe(DEAL_ACT.startAgentUnread);
  });

  it('keeps using a held answer when a later refresh failed', () => {
    q.runs = { ...known([]), error: new WalletError({ code: 'UNAVAILABLE', message: 'no' } as never) }; q.settings = known(settings(false));
    const { container } = draw();
    expect(button(container).disabled).toBe(false);
    expect(button(container).title).toBe(DEAL_ACT.startAgentTitle);
  });
});

describe('Start agent once the wallet knows', () => {
  it('no run and not paused: enabled, primary', () => {
    q.runs = known([]); q.settings = known(settings(false));
    const { container } = draw();
    expect(button(container).disabled).toBe(false);
    expect(button(container).title).toBe(DEAL_ACT.startAgentTitle);
    expect(button(container).textContent).toBe(DEAL_ACT.startAgent);
    expect(button(container).className).toMatch(/primary/);
  });

  it('the deal needs the owner: enabled, not primary', () => {
    q.runs = known([]); q.settings = known(settings(false));
    const { container } = draw(true);
    expect(button(container).disabled).toBe(false);
    expect(button(container).className).not.toMatch(/primary/);
  });

  it('paused: disabled with the paused wording', () => {
    q.runs = known([]); q.settings = known(settings(true));
    const { container } = draw();
    expect(button(container).disabled).toBe(true);
    expect(button(container).title).toBe(DEAL_ACT.agentsPausedTitle);
    expect(button(container).textContent).toBe(DEAL_ACT.agentsPaused);
  });

  it('a run is going: the run chip, no Start button', () => {
    q.runs = known([run()]); q.settings = known(settings(false));
    const { container } = draw();
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toContain(DEAL_ACT.agentRun('running'));
  });
});

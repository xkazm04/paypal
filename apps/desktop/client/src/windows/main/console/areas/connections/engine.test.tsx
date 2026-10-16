// The agent app picker (Connections > Agent app; moved from the old Settings checklist, whose test
// this keeps): a failed pick shows its error in the picker's own view, beside the button that was
// used, never as a silent no-op (first-run-onboarding round 2, robustness-2).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../../../lib/contract';
import { WalletError } from '../../../../../lib/contract';
import { CONNECTIONS_ENGINE, KEEP_PRACTICE_AGENT } from '../../../../../lib/words';
import { mockBackend, resetMockState } from '../../../../../mock/backend';
import { WorldProvider } from '../../../world';
import { EngineView } from './ConnectionsLayer';

const hoisted = vi.hoisted(() => ({ current: null as Backend | null, calls: [] as string[] }));
vi.mock('../../../../../lib/runtime', () => ({ backend: () => hoisted.current }));

const FAIL = 'The agent app could not be switched';
// The mock, with engine_select failing and, optionally, the owner's chosen agent app gone.
function failing(gone: boolean): Backend {
  const real = mockBackend('main');
  return {
    kind: real.kind,
    label: real.label,
    listen: (e, cb) => real.listen(e, cb),
    invoke: async (cmd, args, opts) => {
      hoisted.calls.push(cmd);
      if (cmd === 'engine_select') throw new WalletError({ code: 'INVALID', message: FAIL });
      const r = await real.invoke(cmd, args, opts);
      if (gone && cmd === 'get_settings') return { ...(r as object), selected_engine: 'claude-code' } as typeof r;
      if (gone && cmd === 'engine_status') {
        return (r as { id: string; available: boolean }[]).map((e) => (e.id === 'claude-code' ? { ...e, available: false, reason: 'not installed' } : e.id === 'scripted' ? { ...e, available: true } : e)) as typeof r;
      }
      return r;
    },
  };
}

const view = () => render(<WorldProvider><EngineView /></WorldProvider>);

describe('the agent app picker shows a failed pick where it was used', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); resetMockState(); hoisted.calls = []; history.replaceState(null, '', '/index.html?first_run=1'); });
  afterEach(() => { cleanup(); hoisted.current = null; });

  it('Keep the practice agent for now', async () => {
    hoisted.current = failing(false);
    view();
    const keep = await screen.findByRole('button', { name: KEEP_PRACTICE_AGENT.act });
    await waitFor(() => expect((keep as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(keep);
    const alert = await screen.findByText(FAIL);
    expect(alert.closest('[role="alert"]')).not.toBeNull();
    expect(alert.closest('.cn-view')).not.toBeNull();
    expect(hoisted.calls).toContain('engine_select');
  });

  it('Use practice agent', async () => {
    hoisted.current = failing(true);
    view();
    const use = await screen.findByRole('button', { name: CONNECTIONS_ENGINE.usePractice });
    await waitFor(() => expect((use as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(use);
    const alert = await screen.findByText(FAIL);
    expect(alert.closest('[role="alert"]')).not.toBeNull();
    // The picker stays a plain radio group: the chosen app is still the one that is gone, unchecked by nothing.
    expect(screen.getByRole('radiogroup', { name: CONNECTIONS_ENGINE.picker })).toBeTruthy();
  });
});

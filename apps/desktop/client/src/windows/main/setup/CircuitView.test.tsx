// A failed engine pick shows its error in the Simple checklist, beside the button that was
// clicked, with the popover closed (first-run-onboarding round 2, robustness-2).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../lib/contract';
import { WalletError } from '../../../lib/contract';
import { KEEP_PRACTICE_AGENT } from '../../../lib/words';
import { mockBackend, resetMockState } from '../../../mock/backend';
import { WorldProvider } from '../world';
import { SetupCircuit } from './CircuitView';

const hoisted = vi.hoisted(() => ({ current: null as Backend | null }));
vi.mock('../../../lib/runtime', () => ({ backend: () => hoisted.current }));

const FAIL = 'The agent app could not be switched';
// The mock, with engine_select failing and, optionally, the owner's chosen agent app gone.
function failing(gone: boolean): Backend {
  const real = mockBackend('main');
  return {
    kind: real.kind,
    label: real.label,
    listen: (e, cb) => real.listen(e, cb),
    invoke: async (cmd, args, opts) => {
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

const view = () => render(<WorldProvider><SetupCircuit onPair={() => {}} onMandates={() => {}} detail="simple" setDetail={() => {}} /></WorldProvider>);

describe('the checklist shows a failed agent app pick where it was clicked', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); resetMockState(); history.replaceState(null, '', '/index.html?first_run=1'); });
  afterEach(() => { cleanup(); hoisted.current = null; });

  it('Keep the practice agent for now', async () => {
    hoisted.current = failing(false);
    view();
    fireEvent.click(await screen.findByRole('button', { name: KEEP_PRACTICE_AGENT.act }));
    const alert = await screen.findByText(FAIL);
    expect(alert.closest('[role="alert"]')).not.toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull(); // the picker popover is closed
  });

  it('Use practice agent', async () => {
    hoisted.current = failing(true);
    view();
    fireEvent.click(await screen.findByRole('button', { name: 'Use practice agent' }));
    const alert = await screen.findByText(FAIL);
    expect(alert.closest('[role="alert"]')).not.toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});

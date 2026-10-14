// The Set up page in the first-run mock world: one step at a time, the hand-off wait state, and the
// page moving on by itself when a step's own state turns done.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../lib/contract';
import { KEEP_PRACTICE_AGENT, SETUP_NEXT, SETUP_NOT_DONE, SETUP_STEP_COPY, SETUP_WAITING } from '../../../lib/words';
import { mockBackend, resetMockState } from '../../../mock/backend';
import { WorldProvider } from '../world';
import { SetupPage } from './SetupPage';
import type { SetupStep } from '../logic';

const hoisted = vi.hoisted(() => ({ current: null as Backend | null, opened: [] as unknown[] }));
vi.mock('../../../lib/runtime', () => ({ backend: () => hoisted.current }));

// The mock, with the approval window stubbed (a browser tab cannot open here).
function stubbed(): Backend {
  const real = mockBackend('main');
  return {
    kind: real.kind,
    label: real.label,
    listen: (e, cb) => real.listen(e, cb),
    invoke: async (cmd, args, opts) => {
      if (cmd === 'approval_open') { hoisted.opened.push(args); return null as never; }
      return real.invoke(cmd, args, opts);
    },
  };
}

function view(step: SetupStep, onStep = vi.fn(), onDone = vi.fn()) {
  render(<WorldProvider><SetupPage step={step} onStep={onStep} onDone={onDone} /></WorldProvider>);
  return { onStep, onDone };
}

describe('the Set up page', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '', '/index.html?first_run=1'); resetMockState(); hoisted.opened = []; hoisted.current = stubbed(); });
  afterEach(() => { cleanup(); hoisted.current = null; });

  it('shows the step bar and the keys step with its one button', async () => {
    view('keys');
    expect(await screen.findByRole('heading', { name: SETUP_STEP_COPY.keys.lead })).toBeTruthy();
    expect(screen.getByRole('list', { name: /steps/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(SETUP_STEP_COPY.keys.act) })).toBeTruthy();
  });

  it('hands off to the approval step, waits, and says so when the window comes back unfinished', async () => {
    view('rules');
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(SETUP_STEP_COPY.rules.act) }));
    expect(await screen.findByText(SETUP_WAITING.title)).toBeTruthy();
    expect(hoisted.opened).toEqual([{ deal_id: null, target: 'mandate' }]);
    expect(screen.getByRole('button', { name: new RegExp(SETUP_WAITING.reopen) })).toBeTruthy();
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(await screen.findByText(SETUP_NOT_DONE.title, undefined, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(SETUP_WAITING.reopen) })).toBeTruthy();
  });

  it('moves on by itself when the agent step turns done', async () => {
    const { onStep } = view('agent');
    const keep = await screen.findByRole('button', { name: KEEP_PRACTICE_AGENT.act });
    await waitFor(() => expect((keep as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(keep);
    await waitFor(() => expect(onStep).toHaveBeenCalledWith('unlock'));
  });

  it('a step that was done on arrival offers Next instead of jumping ahead', async () => {
    resetMockState();
    const { onStep } = view('unlock');
    // unlocked in the mock: the last step is done and offers Done
    await waitFor(() => expect(screen.queryByText(SETUP_STEP_COPY.unlock.done)).not.toBeNull());
    expect(onStep).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: SETUP_NEXT })).toBeNull();
  });
});

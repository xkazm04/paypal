// The Rules card must not re-render every second: the clock only decides which signed sets are in force,
// so the card follows that (the keys of the sets in force) and renders when a set starts or ends.
// Measured with a Profiler over 60 simulated seconds once the card is showing its first question.
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetReadBudget } from '../../../../lib/data/invoke';
import { mockBackend, resetMockState } from '../../../../mock/backend';
import { setHarnessBackend } from '../../console/testing/runtime';
import { FlowTurnView } from './FlowTurnView';
import { resetFlows, startFlow, useFlows } from './store';

vi.mock('../../../../lib/runtime', async () => (await import('../../console/testing/runtime')).runtimeMock);
vi.mock('../../world', async (orig) => ({ ...(await orig<typeof import('../../world')>()), useLocked: () => false }));
MotionGlobalConfig.skipAnimations = true;

let commits = 0;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-11-06T09:30:00'));
  localStorage.clear();
  history.replaceState(null, '', '/index.html');
  resetMockState();
  resetReadBudget();
  resetFlows();
  setHarnessBackend(mockBackend('main'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); history.replaceState(null, '', '/'); localStorage.clear(); });

function Host() {
  const f = useFlows();
  return <Profiler id="rules" onRender={() => { commits += 1; }}><ol>{f.turns.map((t) => <li key={t.serial}><FlowTurnView turn={t} /></li>)}</ol></Profiler>;
}

describe('the rules card and the clock', () => {
  it('commits no more than once while 60 seconds pass with the same limits in force', async () => {
    render(<Host />);
    act(() => { startFlow('rules', 'perDeal'); });
    await waitFor(() => expect(document.querySelectorAll('.fc-choices button').length).toBeGreaterThan(1), { timeout: 5000 });
    await act(async () => { await Promise.resolve(); });
    commits = 0;
    for (let i = 0; i < 60; i += 1) await act(async () => { vi.advanceTimersByTime(1000); });
    console.info(`[RulesFlow.clock] Host commits over 60 simulated seconds on the card: ${commits}`);
    expect(commits).toBeLessThanOrEqual(1);
  });
});

// The Rewind chat flow: one live card, a day stepper bounded by the record, a recap per day, an empty-day
// line, and a button that opens the Rewind page. Clock pinned (Date only); read-only, nothing is sent but reads.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryStep } from '@bindings/HistoryStep';
import type { Backend } from '../../../../lib/contract';
import { mockBackend, resetMockState } from '../../../../mock/backend';
import { resetReadBudget } from '../../../../lib/data/invoke';
import { setHarnessBackend } from '../../console/testing/runtime';
import { resetHomeView, VIEW_KEY } from '../../switchboard/view';
import { ToastProvider } from '../../ui';
import { WorldProvider } from '../../world';
import { FlowTurnView } from './FlowTurnView';
import { recapOf, dayStart } from './RewindFlow';
import { REWIND_FLOW_WORDS as W } from './rewindWords';
import { resetFlows, startFlow, useFlows } from './store';

vi.mock('../../../../lib/runtime', async () => (await import('../../console/testing/runtime')).runtimeMock);

const PIN = new Date(2026, 10, 6, 9, 30); // Fri 6 Nov 2026 09:30 local
const at = (back: number, h: number) => Math.floor(new Date(2026, 10, 6 - back, h, 0).getTime() / 1000);
const step = (back: number, h: number, seq: number, kind: HistoryStep['kind'], auth: HistoryStep['authority']['type'], refused = false): HistoryStep => ({
  at: at(back, h), deal_id: 'D-0001' as never, seq, kind, state_after: null, authority: { type: auth } as never,
  paypal: refused ? { type: 'none' } : { type: 'call', method: 'capture', outcome: 'ok' },
});
// Today: a payment by the owner and one by a rule. Two days ago: one refusal. Three days back is the oldest.
const STEPS: HistoryStep[] = [
  step(3, 11, 1, 'captured', 'safe_default'),
  step(2, 14, 2, 'refused', 'signed_rule', true),
  step(0, 8, 3, 'captured', 'owner'),
  step(0, 9, 4, 'authorized', 'signed_rule'),
];

let calls: string[] = [];
function world(steps: HistoryStep[]): void {
  localStorage.clear();
  history.replaceState(null, '', '/');
  resetMockState();
  resetReadBudget();
  resetFlows();
  resetHomeView();
  const real = mockBackend('main');
  calls = [];
  const wrapped: Backend = {
    kind: real.kind, label: real.label, listen: real.listen,
    invoke: async (cmd, args, opts) => {
      calls.push(cmd);
      if (cmd === 'deal_history') return { steps, truncated: false } as never;
      return real.invoke(cmd, args, opts);
    },
  };
  setHarnessBackend(wrapped);
}

function Host() {
  const { turns } = useFlows();
  return <div>{turns.map((t) => <FlowTurnView key={t.serial} turn={t} />)}</div>;
}
const view = () => render(<ToastProvider><WorldProvider><Host /></WorldProvider></ToastProvider>);
const day = () => document.querySelector('.rwf-day')?.textContent;
const earlier = () => screen.getByRole('button', { name: W.earlierDay }) as HTMLButtonElement;
const later = () => screen.getByRole('button', { name: W.laterDay }) as HTMLButtonElement;

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(PIN); });
afterEach(() => { cleanup(); vi.useRealTimers(); setHarnessBackend(null); resetFlows(); resetHomeView(); history.replaceState(null, '', '/'); });

describe('recapOf', () => {
  it('counts decided, paid, stopped and needed-you inside the day only', () => {
    const now = Math.floor(PIN.getTime() / 1000);
    const today = recapOf(STEPS, dayStart(now, 0), dayStart(now, -1));
    expect(today).toMatchObject({ decided: 2, paid: 1, stopped: 0, needed: 1, empty: false });
    expect(today.notable).toHaveLength(2);
    expect(recapOf(STEPS, dayStart(now, 2), dayStart(now, 1))).toMatchObject({ decided: 0, stopped: 1, empty: false });
    expect(recapOf(STEPS, dayStart(now, 1), dayStart(now, 0))).toMatchObject({ empty: true });
  });
  it('keeps at most three notable moments', () => {
    const now = Math.floor(PIN.getTime() / 1000);
    const many = [1, 2, 3, 4, 5].map((i) => step(0, i, i, 'captured', 'owner'));
    expect(recapOf(many, dayStart(now, 0), dayStart(now, -1)).notable).toHaveLength(3);
  });
});

describe('the Rewind flow', () => {
  it('opens on today with its recap and steps back to the oldest recorded day, then stops', async () => {
    world(STEPS);
    startFlow('rewind', 'day');
    view();
    await waitFor(() => expect(document.querySelector('.rwf-figures')).not.toBeNull());
    expect(day()).toBe(W.today);
    expect(later().disabled).toBe(true);
    const figures = within(screen.getByLabelText(W.recapLabel));
    expect(figures.getByText(W.needed).nextSibling?.textContent).toBe('1');
    expect(figures.getByText(W.paid).nextSibling?.textContent).toBe('1');
    expect(document.querySelectorAll('.rwf-events li').length).toBe(2);

    fireEvent.click(earlier());
    expect(day()).toBe(W.yesterday);
    expect(screen.getByText(W.empty)).toBeTruthy();
    fireEvent.click(earlier());
    expect(day()).toBe('Wed 4 Nov');
    expect(within(screen.getByLabelText(W.recapLabel)).getByText(W.stopped).nextSibling?.textContent).toBe('1');
    fireEvent.click(earlier());
    expect(day()).toBe('Tue 3 Nov');
    // The oldest recorded day: Earlier is off and pressing on does nothing.
    expect(earlier().disabled).toBe(true);
    fireEvent.click(earlier());
    expect(day()).toBe('Tue 3 Nov');
    fireEvent.click(later());
    expect(day()).toBe('Wed 4 Nov');
    // One live card throughout; nothing but reads was sent.
    expect(document.querySelectorAll('.fc')).toHaveLength(1);
    expect(calls.filter((c) => /^(pairing_|engine_select|house_wake|mandate_|approval_|set_|credentials)/.test(c))).toEqual([]);
  });

  it('says an empty record is a quiet day, with Earlier off', async () => {
    world([]);
    startFlow('rewind', 'day');
    view();
    expect(await screen.findByText(W.empty)).toBeTruthy();
    expect(earlier().disabled).toBe(true);
    expect(later().disabled).toBe(true);
  });

  it('Replay in Everything opens the Rewind page and folds the card', async () => {
    world(STEPS);
    startFlow('rewind', 'day');
    view();
    await waitFor(() => expect(document.querySelector('.rwf-figures')).not.toBeNull());
    fireEvent.click(earlier());
    fireEvent.click(earlier());
    fireEvent.click(screen.getByRole('button', { name: W.replay }));
    expect(window.location.hash).toBe('#r=rewind');
    expect(localStorage.getItem(VIEW_KEY)).toBe('console');
    expect(await screen.findByText(W.replayed('Wed 4 Nov'))).toBeTruthy();
    expect(document.querySelector('.fc')).toBeNull();
  });

  it('Done and Cancel fold the card without leaving the chat', async () => {
    world(STEPS);
    startFlow('rewind', 'day');
    view();
    fireEvent.click(await screen.findByRole('button', { name: W.done }));
    expect(await screen.findByText(W.closed(W.today))).toBeTruthy();
    expect(window.location.hash).toBe('');
    cleanup();
    resetFlows();
    startFlow('rewind', 'day');
    view();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText(/Nothing changed/)).toBeTruthy();
    expect(localStorage.getItem(VIEW_KEY)).toBeNull();
  });
});

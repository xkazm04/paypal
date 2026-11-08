// The approval window reads the wallet's record, not its own memory (P17): on the mock backend's own
// deals, closing and reopening the window keeps the PayPal hand-off (phase, "Open PayPal again", the
// bound line) and the owner's decision (the bound line and a read-only "When you approved" fold);
// and a decision call that fails is described from the record read again, never as "Nothing was
// done" once the wallet recorded the decision.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../lib/contract';
import { mockBackend, resetMockState, STORE_KEY, type MockOptions } from '../../mock/backend';
import { buildMockState } from '../../mock/fixtures';
import { nowUnix } from '../../lib/format';
import { APPROVAL_AFTER_FAILURE } from '../../lib/words';
import { shownTime } from '../main/deal/shown';

const h = vi.hoisted(() => ({ current: null as Backend | null }));
vi.mock('../../lib/runtime', () => ({ backend: () => h.current }));

const { App } = await import('./App');

// The notice's heading reads "<what>: " before its sentence.
// Each case opens the window (and reopens it) on the mock: well past the default five seconds under load.
vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) });
  }
});
afterEach(() => { cleanup(); resetMockState(); history.replaceState(null, '', '/'); });

/** D-0190, the owner's purchase of a USB-C dock, put back to `state` with nothing open at PayPal and
 *  stored as the world the approval window loads. */
function seed(state: 'AGREED' | 'AWAITING_APPROVAL'): string {
  history.replaceState(null, '', '/index.html');
  resetMockState();
  const world = buildMockState(nowUnix());
  const d = world.deals.find((x) => x.display.label === 'D-0190')!;
  d.deal = { ...d.deal, state, paypal: { order: state === 'AGREED' ? null : '9DK204T', authorization: null, capture: null, subscription: null } };
  d.evidence = { ...d.evidence, money_check: null, receipt: 'NONE', reconciliation: 'not_applicable' };
  d.display = { ...d.display, deadline: nowUnix() + 6 * 3600 };
  d.attention = null;
  localStorage.setItem(STORE_KEY, JSON.stringify(world));
  return d.deal.id;
}

/** Opens (or reopens) the approval window on `id`: a fresh window, reading the stored world. */
function open(id: string, opts: MockOptions = {}) {
  history.replaceState(null, '', `/approval.html?deal=${id}`);
  const real = mockBackend('approval', opts);
  h.current = real;
  return { real, ...render(<App />) };
}

const enabled = (name: RegExp) => waitFor(() => {
  const b = screen.getByRole('button', { name });
  expect((b as HTMLButtonElement).disabled).toBe(false);
  return b;
}, { timeout: 8000 });

/** Press and hold a hold-to-confirm button until it fires. */
function hold(button: HTMLElement) {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
  fireEvent.pointerDown(button, { button: 0 });
  act(() => { vi.advanceTimersByTime(2000); });
  vi.useRealTimers();
}

describe('a reopened approval window reads the wallet’s record', () => {
  it('after Open PayPal, a reopen keeps the hand-off phase and the bound line', async () => {
    const id = seed('AWAITING_APPROVAL');
    const first = open(id);
    fireEvent.click(await enabled(/Open PayPal in your browser/));
    await screen.findByText(/Waiting for your approval on PayPal/);
    first.unmount();

    // Today a reopen showed a fresh gold "Open PayPal in your browser" and no line.
    open(id);
    await screen.findByText(/Waiting for your approval on PayPal/, undefined, { timeout: 8000 });
    expect(screen.getByRole('button', { name: /Open PayPal again/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Open PayPal in your browser/ })).toBeNull();
    const line = await screen.findByTestId('bound');
    expect(line.textContent).toMatch(/^✓You opened PayPal at \d\d:\d\d on the checks shown \(\d of \d passed/);
  });

  it('after approving the order, a reopen says when and on which checks, and folds the recorded lines', async () => {
    const id = seed('AGREED');
    const first = open(id);
    hold(await enabled(/Hold to approve \$64\.00/));
    await screen.findByTestId('bound', undefined, { timeout: 8000 });
    first.unmount();

    open(id);
    const line = await screen.findByTestId('bound', undefined, { timeout: 8000 });
    const at = shownTime(nowUnix(), nowUnix());
    expect(line.textContent).toMatch(new RegExp(`^✓You approved the order at ${at.slice(0, 2)}:\\d\\d on the checks shown \\(\\d of 6 passed( · \\d checked later)?\\), recorded with your decision\\. (Unchanged since|The list has changed since)\\.$`));
    const fold = within(screen.getByTestId('then')).getByRole('button', { name: /^When you approved · \d\d:\d\d/ });
    fireEvent.click(fold);
    const then = screen.getByTestId('then');
    // The recorded lines, each against the list now, and no button that acts on them.
    expect(then.querySelectorAll('[data-check]').length).toBeGreaterThan(0);
    expect(then.querySelectorAll('[data-then]').length).toBe(then.querySelectorAll('[data-check]:not(.fold)').length);
    for (const tag of then.querySelectorAll('[data-then]')) expect(['same', 'changed', 'now passes', 'now fails', 'not on the list now']).toContain(tag.textContent);
    expect(then.querySelectorAll('[data-money], .ui-hold')).toHaveLength(0);
    expect(then.textContent).toContain('Signed by the owner key after unlock');
  });
});

describe('a failed decision is told from the record read again', () => {
  const lostAt = async (failDecision: MockOptions['failDecision']) => {
    const id = seed('AGREED');
    open(id, { failDecision });
    hold(await enabled(/Hold to approve \$64\.00/));
  };

  it('a reply lost after the decision row: recorded, nothing sent, never “Nothing was done”', async () => {
    await lostAt('after_row');
    await screen.findByText(`${APPROVAL_AFTER_FAILURE.recorded.what}:`, undefined, { timeout: 8000 });
    expect(document.body.textContent).not.toMatch(/Nothing was done|so nothing was done/);
    expect(screen.getByTestId('bound').textContent).toMatch(/You approved the order at/);
  });

  it('a reply lost after the step went to PayPal: being checked, and no money button meanwhile', async () => {
    await lostAt('after_send');
    await screen.findByText(`${APPROVAL_AFTER_FAILURE.checking.what}:`, undefined, { timeout: 8000 });
    expect(document.body.textContent).not.toMatch(/Nothing was done|so nothing was done/);
    expect(screen.getByTestId('money-open').textContent).toMatch(/^…The payment request went to PayPal at \d\d:\d\d, and its answer is being checked\. Nothing more is sent until the wallet knows\.$/);
    expect(screen.queryByRole('button', { name: /Hold to approve/ })).toBeNull();
  });

  it('a failure before any row still reads “Nothing was done”', async () => {
    await lostAt('before_row');
    await screen.findByText('Not approved:', undefined, { timeout: 8000 });
    expect(document.body.textContent).toMatch(/nothing was done/);
    expect(screen.queryByTestId('bound')).toBeNull();
  });
});

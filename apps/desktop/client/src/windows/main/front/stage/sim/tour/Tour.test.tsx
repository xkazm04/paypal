// Smoke for the TOUR simulated first project on the first-run mock world (jsdom, the real App, Stage and
// hooks; clock pinned): the tour opens on the status line, Next moves on, Esc pauses it with a
// "Continue setup" turn that picks it up again, a setup step renders as a Stage item page with its
// breadcrumb and brings the approval page's own step up inline, and the plan skips a done step's page.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetReadBudget } from '../../../../../../lib/data/invoke';
import type { GettingStarted } from '../../../../../../lib/firstRun';
import { mockBackend, resetMockState } from '../../../../../../mock/backend';
import { setHarnessBackend } from '../../../../console/testing/runtime';
import { App } from '../../../../App';
import { resetHomeView } from '../../../../switchboard/view';
import { seek, stopIndex, STOPS } from './plan';
import { MARK, TOUR_W } from './words';

vi.mock('../../../../../../lib/runtime', async () => (await import('../../../../console/testing/runtime')).runtimeMock);

const PIN = new Date('2026-11-06T09:30:00');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(PIN);
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) });
  }
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function scrollTo() {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function scrollIntoView() {};
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  history.replaceState(null, '', '/');
  localStorage.clear();
  resetHomeView();
});

function world(search: string): void {
  localStorage.clear();
  sessionStorage.clear();
  resetHomeView();
  history.replaceState(null, '', `/index.html${search}`);
  resetMockState();
  resetReadBudget();
  setHarnessBackend(mockBackend('main'));
}

const mark = () => document.querySelector<HTMLElement>('.st-mark');
const markTitle = () => mark()?.querySelector('.st-mark-t')?.textContent ?? null;

describe('TOUR sim', () => {
  it('walks the marks, pauses on Esc and continues from the conversation', async () => {
    world('?home=stage&first_run=1&sim=tour');
    render(<App />);
    await waitFor(() => expect(markTitle()).toBe(MARK.status.title), { timeout: 8000 });
    expect(mark()?.textContent).toContain(TOUR_W.setupCount(0, 4));

    fireEvent.click(screen.getByRole('button', { name: TOUR_W.next }));
    // The first need of a new wallet is the setup: the tour's own checklist turn, lit by the second mark.
    await waitFor(() => expect(markTitle()).toBe(MARK.need.title));
    expect(document.querySelector('[data-st-setup]')?.textContent).toContain(TOUR_W.startSetup);
    const second = markTitle();

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await waitFor(() => expect(mark()).toBeNull());
    const cont = await screen.findByRole('button', { name: TOUR_W.continue }, { timeout: 5000 });
    expect(document.body.textContent).toContain(TOUR_W.paused(0, 4));

    fireEvent.click(cont);
    await waitFor(() => expect(markTitle()).toBe(second));
  }, 20000);

  it('a setup step is a Stage item page: Today › First project › Setup › Step 2 of 4 · Rules', async () => {
    world('?home=stage&first_run=1&sim=tour&st_at=page:rules');
    render(<App />);
    // Stage's own setup narration sends main to today once as the steps are first read; the tour puts
    // its page back. Let that settle, then always read the live page.
    const page = () => document.querySelector<HTMLElement>('[data-sim="tour"][data-step="rules"]');
    await waitFor(() => expect(page()).not.toBeNull(), { timeout: 8000 });
    await act(() => new Promise((r) => setTimeout(r, 400)));
    await waitFor(() => expect(page()).not.toBeNull());
    // Stage's crumb ("Today › First project") above, the page's own path below it.
    expect(page()!.closest('[data-stage="sim"]')?.querySelector('.fs-crumb')).not.toBeNull();
    expect(page()!.querySelector('.st-where')?.textContent).toContain(TOUR_W.stepOf(2, 4, 'Rules'));
    expect(mark()).toBeNull();
    // The secure step comes up inline: the approval page's own rules step, in this world.
    fireEvent.click(screen.getByRole('button', { name: TOUR_W.secureOpen }));
    const frame = await waitFor(() => { const f = page()?.querySelector('iframe'); expect(f).toBeTruthy(); return f!; });
    expect(frame.getAttribute('src')).toMatch(/^approval\.html\?target=mandate&first_run=1$/);
    expect(page()!.textContent).toContain(TOUR_W.secureNote);
  }, 20000);
});

describe('TOUR plan', () => {
  const gs = (done: string[]): GettingStarted => ({
    show: true, done: done.length, total: 4, next: null,
    steps: (['paypal', 'rules', 'practice', 'engine'] as const).map((key, i) => ({ key, n: i + 1, state: done.includes(key) ? 'done' : 'todo' })),
  });
  const all = () => true;

  it('passes over a done step, and celebrates only a step finished on its page', () => {
    const from = stopIndex('page:paypal');
    expect(STOPS[seek(from, 1, gs(['paypal']), new Set(), all)]!.id).toBe('page:rules');
    expect(STOPS[seek(from, 1, gs(['paypal']), new Set(['paypal']), all)]!.id).toBe('after:paypal');
  });

  it('Back never lands on an after-mark, and a missing region is skipped', () => {
    expect(STOPS[seek(stopIndex('after:paypal'), -1, gs(['paypal']), new Set(['paypal']), all)]!.id).toBe('ask');
    expect(STOPS[seek(stopIndex('need'), 1, gs([]), new Set(), (r) => r !== 'need')]!.id).toBe('side-switcher');
    expect(seek(stopIndex('page:engine') + 1, 1, gs(['paypal', 'rules', 'practice', 'engine']), new Set(), all)).toBe(-1);
  });
});

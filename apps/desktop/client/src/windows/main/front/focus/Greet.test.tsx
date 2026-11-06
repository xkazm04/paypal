// Smoke for the FOCUS fork on the browser mock world (jsdom, the real App and hooks): each state renders
// its opening message; the side lists the first need's module one row per item; a row click puts the
// item's focus card in the need card's slot and Esc puts the need back; the keyboard walks the rows; a
// typed question picks a module on the side; getting started stays in the conversation.
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../../lib/contract';
import { resetReadBudget } from '../../../../lib/data/invoke';
import { mockBackend, resetMockState } from '../../../../mock/backend';
import { setHarnessBackend } from '../../console/testing/runtime';
import { App } from '../../App';
import { resetHomeView } from '../../switchboard/view';
import { GREET } from './words';

vi.mock('../../../../lib/runtime', async () => (await import('../../console/testing/runtime')).runtimeMock);

const PIN = new Date('2026-11-06T09:30:00');
let calls: { cmd: string; args: unknown }[] = [];

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
  const real = mockBackend('main');
  calls = [];
  resetReadBudget();
  const wrapped: Backend = {
    kind: real.kind,
    label: real.label,
    invoke: async (cmd, args, opts) => { calls.push({ cmd, args }); if (cmd === 'approval_open') return null as never; return real.invoke(cmd, args, opts); },
    listen: real.listen,
  };
  setHarnessBackend(wrapped);
}

const ready = () => waitFor(() => expect(document.querySelector('[data-front="focus"][data-ready="true"]')).not.toBeNull(), { timeout: 5000 });
const chip = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.ff-chip')].find((b) => b.textContent === label);

describe('FOCUS front door', () => {
  it('opens on a status sentence and the one first need; the side lists the module holding it', async () => {
    world('?home=focus');
    render(<App />);
    await ready();
    const need = await waitFor(() => { const el = document.querySelector<HTMLElement>('[data-need]'); expect(el).not.toBeNull(); return el!; });
    expect(document.querySelector('.ff-status')?.textContent).toMatch(/need/);
    expect(document.querySelectorAll('.ff-focus').length).toBe(0);
    // the tab is the need's module, and the need's deal is a row in it
    const tab = document.querySelector('.ff-tab[aria-selected="true"]')!;
    await waitFor(() => expect(document.querySelector(`.ff-row[data-deal="${need.dataset.need}"]`)).not.toBeNull());
    expect(document.querySelector('.ff-list')?.getAttribute('data-list')).toBe(tab.getAttribute('data-module'));
  });

  it('a row click takes the slot; Esc and Back to today restore the need; arrows + Enter open rows', async () => {
    world('?home=focus');
    render(<App />);
    await ready();
    await waitFor(() => expect(document.querySelectorAll('.ff-row[data-row]').length).toBeGreaterThan(1));
    const rows = () => [...document.querySelectorAll<HTMLElement>('.ff-row[data-row]')];
    const second = rows()[1]!;
    await act(async () => { fireEvent.click(second); });
    await waitFor(() => expect(document.querySelector(`.ff-focus[data-focus="${second.dataset.row}"]`)).not.toBeNull());
    expect(document.querySelector('[data-need]')).toBeNull();
    expect(document.querySelector(`.ff-row[data-row="${second.dataset.row}"]`)?.getAttribute('aria-selected')).toBe('true');
    // Esc: back to today
    await act(async () => { fireEvent.keyDown(document.body, { key: 'Escape' }); });
    await waitFor(() => expect(document.querySelector('[data-need]')).not.toBeNull());
    expect(document.querySelector('.ff-focus')).toBeNull();
    // keyboard: down from the cursor, Enter opens
    const list = document.querySelector<HTMLElement>('.ff-list')!;
    await act(async () => { fireEvent.keyDown(list, { key: 'Home' }); });
    await act(async () => { fireEvent.keyDown(list, { key: 'ArrowDown' }); });
    await act(async () => { fireEvent.keyDown(list, { key: 'Enter' }); });
    await waitFor(() => expect(document.querySelector(`.ff-focus[data-focus="${rows()[1]!.dataset.row}"]`)).not.toBeNull());
    await act(async () => { fireEvent.click(document.querySelector('.ff-back')!); });
    await waitFor(() => expect(document.querySelector('[data-need]')).not.toBeNull());
  });

  it('Ask about this pre-fills the ask box; a question picks its module on the side', async () => {
    world('?home=focus&ff_pick=tables:0');
    render(<App />);
    await ready();
    const chipQ = await waitFor(() => { const b = document.querySelector<HTMLButtonElement>('.ff-askabout .ff-chip'); expect(b).not.toBeNull(); return b!; });
    await act(async () => { fireEvent.click(chipQ); });
    const input = document.querySelector<HTMLInputElement>('.ff-input')!;
    expect(input.value).toBe(chipQ.textContent);
    expect(calls.some((c) => c.cmd.startsWith('assistant'))).toBe(false);
    // sent, the question is about THIS deal: the reply keeps (or puts) its card in the slot
    const deal = document.querySelector<HTMLElement>('.ff-focus')!.dataset.focusDeal!;
    await act(async () => { fireEvent.submit(input.form!); });
    const said = () => [...document.querySelectorAll('.ff-transcript .ff-say > p')].map((p) => p.textContent).join(' | ');
    await waitFor(() => expect(said()).toMatch(/\w/));
    await waitFor(() => expect(document.querySelector('.ff-thinking')).toBeNull());
    expect(document.querySelector('.ff-focus')?.getAttribute('data-focus-deal')).toBe(deal);
    expect(said()).toContain(chipQ.textContent!.split(':')[0]);

    fireEvent.change(input, { target: { value: 'What is happening at the shop counter?' } });
    await act(async () => { fireEvent.submit(input.form!); });
    await waitFor(() => expect(document.querySelector('.ff-tab[data-module="counter"][aria-selected="true"]')).not.toBeNull());
    expect(document.querySelector('.ff-list')?.getAttribute('data-list')).toBe('counter');
    expect(document.querySelector('.ff-undo')).not.toBeNull();
    await act(async () => { fireEvent.click(document.querySelector('.ff-undo')!); });
    await waitFor(() => expect(document.querySelector('.ff-tab[data-module="tables"][aria-selected="true"]')).not.toBeNull());
  });

  it('back after away: the summary says what happened since the start of today', async () => {
    world('?home=focus&away=1');
    render(<App />);
    await ready();
    await waitFor(() => expect(document.querySelector('.ff-away')?.textContent).toMatch(/While you were away/), { timeout: 5000 });
  });

  it('first run: setup happens as the conversation, a setup proposal lands as a step card', async () => {
    world('?home=focus&first_run=1');
    render(<App />);
    await waitFor(() => expect(document.querySelector('.ff-status')?.textContent).toBe(GREET.welcome), { timeout: 5000 });
    await waitFor(() => expect(document.querySelector('[data-step="paypal"][data-state="todo"]')).not.toBeNull(), { timeout: 5000 });
    await act(async () => { fireEvent.click(chip(GREET.chipAllowed)!); });
    await waitFor(() => expect(document.querySelector(".ff-thinking")).toBeNull());
    // the scripted rules reply proposes the rules step: pressing it adds the step here, never the console
    const go = await waitFor(() => {
      const b = document.querySelector<HTMLButtonElement>('.ff-card.is-suggest button');
      expect(b).not.toBeNull();
      return b!;
    });
    await act(async () => { fireEvent.click(go); });
    await waitFor(() => expect(document.querySelector('[data-step="rules"]')).not.toBeNull());
    expect(calls.some((c) => c.cmd === 'approval_open')).toBe(false);
    expect(document.querySelector('[data-front="focus"]')).not.toBeNull();
  });
});

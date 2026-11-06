// Smoke for the THREAD front door on the browser mock world (jsdom, the real App and hooks): each state
// renders its opening message; a side row appends a look turn (never twice; Undo removes it); a chip and
// a typed question land in the conversation and open the side section; getting started stays in the
// conversation.
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../../lib/contract';
import { resetReadBudget } from '../../../../lib/data/invoke';
import { mockBackend, resetMockState } from '../../../../mock/backend';
import { setHarnessBackend } from '../../console/testing/runtime';
import { App } from '../../App';
import { resetHomeView } from '../../switchboard/view';
import { partOfDay } from './greeting';
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

const ready = () => waitFor(() => expect(document.querySelector('[data-front="thread"][data-ready="true"]')).not.toBeNull(), { timeout: 5000 });
const chip = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.ft-chip')].find((b) => b.textContent === label);

describe('THREAD front door', () => {
  it('the hello follows the clock, and has none in the small hours', () => {
    const at = (h: number) => new Date(2026, 10, 6, h, 30).getTime();
    expect(partOfDay(at(2))).toBeNull();
    expect(partOfDay(at(9))).toBe('morning');
    expect(partOfDay(at(14))).toBe('afternoon');
    expect(partOfDay(at(20))).toBe('evening');
    expect(GREET.hello(null)).toBe('');
  });

  it('opens on a status sentence, the first need and its module open on the side; a row becomes a turn', async () => {
    world('?home=thread');
    render(<App />);
    await ready();
    await waitFor(() => expect(document.querySelector('[data-need]')).not.toBeNull());
    expect(document.querySelector('.ft-status')?.textContent).toMatch(/^Good morning\..*need/);
    expect(document.querySelectorAll('.ft-panel').length).toBe(0);
    // the first need's section is open, one row per item
    const first = await waitFor(() => {
      const r = document.querySelector<HTMLButtonElement>('.ft-sec.is-open [data-row]');
      expect(r).not.toBeNull();
      return r!;
    });
    const key = first.dataset.row!;
    await act(async () => { fireEvent.click(first); });
    await waitFor(() => expect(document.querySelectorAll(`[data-look="${key}"]`).length).toBe(1));
    expect(document.querySelector(`[data-row="${key}"]`)?.classList.contains('is-sel')).toBe(true);
    expect(document.querySelector<HTMLInputElement>('.ft-input')?.placeholder).toMatch(/^Ask about /);
    // the same row again: no second turn
    await act(async () => { fireEvent.click(document.querySelector(`[data-row="${key}"]`)!); });
    expect(document.querySelectorAll(`[data-look="${key}"]`).length).toBe(1);
    // Undo removes the turn and the selection
    await act(async () => { fireEvent.click(document.querySelector('.ft-undo')!); });
    expect(document.querySelectorAll('[data-look]').length).toBe(0);
    expect(document.querySelector('.ft-row.is-sel')).toBeNull();

    await act(async () => { fireEvent.click(chip(GREET.chipSilence)!); });
    await waitFor(() => expect(document.querySelector('[data-panel="needs:*"]')).not.toBeNull());

    const input = document.querySelector<HTMLInputElement>('.ft-input')!;
    fireEvent.change(input, { target: { value: 'What is happening at the tables?' } });
    await act(async () => { fireEvent.submit(input.form!); });
    await waitFor(() => expect(document.querySelector('[data-panel="book:tables:*"]')).not.toBeNull());
    expect(document.querySelector('[data-section="tables"].is-open')).not.toBeNull();
  });

  it('back after away: the summary says what happened since the start of today', async () => {
    world('?home=thread&away=1');
    render(<App />);
    await ready();
    await waitFor(() => expect(document.querySelector('.ft-awayline')?.textContent).toMatch(/While you were away/), { timeout: 5000 });
  });

  it('first run: setup happens as the conversation, a setup proposal lands as a step card', async () => {
    world('?home=thread&first_run=1');
    render(<App />);
    await waitFor(() => expect(document.querySelector('.ft-status')?.textContent).toBe(GREET.welcome), { timeout: 5000 });
    await waitFor(() => expect(document.querySelector('[data-step="paypal"][data-state="todo"]')).not.toBeNull(), { timeout: 5000 });
    await act(async () => { fireEvent.click(chip(GREET.chipAllowed)!); });
    await waitFor(() => expect(document.querySelector(".ft-thinking")).toBeNull());
    // the scripted rules reply proposes the rules step: pressing it adds the step here, never the console
    const go = await waitFor(() => {
      const b = document.querySelector<HTMLButtonElement>('.ft-panel.is-suggest button');
      expect(b).not.toBeNull();
      return b!;
    });
    await act(async () => { fireEvent.click(go); });
    await waitFor(() => expect(document.querySelector('[data-step="rules"]')).not.toBeNull());
    expect(calls.some((c) => c.cmd === 'approval_open')).toBe(false);
    expect(document.querySelector('[data-front="thread"]')).not.toBeNull();
  });
});

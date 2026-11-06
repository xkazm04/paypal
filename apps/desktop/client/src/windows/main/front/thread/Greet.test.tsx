// Smoke for the GREET front door on the browser mock world (jsdom, the real App and hooks): each state
// renders its opening message, a chip and a typed question drill through the scripted engine into the
// side region and the module strip, and getting started stays in the conversation.
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

const ready = () => waitFor(() => expect(document.querySelector('[data-front="thread"][data-ready="true"]')).not.toBeNull(), { timeout: 5000 });
const chip = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.ft-chip')].find((b) => b.textContent === label);

describe('GREET front door', () => {
  it('opens on a status sentence and the one first need; a chip and a question drill into the side', async () => {
    world('?home=thread');
    render(<App />);
    await ready();
    await waitFor(() => expect(document.querySelector('[data-need]')).not.toBeNull());
    expect(document.querySelector('.ft-status')?.textContent).toMatch(/need/);
    // nothing composed yet: no grid, no panels
    expect(document.querySelectorAll('.ft-card').length).toBe(0);

    await act(async () => { fireEvent.click(chip(GREET.chipSilence)!); });
    await waitFor(() => expect(document.querySelector('[data-panel="needs:*"]')).not.toBeNull());
    expect(document.querySelector('.ft-undo')).not.toBeNull();

    const input = document.querySelector<HTMLInputElement>('.ft-input')!;
    fireEvent.change(input, { target: { value: 'What is happening at the tables?' } });
    await act(async () => { fireEvent.submit(input.form!); });
    await waitFor(() => expect(document.querySelector('[data-module="tables"].is-lit')).not.toBeNull());
    expect(document.querySelector('[data-panel="book:tables:*"]')).not.toBeNull();
  });

  it('back after away: the summary says what happened since the start of today', async () => {
    world('?home=thread&away=1');
    render(<App />);
    await ready();
    await waitFor(() => expect(document.querySelector('.ft-away')?.textContent).toMatch(/While you were away/), { timeout: 5000 });
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
      const b = document.querySelector<HTMLButtonElement>('.ft-card.is-suggest button');
      expect(b).not.toBeNull();
      return b!;
    });
    await act(async () => { fireEvent.click(go); });
    await waitFor(() => expect(document.querySelector('[data-step="rules"]')).not.toBeNull());
    expect(calls.some((c) => c.cmd === 'approval_open')).toBe(false);
    expect(document.querySelector('[data-front="thread"]')).not.toBeNull();
  });
});

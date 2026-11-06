// Smoke for the STAGE fork on the browser mock world (jsdom, the real App and hooks): each state renders
// its opening message; a row click turns main into the item's stage and Esc puts today back as it was;
// a chip and a typed question drive the stage and the side list through the scripted engine; getting
// started stays in the conversation.
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

const ready = () => waitFor(() => expect(document.querySelector('[data-front="stage"][data-ready="true"]')).not.toBeNull(), { timeout: 5000 });
const chip = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.fs-chip')].find((b) => b.textContent === label);

describe('STAGE front door', () => {
  it('a row opens its stage, Esc returns to today exactly as it was', async () => {
    world('?home=stage');
    render(<App />);
    await ready();
    await waitFor(() => expect(document.querySelector('[data-need]')).not.toBeNull());
    expect(document.querySelector('.fs-status')?.textContent).toMatch(/need/);
    // the side opens on the first need's module, one row per item
    const row = await waitFor(() => { const r = document.querySelector<HTMLButtonElement>('[data-row]'); expect(r).not.toBeNull(); return r!; });
    const key = row.dataset.row!;
    await act(async () => { fireEvent.click(row); });
    expect(document.querySelector(`[data-stage="${key}"]`)).not.toBeNull();
    expect(document.querySelector('[data-front="stage"]')?.getAttribute('data-staged')).toBe('true');
    expect(row.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector<HTMLInputElement>('.fs-input')?.placeholder).toMatch(/^Ask about /);
    // a question asked on the stage stays with the item (and is tagged in today's transcript)
    const input = document.querySelector<HTMLInputElement>('.fs-input')!;
    fireEvent.change(input, { target: { value: 'What if I do nothing?' } });
    await act(async () => { fireEvent.submit(input.form!); });
    await waitFor(() => expect(document.querySelector('.fs-ithread .fs-you')?.textContent).toBe('What if I do nothing?'));
    await waitFor(() => expect(document.querySelector('.fs-thinking')).toBeNull());
    if (!document.querySelector(`[data-stage="${key}"]`)) await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(document.querySelector('.fs-about')).not.toBeNull();
    expect(document.querySelector('[data-stage]')).toBeNull();
    expect(document.querySelector('[data-front="stage"]')?.getAttribute('data-staged')).toBe('false');
    expect(document.querySelector('[data-need]')).not.toBeNull();
  });

  it('a chip and a question drive the stage and the side list; Undo puts the navigation back', async () => {
    world('?home=stage');
    render(<App />);
    await ready();
    await waitFor(() => expect(document.querySelector('[data-need]')).not.toBeNull());
    await act(async () => { fireEvent.click(chip(GREET.chipSilence)!); });
    await waitFor(() => expect(document.querySelector('[data-stage^="panel:"]')).not.toBeNull());
    const undo = document.querySelector<HTMLButtonElement>('.fs-undo');
    expect(undo).not.toBeNull();
    await act(async () => { fireEvent.click(undo!); });
    expect(document.querySelector('[data-stage]')).toBeNull();

    const input = document.querySelector<HTMLInputElement>('.fs-input')!;
    fireEvent.change(input, { target: { value: 'What is happening at the tables?' } });
    await act(async () => { fireEvent.submit(input.form!); });
    await waitFor(() => expect(document.querySelector('[data-scope="tables"][aria-selected="true"]')).not.toBeNull());
  });

  it('back after away: the summary says what happened since the start of today', async () => {
    world('?home=stage&away=1');
    render(<App />);
    await ready();
    await waitFor(() => expect(document.querySelector('.fs-away')?.textContent).toMatch(/While you were away/), { timeout: 5000 });
  });

  it('first run: setup happens as the conversation, a setup proposal lands as a step card', async () => {
    world('?home=stage&first_run=1');
    render(<App />);
    await waitFor(() => expect(document.querySelector('.fs-status')?.textContent).toBe(GREET.welcome), { timeout: 5000 });
    await waitFor(() => expect(document.querySelector('[data-step="paypal"][data-state="todo"]')).not.toBeNull(), { timeout: 5000 });
    await act(async () => { fireEvent.click(chip(GREET.chipAllowed)!); });
    await waitFor(() => expect(document.querySelector(".fs-thinking")).toBeNull());
    // the scripted rules reply proposes the rules step: pressing it adds the step here, never the console
    const go = await waitFor(() => {
      const b = document.querySelector<HTMLButtonElement>('.fs-card.is-suggest button');
      expect(b).not.toBeNull();
      return b!;
    });
    await act(async () => { fireEvent.click(go); });
    await waitFor(() => expect(document.querySelector('[data-step="rules"]')).not.toBeNull());
    expect(calls.some((c) => c.cmd === 'approval_open')).toBe(false);
    expect(document.querySelector('[data-front="stage"]')).not.toBeNull();
  });
});

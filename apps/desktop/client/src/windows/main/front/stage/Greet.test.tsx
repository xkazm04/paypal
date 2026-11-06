// Smoke for the STAGE fork on the browser mock world (jsdom, the real App and hooks): each state renders
// its opening message; a row click turns main into the item's stage and Esc puts today back as it was;
// a chip and a typed question answer IN the conversation (round 3 routing rule) and only scope the side
// list; a reply about one deal offers its page; after the approval window main comes back with a line;
// StageHost drives Stage for the simulated first projects; getting started stays in the conversation.
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StageHost } from './sim/host';
import type { Backend } from '../../../../lib/contract';
import { resetReadBudget } from '../../../../lib/data/invoke';
import { mockBackend, resetMockState } from '../../../../mock/backend';
import { setHarnessBackend } from '../../console/testing/runtime';
import { App } from '../../App';
import { resetHomeView } from '../../switchboard/view';
import { GREET } from './words';

vi.mock('../../../../lib/runtime', async () => (await import('../../console/testing/runtime')).runtimeMock);
// The sims are other builders' files: here a stand-in keeps the host Stage hands it.
const sims = vi.hoisted(() => ({ host: null as StageHost | null, exit: null as (() => void) | null }));
vi.mock('./sim/Sim', () => ({ Sim: (p: { host: StageHost; exit: () => void }) => { sims.host = p.host; sims.exit = p.exit; return null; } }));
MotionGlobalConfig.skipAnimations = true;

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

/** Under a full parallel run the app renders slowly: the sim checks wait longer. */
const SLOW = { timeout: 5000 };
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
    // the answer stayed on the item's page: a reply never moves main
    expect(document.querySelector(`[data-stage="${key}"]`)).not.toBeNull();
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(document.querySelector('.fs-about')).not.toBeNull();
    await waitFor(() => expect(document.querySelector('[data-stage]')).toBeNull());
    expect(document.querySelector('[data-front="stage"]')?.getAttribute('data-staged')).toBe('false');
    expect(document.querySelector('[data-need]')).not.toBeNull();
  });

  it('a chip answers in the conversation (panels inline, main stays); Undo puts the list back', async () => {
    world('?home=stage');
    render(<App />);
    await ready();
    await waitFor(() => expect(document.querySelector('[data-need]')).not.toBeNull());
    await act(async () => { fireEvent.click(chip(GREET.chipSilence)!); });
    await waitFor(() => expect(document.querySelector('.fs-today [data-inline="needs"]')).not.toBeNull());
    expect(document.querySelector('[data-stage]')).toBeNull();
    expect(document.querySelector('[data-front="stage"]')?.getAttribute('data-staged')).toBe('false');
    expect(document.querySelector('.fs-fate')).not.toBeNull(); // the list was scoped to "needs"
    const undo = document.querySelector<HTMLButtonElement>('.fs-undo');
    expect(undo).not.toBeNull();
    await act(async () => { fireEvent.click(undo!); });
    expect(document.querySelector('.fs-fate')).toBeNull();
    expect(document.querySelector('[data-inline="needs"]')).not.toBeNull(); // the answer itself stays

    const input = document.querySelector<HTMLInputElement>('.fs-input')!;
    fireEvent.change(input, { target: { value: 'What is happening at the tables?' } });
    await act(async () => { fireEvent.submit(input.form!); });
    await waitFor(() => expect(document.querySelector('[data-scope="tables"][aria-selected="true"]')).not.toBeNull());
  });

  it('a reply about one deal offers its page; after the approval window main comes back with a line', async () => {
    world('?home=stage');
    render(<App />);
    await ready();
    const id = await waitFor(() => { const n = document.querySelector<HTMLElement>('[data-need]'); expect(n).not.toBeNull(); return n!.dataset.need!; });
    const input = document.querySelector<HTMLInputElement>('.fs-input')!;
    fireEvent.change(input, { target: { value: `Tell me about ${id}` } });
    await act(async () => { fireEvent.submit(input.form!); });
    const link = await waitFor(() => { const b = document.querySelector<HTMLButtonElement>('[data-open-link]'); expect(b).not.toBeNull(); return b!; });
    expect(document.querySelector('[data-stage]')).toBeNull(); // offered, not opened
    await act(async () => { fireEvent.click(link); });
    await waitFor(() => expect(document.querySelector('[data-front="stage"]')?.getAttribute('data-staged')).toBe('true'));
    const review = await waitFor(() => { const b = [...document.querySelectorAll<HTMLButtonElement>('.fs-onstage button')].find((x) => x.textContent === GREET.review); expect(b).toBeDefined(); return b!; });
    await act(async () => { fireEvent.click(review); });
    await waitFor(() => expect(calls.some((c) => c.cmd === 'approval_open')).toBe(true));
    // the approval window takes focus, then gives it back
    await act(async () => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(document.querySelector('[data-front="stage"]')?.getAttribute('data-staged')).toBe('false'), { timeout: 3000 });
    expect([...document.querySelectorAll('.fs-today .fs-say p')].some((p) => p.textContent?.startsWith('Back from the approval window'))).toBe(true);
  });

  it('the engine label is gone from under the ask box', async () => {
    world('?home=stage');
    render(<App />);
    await ready();
    expect(document.querySelector('.fs-answers')).toBeNull();
    expect(document.querySelector('.fs-askwrap')?.textContent ?? '').not.toMatch(/Answers by/);
  });

  it('StageHost: say lands a turn, setMain shows sim content with the Today crumb, back returns; the sim world has its badge', async () => {
    sims.host = null;
    world('?home=stage&first_run=1&sim=guide');
    render(<App />);
    await waitFor(() => expect(sims.host).not.toBeNull(), { timeout: 5000 });
    const host = sims.host!;
    expect(document.querySelector('[data-sim-badge]')).not.toBeNull();
    expect(document.querySelector('[data-try-first]')).toBeNull();
    expect(host.region('ask')).not.toBeNull();
    expect(host.region('side-switcher')).not.toBeNull();
    await act(async () => { host.setMain(<p data-simpage>step one</p>); });
    await waitFor(() => expect(document.querySelector('[data-stage="sim"] [data-simpage]')).not.toBeNull(), SLOW);
    expect(document.querySelector('[data-stage="sim"] .fs-crumb-home')).not.toBeNull();
    await act(async () => { host.back(); });
    await waitFor(() => expect(document.querySelector('[data-stage="sim"]')).toBeNull(), SLOW);
    await act(async () => { host.setMain(<p data-simpage>step two</p>); });
    await waitFor(() => expect(document.querySelector('[data-stage="sim"]')).not.toBeNull(), SLOW);
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    await waitFor(() => expect(document.querySelector('[data-stage="sim"]')).toBeNull(), SLOW);
    await act(async () => { host.setMain(<p data-simpage>step three</p>); });
    await act(async () => { host.say({ text: 'Your first project is ready.', card: <b data-simcard>card</b> }); });
    await waitFor(() => expect(document.querySelector('[data-front="stage"]')?.getAttribute('data-staged')).toBe('false'), SLOW);
    expect(document.querySelector('.fs-today [data-simcard]')).not.toBeNull();
    expect(document.querySelector('.fs-today')?.textContent).toContain('Your first project is ready.');
  });

  it('the everyday world offers the simulation menu', async () => {
    world('?home=stage');
    render(<App />);
    await ready();
    const t = await waitFor(() => { const b = document.querySelector<HTMLButtonElement>('[data-try-first]'); expect(b).not.toBeNull(); return b!; });
    await act(async () => { fireEvent.click(t); });
    expect([...document.querySelectorAll<HTMLAnchorElement>('[data-sim-option]')].map((a) => a.getAttribute('href'))).toEqual(['?home=stage&first_run=1&sim=guide', '?home=stage&first_run=1&sim=tour', '?home=stage&first_run=1&sim=story']);
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

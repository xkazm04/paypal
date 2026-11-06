// The home on the browser mock world (jsdom, the real App and hooks; clock pinned): it is the default
// view and switches with the console both ways; each state renders its opening message; a row click
// turns main into the item's page and Esc puts today back as it was; a chip and a typed question answer
// IN the conversation (the routing rule) and only scope the side list; a reply about one deal offers
// its page; after the approval window main comes back with a line; GuideHost drives the home for the
// setup guide, which is mounted exactly while the wallet is in setup.
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuideHost } from './guide/host';
import type { Backend } from '../../../lib/contract';
import { resetReadBudget } from '../../../lib/data/invoke';
import { mockBackend, resetMockState } from '../../../mock/backend';
import { setHarnessBackend } from '../console/testing/runtime';
import { App } from '../App';
import { resetHomeView, VIEW_KEY } from '../switchboard/view';
import { GREET } from './words';

vi.mock('../../../lib/runtime', async () => (await import('../console/testing/runtime')).runtimeMock);
// The guide is tested in guide/; here a stand-in keeps the host the home hands it.
const guide = vi.hoisted(() => ({ host: null as GuideHost | null }));
vi.mock('./guide/Guide', () => ({ Guide: (p: { host: GuideHost }) => { guide.host = p.host; return null; } }));
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

/** Under a full parallel run the app renders slowly: the guide checks wait longer. */
const SLOW = { timeout: 5000 };
const ready = () => waitFor(() => expect(document.querySelector('[data-front="stage"][data-ready="true"]')).not.toBeNull(), { timeout: 5000 });
const chip = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.fs-chip')].find((b) => b.textContent === label);

describe('the home', () => {
  it('a row opens its stage, Esc returns to today exactly as it was', async () => {
    world('');
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
    world('');
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
    world('');
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
    world('');
    render(<App />);
    await ready();
    expect(document.querySelector('.fs-answers')).toBeNull();
    expect(document.querySelector('.fs-askwrap')?.textContent ?? '').not.toMatch(/Answers by/);
  });

  it('GuideHost: the regions are marked, pick moves the side list, say lands a turn in today’s conversation', async () => {
    guide.host = null;
    world('?first_run=1');
    render(<App />);
    await waitFor(() => expect(guide.host).not.toBeNull(), { timeout: 5000 });
    const host = guide.host!;
    expect(document.querySelector('[data-front="stage"]')?.getAttribute('data-guided')).toBe('true');
    for (const r of ['status', 'transcript', 'ask', 'side', 'side-switcher'] as const) expect(host.region(r), r).not.toBeNull();
    // a new wallet has no rows yet: pick still moves the side list to that module
    await act(async () => { host.pick('tables', null); });
    await waitFor(() => expect(document.querySelector('[data-scope="tables"][aria-selected="true"]')).not.toBeNull(), SLOW);
    await act(async () => { host.back(); });
    expect(document.querySelector('[data-front="stage"]')?.getAttribute('data-staged')).toBe('false');
    await act(async () => { host.say({ text: 'Keys saved.', card: <b data-guidecard>card</b> }); });
    await waitFor(() => expect(document.querySelector('[data-front="stage"]')?.getAttribute('data-staged')).toBe('false'), SLOW);
    expect(document.querySelector('.fs-today [data-guidecard]')).not.toBeNull();
    expect(document.querySelector('.fs-today')?.textContent).toContain('Keys saved.');
  });

  it('a set-up wallet has no guide, no simulation entry and no prototype switches', async () => {
    guide.host = null;
    world('');
    render(<App />);
    await ready();
    expect(guide.host).toBeNull();
    expect(document.querySelector('[data-front="stage"]')?.hasAttribute('data-guided')).toBe(false);
    expect(document.querySelector('[data-try-first], [data-sim-badge]')).toBeNull();
  });

  it('back after away: the summary says what happened since the start of today', async () => {
    world('?away=1');
    render(<App />);
    await ready();
    await waitFor(() => expect(document.querySelector('.fs-away')?.textContent).toMatch(/While you were away/), { timeout: 5000 });
  });

  it('first run: the opening is the status line only; the guide leads setup and nothing opens a window', async () => {
    guide.host = null;
    world('?first_run=1');
    render(<App />);
    await waitFor(() => expect(document.querySelector('.fs-status')?.textContent).toBe(GREET.welcome), { timeout: 5000 });
    await waitFor(() => expect(guide.host).not.toBeNull(), { timeout: 5000 });
    expect(document.querySelector('.fs-sub')).toBeNull();
    expect(document.querySelector('.fs-chips')).toBeNull();
    expect(document.querySelector('[data-step]')).toBeNull(); // the old setup cards are gone
    expect(calls.some((c) => c.cmd === 'approval_open')).toBe(false);
  });
});

describe('the default home and the view switch', () => {
  it('with no address and nothing remembered the app opens on the home; it switches both ways and remembers the choice', async () => {
    world('');
    render(<App />);
    await ready();
    expect(document.querySelector('.cs-app')).toBeNull();
    fireEvent.click([...document.querySelectorAll('.fs-bar button')].find((b) => b.textContent === GREET.toConsole)!);
    await waitFor(() => expect(document.querySelector('.cs-app')).not.toBeNull());
    expect(document.querySelector('[data-front="stage"]')).toBeNull();
    expect(localStorage.getItem(VIEW_KEY)).toBe('console');
    fireEvent.click(document.getElementById('cs-place-board')!);
    await ready();
    expect(localStorage.getItem(VIEW_KEY)).toBe('board');
  });

  it('a console deep link opens the console; ?view= wins over the remembered choice', async () => {
    world('#d=D-0193');
    render(<App />);
    await waitFor(() => expect(document.querySelector('.cs-app')).not.toBeNull());
    expect(document.querySelector('[data-front="stage"]')).toBeNull();
    cleanup();
    world('?view=board#d=D-0193');
    render(<App />);
    await ready();
    cleanup();
    world('?view=console');
    localStorage.setItem(VIEW_KEY, 'board');
    resetHomeView();
    render(<App />);
    await waitFor(() => expect(document.querySelector('.cs-app')).not.toBeNull());
    fireEvent.click(document.getElementById('cs-place-board')!);
    await ready();
    expect(window.location.search).toContain('view=board');
  });

  it('blocked storage does not break the switch', async () => {
    world('');
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<App />);
    await ready();
    fireEvent.click([...document.querySelectorAll('.fs-bar button')].find((b) => b.textContent === GREET.toConsole)!);
    await waitFor(() => expect(document.querySelector('.cs-app')).not.toBeNull());
    spy.mockRestore();
  });
});

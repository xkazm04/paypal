// A failed "Review in the approval window" says so where the click happened: on the need card and on
// the item page. The notice shows once (one press, one copy), clears on the next successful open and
// goes with the surface when the owner leaves the page. The mock's approval_open is made to fail.
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../lib/contract';
import { resetReadBudget } from '../../../lib/data/invoke';
import { mockBackend, resetMockState } from '../../../mock/backend';
import { setHarnessBackend } from '../console/testing/runtime';
import { App } from '../App';
import { resetHomeView } from '../switchboard/view';

vi.mock('../../../lib/runtime', async () => (await import('../console/testing/runtime')).runtimeMock);
MotionGlobalConfig.skipAnimations = true;

const PIN = new Date('2026-11-06T09:30:00');
let failOpen = true;
let opens = 0;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(PIN);
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) });
  }
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function scrollTo() {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function scrollIntoView() {};
  localStorage.clear();
  sessionStorage.clear();
  resetHomeView();
  history.replaceState(null, '', '/index.html');
  resetMockState();
  const real = mockBackend('main');
  failOpen = true;
  opens = 0;
  resetReadBudget();
  const wrapped: Backend = {
    kind: real.kind,
    label: real.label,
    invoke: async (cmd, args, opts) => {
      if (cmd === 'approval_open') {
        opens += 1;
        if (failOpen) throw Object.assign(new Error('The approval window did not open.'), { code: 'UNAVAILABLE' });
        return null as never;
      }
      return real.invoke(cmd, args, opts);
    },
    listen: real.listen,
  };
  setHarnessBackend(wrapped);
});
afterEach(() => { cleanup(); vi.useRealTimers(); history.replaceState(null, '', '/'); localStorage.clear(); resetHomeView(); });

const ready = () => waitFor(() => expect(document.querySelector('[data-front="stage"][data-ready="true"]')).not.toBeNull(), { timeout: 5000 });
const notices = () => document.querySelectorAll('.notice');
const goldIn = (root: Element) => root.querySelector<HTMLButtonElement>('.fs-acts .btn.gold, .fs-acts button.gold');

describe('a failed approval-open on the home', () => {
  it('the need card says so beside its button, once, and clears on the next successful open', async () => {
    render(<App />);
    await ready();
    const card = await waitFor(() => { const n = document.querySelector<HTMLElement>('[data-need]'); expect(n).not.toBeNull(); return n!; });
    const gold = goldIn(card);
    expect(gold, 'the need card offers a review').not.toBeNull();
    expect(notices().length).toBe(0);
    await act(async () => { fireEvent.click(gold!); });
    await waitFor(() => expect(card.querySelector('.notice')).not.toBeNull());
    expect(opens).toBe(1);
    expect(notices().length).toBe(1);
    // pressable again; a successful open clears the notice
    failOpen = false;
    await act(async () => { fireEvent.click(goldIn(card)!); });
    await waitFor(() => expect(notices().length).toBe(0));
    expect(opens).toBe(2);
  });

  it('the item page says so beside its button, and leaving the page takes the notice with it', async () => {
    render(<App />);
    await ready();
    const id = await waitFor(() => { const n = document.querySelector<HTMLElement>('[data-need]'); expect(n).not.toBeNull(); return n!.dataset.need!; });
    const row = await waitFor(() => { const r = document.querySelector<HTMLButtonElement>(`[data-row$=":${id}"]`); expect(r, 'the need is a row of the list').not.toBeNull(); return r!; });
    await act(async () => { fireEvent.click(row); });
    const stage = await waitFor(() => { const s = document.querySelector<HTMLElement>('[data-stage]'); expect(s).not.toBeNull(); return s!; });
    const gold = await waitFor(() => { const g = goldIn(stage); expect(g, 'the item page offers a review').not.toBeNull(); return g!; });
    await act(async () => { fireEvent.click(gold); });
    await waitFor(() => expect(stage.querySelector('.notice')).not.toBeNull());
    expect(notices().length).toBe(1);
    // back to today: the item page is gone, and so is its notice (the need card did not press it)
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    await waitFor(() => expect(document.querySelector('[data-stage]')).toBeNull());
    expect(notices().length).toBe(0);
  });
});

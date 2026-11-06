// Smoke for sim STORY on the browser mock first-run world (jsdom, the real App, Stage and hooks):
// the opening asks for a goal; a goal leads to the agent app (real engine_select), then the practice
// shop (real pairing_join HOUSE); the confirmation, the signature and the keys are the approval
// page's (an inline frame here, never a privileged call from Main); skip keeps the place and the
// story resumes from the conversation. Also: the goal sentences read into rules with the wallet's
// own reader, and the secure step's address carries the first-run world.
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../../../../lib/contract';
import { resetReadBudget } from '../../../../../../lib/data/invoke';
import { rulesOf } from '../../../../../../lib/say/draft';
import { read } from '../../../../../../lib/say/read';
import { mockBackend, resetMockState } from '../../../../../../mock/backend';
import { setHarnessBackend } from '../../../../console/testing/runtime';
import { App } from '../../../../App';
import { resetHomeView } from '../../../../switchboard/view';
import { secureSrc } from './Secure';
import { resetStoryForTests, story } from './store';
import { GOALS, STORY } from './words';

vi.mock('../../../../../../lib/runtime', async () => (await import('../../../../console/testing/runtime')).runtimeMock);
MotionGlobalConfig.skipAnimations = true;

const PIN = new Date('2026-11-06T09:30:00');
const PRIVILEGED = ['pairing_confirm', 'mandate_sign', 'set_credentials', 'deal_join', 'deal_create'];
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

function world(): void {
  localStorage.clear();
  sessionStorage.clear();
  resetHomeView();
  history.replaceState(null, '', '/index.html?home=stage&first_run=1&sim=story');
  resetMockState();
  resetStoryForTests();
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

const WAIT = { timeout: 5000 };
const text = () => document.querySelector('.fs-transcript')?.textContent ?? '';
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim().startsWith(label));

describe('sim STORY', () => {
  it('goal first, then the agent app and the practice shop just in time; privileged steps go to the approval page', async () => {
    world();
    render(<App />);
    await waitFor(() => expect(text()).toContain(STORY.opening), WAIT);
    expect(document.querySelector('[data-ss-pill]')?.textContent).toContain(STORY.progress(0, 4));

    await act(async () => { fireEvent.click(document.querySelector('[data-ss-goal="haggle"]')!); });
    await waitFor(() => expect(text()).toContain(STORY.engineAsk), WAIT);
    expect(story().goal).toBe('haggle');

    await act(async () => { fireEvent.click(document.querySelector('[data-ss-engine="scripted"]')!); });
    await waitFor(() => expect(calls.some((c) => c.cmd === 'engine_select')).toBe(true), WAIT);
    await waitFor(() => expect(text()).toContain(STORY.shopAsk), WAIT);
    expect(story().phase).toBe('shop');
    expect(document.querySelector('[data-ss-pill]')?.textContent).toContain(STORY.progress(1, 4));

    const payee = document.querySelector<HTMLInputElement>('[data-ss-payee]')!;
    fireEvent.change(payee, { target: { value: 'maya@example.com' } });
    await act(async () => { fireEvent.submit(payee.form!); });
    await waitFor(() => expect(calls.some((c) => c.cmd === 'pairing_join' && (c.args as { code: string }).code === 'HOUSE')).toBe(true), WAIT);
    // the confirmation is the approval page, inline in the stage slot (browser preview)
    const frame = await waitFor(() => { const f = document.querySelector<HTMLIFrameElement>('iframe[data-ss-frame="practice"]'); expect(f).not.toBeNull(); return f!; }, WAIT);
    expect(frame.getAttribute('src')).toMatch(/^approval\.html\?pairing=.*&target=pairing&first_run=1$/);
    expect(calls.map((c) => c.cmd).filter((c) => PRIVILEGED.includes(c))).toEqual([]);
    expect(calls.some((c) => c.cmd === 'approval_open')).toBe(false);
  });

  it('skip keeps the place; Continue setup resumes it', async () => {
    world();
    render(<App />);
    await waitFor(() => expect(text()).toContain(STORY.opening), WAIT);
    await act(async () => { fireEvent.click(document.querySelector('[data-ss-goal="askFirst"]')!); });
    await waitFor(() => expect(text()).toContain(STORY.engineAsk), WAIT);
    await act(async () => { fireEvent.click(document.querySelector('[data-ss-skip]')!); });
    await waitFor(() => expect(text()).toContain(STORY.skipped), WAIT);
    expect(story()).toMatchObject({ paused: true, phase: 'engine', goal: 'askFirst' });
    expect(document.querySelector('[data-ss-pill]')?.getAttribute('data-ss-pill')).toBe('paused');
    await act(async () => { fireEvent.click(button(STORY.resume)!); });
    await waitFor(() => expect(story().paused).toBe(false), WAIT);
    await waitFor(() => expect(text().split(STORY.engineAsk).length).toBe(3), WAIT); // asked again, after the pause
  });
});

describe('sim STORY pieces', () => {
  it('each suggested goal reads into signable rules with the wallet’s own reader', () => {
    const now = Math.floor(PIN.getTime() / 1000);
    const ctx = { now, offsetMin: 0, payees: [], housePayees: [], items: [] };
    for (const g of Object.values(GOALS)) {
      const r = read(g.sentence, ctx);
      const rules = rulesOf(r, ctx);
      expect(rules, g.sentence).not.toBeNull();
      expect(rules!.clauses.length, g.sentence).toBeGreaterThan(0);
    }
  });

  it('the secure step keeps the preview world', () => {
    history.replaceState(null, '', '/index.html?first_run=1');
    expect(secureSrc({ deal_id: null, target: 'credentials' })).toBe('approval.html?target=credentials&first_run=1');
    history.replaceState(null, '', '/index.html');
    expect(secureSrc({ deal_id: null, target: 'mandate', draft: { type: 'band', floor: null, ceiling: null } })).toBe(`approval.html?target=mandate&draft=${encodeURIComponent(JSON.stringify({ type: 'band', floor: null, ceiling: null })).replace(/%20/g, '+')}`);
  });
});

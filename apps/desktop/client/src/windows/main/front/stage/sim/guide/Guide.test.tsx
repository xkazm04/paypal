// Smoke for the GUIDE simulation on the first-run mock world (jsdom, the real App, Stage and hooks):
// the opening turn, Start, the keys step done by the approval page's own privileged call (never by
// the guide), the onboarding line and the next step, Skip for now and Continue setup.
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../../../../lib/contract';
import { resetReadBudget } from '../../../../../../lib/data/invoke';
import { mockBackend, resetMockState } from '../../../../../../mock/backend';
import { setHarnessBackend } from '../../../../console/testing/runtime';
import { App } from '../../../../App';
import { resetHomeView } from '../../../../switchboard/view';
import type { GettingStarted } from '../../../../../../lib/firstRun';
import type { StartStepKey } from '../../../../../../lib/words';
import { guideNext, guideSteps } from './order';
import { secureUrl } from './SecureStep';
import { SG, SG_LEARNED } from './words';

vi.mock('../../../../../../lib/runtime', async () => (await import('../../../../console/testing/runtime')).runtimeMock);
// The other two simulations are built in parallel; this smoke is about the guide only.
vi.mock('../tour/Tour', () => ({ TourSim: () => null }));
vi.mock('../story/Story', () => ({ StorySim: () => null }));

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
    invoke: async (cmd, args, opts) => { calls.push({ cmd, args }); return real.invoke(cmd, args, opts); },
    listen: real.listen,
  };
  setHarnessBackend(wrapped);
}

const btn = (root: ParentNode, text: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text) ?? null;
const turns = () => [...document.querySelectorAll('[data-sim-region="transcript"] > li')].map((l) => l.textContent ?? '');

describe('GUIDE simulation', () => {
  it('walks the first project in the conversation; the secure step is the approval page, never the guide', async () => {
    world('?home=stage&first_run=1&sim=guide');
    render(<App />);
    const plan = await waitFor(() => { const p = document.querySelector('[data-sg-card="plan"]'); expect(p).not.toBeNull(); return p!; }, { timeout: 5000 });
    expect(turns().some((t) => t.startsWith(SG.open))).toBe(true);
    expect(plan.querySelector('[data-sg-progress]')?.getAttribute('data-sg-progress')).toBe('0/4');

    await act(async () => { fireEvent.click(btn(plan, SG.start)!); });
    const step = await waitFor(() => { const s = document.querySelector('[data-sg-card="step"][data-sg-step="paypal"][data-state="todo"]'); expect(s).not.toBeNull(); return s!; }, { timeout: 5000 });
    expect(turns().some((t) => t.startsWith(SG_LEARNED.intro))).toBe(true);

    // The secure step opens the real approval page inline (browser mock), in this world.
    await act(async () => { fireEvent.click(btn(step, SG.secureOpen)!); });
    const frame = await waitFor(() => { const f = step.querySelector<HTMLIFrameElement>('iframe.sg-iframe'); expect(f).not.toBeNull(); return f!; });
    expect(frame.getAttribute('src')).toMatch(/^approval\.html\?.*target=credentials.*first_run=1/);
    // ...and the guide itself never calls a privileged command, nor opens a window.
    expect(calls.some((c) => c.cmd === 'set_credentials' || c.cmd === 'mandate_sign' || c.cmd === 'approval_open')).toBe(false);

    // What the framed page does: its own mock, approval label and token, the same world.
    history.replaceState(null, '', '/approval.html?target=credentials&first_run=1');
    const approval = mockBackend('approval');
    const token = await approval.invoke('approval_token', null);
    await act(async () => { await approval.invoke('set_credentials', 'paypal_sandbox', { token }); });
    history.replaceState(null, '', '/index.html?home=stage&first_run=1&sim=guide');

    // The guide meets the practice shop before the rules (order.ts: rules need a payee to sign).
    await waitFor(() => expect(document.querySelector('[data-sg-card="step"][data-sg-step="practice"][data-state="todo"]')).not.toBeNull(), { timeout: 5000 });
    expect(turns().some((t) => t.startsWith(SG_LEARNED.paypal))).toBe(true);
    expect(document.querySelector('[data-sg-card="step"][data-sg-step="paypal"]')?.getAttribute('data-state')).toBe('done');
    expect(document.querySelector('[data-scope="book"][aria-selected="true"]')).not.toBeNull();

    // Skip for now: back to the home, progress kept, Continue setup picks it up.
    const practice = document.querySelector('[data-sg-card="step"][data-sg-step="practice"]')!;
    await act(async () => { fireEvent.click(btn(practice, SG.skip)!); });
    const cont = await waitFor(() => { const c = document.querySelector('[data-sg-card="continue"]'); expect(c).not.toBeNull(); return c!; });
    expect(turns().some((t) => t.startsWith(SG.paused(1, 4)))).toBe(true);
    await act(async () => { fireEvent.click(btn(cont, SG.continue)!); });
    await waitFor(() => expect(document.querySelectorAll('[data-sg-card="step"][data-sg-step="practice"][data-state="todo"]').length).toBe(1));
    expect(document.querySelector('[data-sg-card="folded"]')).not.toBeNull();
  });

  it('walks the shop before the rules, and reads progress only from the world', () => {
    const gs = (done: StartStepKey[]): GettingStarted => ({ show: true, total: 4, done: done.length, next: null,
      steps: (['paypal', 'rules', 'practice', 'engine'] as const).map((key, i) => ({ key, n: i + 1, state: done.includes(key) ? 'done' : 'todo' })) });
    expect(guideNext(gs([]))).toBe('paypal');
    expect(guideNext(gs(['paypal']))).toBe('practice');
    expect(guideNext(gs(['paypal', 'practice']))).toBe('rules');
    expect(guideNext(gs(['paypal', 'practice', 'rules', 'engine']))).toBeNull();
    expect(guideSteps(gs(['paypal'])).map((s) => `${s.key}:${s.state}`)).toEqual(['paypal:done', 'practice:next', 'rules:todo', 'engine:todo']);
  });

  it('the secure page URL carries the target, the draft and the world', () => {
    expect(secureUrl({ deal_id: null, target: 'credentials' }, { world: 'first_run', degrade: false, locked: false })).toBe('approval.html?target=credentials&first_run=1');
    const u = secureUrl({ deal_id: null, pairing: [1, 2] as never }, { world: 'first_run', degrade: false, locked: false });
    expect(new URLSearchParams(u.split('?')[1]).get('pairing')).toBe('[1,2]');
    expect(new URLSearchParams(u.split('?')[1]).get('target')).toBe('pairing');
  });
});

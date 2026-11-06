// Smoke for the TOUR simulated first project, round 4 (the AI-led setup), on the first-run mock world
// (jsdom, the real App, Stage and hooks; clock pinned): the opening is ONE turn with ONE component (the
// keys' secure step); the keys saved by the approval context's own privileged call (never by the tour)
// bring the rules turn with its plain-words proposal; "Looks right" puts the secure step up with that
// draft; signed there, the practice shop's turn follows; Skip for now / Continue setup; and a question
// asked on the rules proposal changes it ("$80 a deal") and offers the step again under the answer.
// The secure step itself is the SECURE builder's (sim/secure); here it is a stand-in carrying its props.
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecureStepProps } from '../secure/contract';
import { resetReadBudget } from '../../../../../../lib/data/invoke';
import type { Backend } from '../../../../../../lib/contract';
import { mockBackend, resetMockState } from '../../../../../../mock/backend';
import { setHarnessBackend } from '../../../../console/testing/runtime';
import { App } from '../../../../App';
import { resetHomeView } from '../../../../switchboard/view';
import { resetFlow } from './flow';
import { STEP, TOUR_W } from './words';

vi.mock('../../../../../../lib/runtime', async () => (await import('../../../../console/testing/runtime')).runtimeMock);
vi.mock('../guide/Guide', () => ({ GuideSim: () => null }));
vi.mock('../story/Story', () => ({ StorySim: () => null }));
vi.mock('../secure/SecureStep', () => ({
  SecureStep: (p: SecureStepProps) => (
    <div data-secure={p.kind} data-done={p.done ? 'true' : 'false'} data-draft={p.draft ?? ''} data-pairing={p.pairing ?? ''}>
      <button type="button" onClick={p.onCancel}>cancel</button>
    </div>
  ),
}));

const PIN = new Date('2026-11-06T09:30:00');
let calls: string[] = [];

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
  resetFlow();
});

const URL0 = '/index.html?home=stage&first_run=1&sim=tour';
function world(): void {
  localStorage.clear();
  sessionStorage.clear();
  resetHomeView();
  resetFlow();
  history.replaceState(null, '', URL0);
  resetMockState();
  resetReadBudget();
  const real = mockBackend('main');
  calls = [];
  const wrapped: Backend = { kind: real.kind, label: real.label, invoke: async (cmd, args, opts) => { calls.push(cmd); return real.invoke(cmd, args, opts); }, listen: real.listen };
  setHarnessBackend(wrapped);
}

/** What the approval context does in its own page: its own mock, the approval label and session token. */
async function asApproval<T>(target: string, f: (approval: Backend, token: string) => Promise<T>): Promise<T> {
  history.replaceState(null, '', `/approval.html?target=${target}&first_run=1`);
  try {
    const approval = mockBackend('approval');
    const token = (await approval.invoke('approval_token', null)) as string;
    return await f(approval, token);
  } finally {
    history.replaceState(null, '', URL0);
  }
}

const live = () => [...document.querySelectorAll<HTMLElement>('.st-turn')];
const secure = () => [...document.querySelectorAll<HTMLElement>('[data-secure]')];
const turns = () => [...document.querySelectorAll('[data-sim-region="transcript"] > li')].map((l) => l.textContent ?? '');
const btn = (root: ParentNode, text: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text) ?? null;

describe('TOUR sim (AI-led setup)', () => {
  it('one turn, one component: keys -> rules (proposal, then the secure step) -> practice; skip and continue', async () => {
    world();
    render(<App />);
    // The opening: the status line, then ONE assistant turn with ONE component (the keys' secure step).
    await waitFor(() => expect(secure().map((s) => s.dataset.secure)).toEqual(['keys']), { timeout: 8000 });
    expect(live()).toHaveLength(1);
    expect(turns().filter((t) => t.includes(TOUR_W.open))).toHaveLength(1);
    expect(live()[0]!.textContent).toContain(TOUR_W.stepOf(1, 3));
    expect(document.querySelector('[data-sim-region="status"]')).not.toBeNull();

    // Keys saved in the approval context (set_credentials is privileged: the tour never calls it).
    await act(async () => { await asApproval('credentials', (a, token) => a.invoke('set_credentials', 'paypal_sandbox', { token })); });
    await waitFor(() => expect(document.querySelector('[data-secure="keys"]')?.getAttribute('data-done')).toBe('true'), { timeout: 5000 });
    // ...its success state, then the next turn: the rules proposal in plain words.
    await waitFor(() => expect(document.querySelector('.st-turn[data-st-turn="rules"]')).not.toBeNull(), { timeout: 5000 });
    expect(turns().some((t) => t.startsWith(`${STEP.paypal.done} ${STEP.rules.lead}`))).toBe(true);
    expect(live()).toHaveLength(1);
    expect(secure()).toHaveLength(0);
    const rules = document.querySelector<HTMLElement>('[data-st-rules]')!;
    expect(rules.textContent).toContain(TOUR_W.payees);
    expect(rules.querySelector('[data-rule="per-deal"]')?.textContent).toBe(TOUR_W.perDeal('$100'));
    expect(document.querySelector('[data-st-turn="paypal"][data-state="done"]')).not.toBeNull();

    // Looks right -> the secure step with that draft (the practice shop is its payee).
    fireEvent.click(btn(live()[0]!, TOUR_W.looksRight)!);
    const s = await waitFor(() => { const el = document.querySelector<HTMLElement>('[data-secure="rules"]'); expect(el).not.toBeNull(); return el!; });
    const draft = JSON.parse(s.dataset.draft!) as { type: string; agent: 'negotiator'; not_before: number; expires?: number; clauses: { type: string; payees?: string[] }[] };
    expect(draft.type).toBe('rules');
    expect(draft.clauses.find((c) => c.type === 'payees')?.payees).toEqual(['HOUSE']);

    // Signed in the approval context -> the practice shop's turn.
    await act(async () => {
      await asApproval('mandate', (a, token) => a.invoke('mandate_sign', { id: null, agent: draft.agent, clauses: draft.clauses as never, not_before: draft.not_before, expires: draft.expires ?? draft.not_before + 7 * 86400 }, { token }));
    });
    await waitFor(() => expect(document.querySelector('.st-turn[data-st-turn="practice"]')).not.toBeNull(), { timeout: 6000 });
    expect(live()).toHaveLength(1);
    // The practice turn holds the agent app first (folded in, round 5); the shop's form waits for it.
    expect(live()[0]!.textContent).toContain(TOUR_W.stepOf(3, 3));
    expect(live()[0]!.querySelector('[data-engine="scripted"]')).not.toBeNull();
    expect(live()[0]!.querySelector('#st-payee')).toBeNull();
    // Picking the practice agent folds the choice to its done line; the shop's form follows in the same turn.
    fireEvent.click(live()[0]!.querySelector<HTMLButtonElement>('[data-engine="scripted"]')!);
    await waitFor(() => expect(live()[0]!.querySelector('#st-payee')).not.toBeNull(), { timeout: 5000 });
    expect(live()[0]!.querySelector('[data-st-turn="engine"][data-state="done"]')).not.toBeNull();
    expect(live()[0]!.querySelector('[data-engine]')).toBeNull();
    expect(calls.some((c) => c === 'set_credentials' || c === 'mandate_sign' || c === 'approval_open')).toBe(false);

    // Skip for now: back to the home, one "Continue setup" line; Continue offers the same step again.
    fireEvent.click(btn(live()[0]!, TOUR_W.skip)!);
    const cont = await waitFor(() => { const c = document.querySelector<HTMLElement>('[data-st-continue]'); expect(c).not.toBeNull(); return c!; });
    expect(live()).toHaveLength(0);
    expect(turns().some((t) => t.startsWith(TOUR_W.paused(3, 3, STEP.practice.short)))).toBe(true);
    fireEvent.click(cont);
    await waitFor(() => expect(document.querySelector('.st-turn[data-st-turn="practice"]')).not.toBeNull());
    expect(document.querySelector('[data-st-continue]')).toBeNull();
    expect(live()).toHaveLength(1);
  }, 30000);

  it('a question on the rules proposal changes it and offers the step again under the answer', async () => {
    world();
    await asApproval('credentials', (a, token) => a.invoke('set_credentials', 'paypal_sandbox', { token }));
    render(<App />);
    // Reload-style resume: keys are done, so the flow opens on the rules.
    await waitFor(() => expect(document.querySelector('.st-turn[data-st-turn="rules"]')).not.toBeNull(), { timeout: 8000 });
    expect(turns().some((t) => t.startsWith(`${TOUR_W.resume} ${STEP.rules.lead}`))).toBe(true);
    fireEvent.click(btn(live()[0]!, TOUR_W.change)!);
    expect(document.body.textContent).toContain(TOUR_W.changeHint);

    const input = document.querySelector<HTMLInputElement>('[data-sim-region="ask"] input')!;
    fireEvent.change(input, { target: { value: 'make it $80 a deal' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(document.querySelector('[data-rule="per-deal"]')?.textContent).toBe(TOUR_W.perDeal('$80')), { timeout: 8000 });
    expect(turns().some((t) => t.startsWith(TOUR_W.changed('up to $80 a deal')))).toBe(true);
    // Never two open components: the older rules turn folded.
    expect(live()).toHaveLength(1);
    expect(document.querySelector('[data-st-turn="rules"][data-state="folded"]')).not.toBeNull();
  }, 30000);
});

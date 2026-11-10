// The Rules flow on the browser mock world (jsdom, hooks real, clock pinned): single-question cards
// from the wallet limits to the sentence preview and the secure step; the chat never signs or writes
// limits itself, a signature made in the approval context ends the flow with the new sentence, Cancel
// leaves it, and a locked wallet ends it in one line.
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../../lib/contract';
import { resetReadBudget } from '../../../../lib/data/invoke';
import { mockBackend, resetMockState } from '../../../../mock/backend';
import { setHarnessBackend } from '../../console/testing/runtime';
import type { SecureStepProps } from '../secure/contract';
import { UI_WORDS } from '../../../../lib/words';
import { WalletError } from '../../../../lib/contract';
import { FlowTurnView } from './FlowTurnView';
import { currentRules } from './RulesFlow';
import { resetFlows, startFlow, useFlows } from './store';
import { FLOW_WORDS } from './words';
import { RULES_FLOW as W } from './rulesWords';

vi.mock('../../../../lib/runtime', async () => (await import('../../console/testing/runtime')).runtimeMock);
const locked = vi.hoisted(() => ({ on: false }));
vi.mock('../../world', async (orig) => ({ ...(await orig<typeof import('../../world')>()), useLocked: () => locked.on }));
vi.mock('../secure/SecureStep', () => ({
  SecureStep: (p: SecureStepProps) => (
    <div data-secure={p.kind} data-done={p.done ? 'true' : 'false'} data-draft={p.draft ?? ''}><button type="button" onClick={p.onCancel}>cancel-sign</button></div>
  ),
}));
MotionGlobalConfig.skipAnimations = true;

let calls: string[] = [];
let failList = false;
let emptyList = false;
const handlers: Record<string, ((p: never) => void)[]> = {};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-06T09:30:00'));
  locked.on = false;
  localStorage.clear();
  history.replaceState(null, '', '/index.html');
  resetMockState();
  resetReadBudget();
  resetFlows();
  const real = mockBackend('main');
  calls = [];
  failList = false;
  emptyList = false;
  for (const k of Object.keys(handlers)) delete handlers[k];
  const wrapped: Backend = { kind: real.kind, label: real.label, invoke: async (cmd, args, opts) => { calls.push(cmd); if (failList && cmd === 'mandate_list') throw new WalletError({ code: 'REFUSED', message: 'no' }); if (emptyList && cmd === 'mandate_list') return []; return real.invoke(cmd, args, opts); }, listen: (ev, cb) => { (handlers[ev] ??= []).push(cb as (p: never) => void); return real.listen(ev, cb); } };
  setHarnessBackend(wrapped);
});
afterEach(() => { cleanup(); vi.useRealTimers(); history.replaceState(null, '', '/'); localStorage.clear(); });

function Host() {
  const f = useFlows();
  return <ol>{f.turns.map((t) => <li key={t.serial}><FlowTurnView turn={t} /></li>)}</ol>;
}
const live = () => document.querySelector<HTMLElement>('.fc');
const btns = () => [...(live()?.querySelectorAll<HTMLButtonElement>('.fc-choices button') ?? [])];
const step = () => live()?.getAttribute('data-step');
const waitStep = (s: string) => waitFor(() => expect(step()).toBe(s), { timeout: 5000 });
const folded = () => [...document.querySelectorAll('.fc-folded')].map((e) => e.textContent ?? '');

async function toSign(): Promise<void> {
  render(<Host />);
  act(() => { startFlow('rules', 'perDeal'); });
  for (const s of ['perDeal', 'perDay', 'askAbove']) {
    await waitFor(() => { expect(step()).toBe(s); expect(btns().length).toBeGreaterThan(1); }, { timeout: 5000 });
    expect(btns()[0]!.textContent).toMatch(/^Keep /);
    fireEvent.click(btns()[0]!);
  }
  await waitStep('ends');
  fireEvent.click(btns().find((b) => b.textContent === 'for a week')!);
  await waitStep('review');
  fireEvent.click(btns().find((b) => b.textContent === W.review.sign)!);
  await waitStep('sign');
}

describe('the rules flow', () => {
  it('asks one question per card, previews the sentence and hands the draft to the secure step', async () => {
    await toSign();
    expect(folded().some((t) => t.startsWith('Most per deal:'))).toBe(true);
    const s = document.querySelector<HTMLElement>('[data-secure="rules"]')!;
    const draft = JSON.parse(s.dataset.draft!) as { type: string; clauses: { type: string }[] };
    expect(draft.type).toBe('rules');
    expect(draft.clauses.some((c) => c.type === 'per_deal')).toBe(true);
    // the chat itself never signs or writes limits
    expect(calls.some((c) => /mandate_sign|mandate_write|approval_open|settings_write/.test(c))).toBe(false);
  });

  it('a limit signed in the approval context ends the flow with the new sentence', async () => {
    await toSign();
    const draft = JSON.parse(document.querySelector<HTMLElement>('[data-secure="rules"]')!.dataset.draft!) as { agent: 'negotiator'; not_before: number; expires?: number; clauses: unknown[] };
    history.replaceState(null, '', '/approval.html?target=mandate');
    const approval = mockBackend('approval');
    const token = (await approval.invoke('approval_token', null)) as string;
    history.replaceState(null, '', '/index.html');
    await act(async () => { await approval.invoke('mandate_sign', { id: null, agent: draft.agent, clauses: draft.clauses as never, not_before: draft.not_before, expires: draft.expires ?? draft.not_before + 7 * 86400 }, { token }); });
    await waitFor(() => expect(document.querySelector('[data-secure="rules"]')?.getAttribute('data-done')).toBe('true'), { timeout: 5000 });
    await waitFor(() => expect(folded().some((t) => t.startsWith('Limits changed:'))).toBe(true), { timeout: 6000 });
    expect(live()).toBeNull();
  });

  it('Cancel leaves the limits as they were', async () => {
    render(<Host />);
    act(() => { startFlow('rules', 'perDeal'); });
    await waitFor(() => expect(btns().length).toBeGreaterThan(1), { timeout: 5000 });
    fireEvent.click(document.querySelector<HTMLButtonElement>('.fc-cancel')!);
    expect(folded()).toEqual([FLOW_WORDS.cancelled]);
    expect(calls.some((c) => /sign|write/.test(c))).toBe(false);
  });

  it('closing the secure step ends the flow unsigned', async () => {
    await toSign();
    fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'cancel-sign')!);
    await waitFor(() => expect(folded()).toContain(W.notSigned));
  });

  it('a locked wallet says so in one line and ends', async () => {
    locked.on = true;
    render(<Host />);
    act(() => { startFlow('rules', 'perDeal'); });
    await waitFor(() => expect(folded()).toEqual([W.locked]));
    expect(live()).toBeNull();
  });

  it('a failed limits read says so, offers no amounts, and Try again reads again', async () => {
    failList = true;
    render(<Host />);
    act(() => { startFlow('rules', 'perDeal'); });
    await waitFor(() => expect(live()?.querySelector('.ui-failed')).not.toBeNull(), { timeout: 5000 });
    expect(btns()).toEqual([]);
    expect(live()?.textContent).not.toMatch(/Keep /);
    const reads = () => calls.filter((c) => c === 'mandate_list').length;
    const before = reads();
    failList = false;
    fireEvent.click([...live()!.querySelectorAll('button')].find((b) => b.textContent === UI_WORDS.tryAgain)!);
    await waitFor(() => expect(btns().length).toBeGreaterThan(1), { timeout: 5000 });
    expect(reads()).toBeGreaterThan(before);
    expect(live()?.querySelector('.ui-failed')).toBeNull();
  });

  it('with no signed rules, currentRules marks the starting values as suggested', () => {
    expect(currentRules([], 1_000).suggested).toBe(true);
  });

  it('a held answer survives a failed refresh: the choices stay and no failure shows', async () => {
    render(<Host />);
    act(() => { startFlow('rules', 'perDeal'); });
    await waitFor(() => expect(btns().length).toBeGreaterThan(1), { timeout: 5000 });
    const before = calls.filter((c) => c === 'mandate_list').length;
    failList = true;
    await act(async () => { (handlers['settings:changed'] ?? []).forEach((h) => h(undefined as never)); });
    await waitFor(() => expect(calls.filter((c) => c === 'mandate_list').length).toBeGreaterThan(before), { timeout: 5000 });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(btns().length).toBeGreaterThan(1);
    expect(live()?.querySelector('.ui-failed')).toBeNull();
  });

  it('suggested starting values are offered as Use, with the suggested line; signed limits stay Keep', async () => {
    emptyList = true;
    render(<Host />);
    act(() => { startFlow('rules', 'perDeal'); });
    await waitFor(() => expect(btns().length).toBeGreaterThan(1), { timeout: 5000 });
    expect(btns()[0]!.textContent).toMatch(/^Use \$/);
    expect(live()?.textContent).toContain(W.suggested);
    cleanup(); resetFlows(); resetReadBudget(); emptyList = false;
    render(<Host />);
    act(() => { startFlow('rules', 'perDeal'); });
    await waitFor(() => expect(btns().length).toBeGreaterThan(1), { timeout: 5000 });
    expect(btns()[0]!.textContent).toMatch(/^Keep \$/);
    expect(live()?.textContent).not.toContain(W.suggested);
  });
});

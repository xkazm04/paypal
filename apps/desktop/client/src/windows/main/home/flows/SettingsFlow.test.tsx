// The Settings flow on the browser mock world (jsdom, hooks real, clock pinned): topic, one question
// per card, a consent press ("Apply"), then Undo for a few seconds; Cancel changes nothing; a locked
// wallet says so in one line and ends.
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../../lib/contract';
import { resetReadBudget } from '../../../../lib/data/invoke';
import { mockBackend, resetMockState } from '../../../../mock/backend';
import { currentTheme, setTheme } from '../../../../lib/theme';
import { setHarnessBackend } from '../../console/testing/runtime';
import { WorldProvider } from '../../world';
import { FlowTurnView } from './FlowTurnView';
import { resetFlows, startFlow, useFlows } from './store';
import { FLOW_WORDS } from './words';
import { SETTINGS_FLOW as W } from './settingsWords';

vi.mock('../../../../lib/runtime', async () => (await import('../../console/testing/runtime')).runtimeMock);
const locked = vi.hoisted(() => ({ on: false }));
vi.mock('../../world', async (orig) => ({ ...(await orig<typeof import('../../world')>()), useLocked: () => locked.on }));
// The undo window is shortened so the test waits it out in real time.
vi.mock('./settingsWords', async (orig) => ({ ...(await orig<typeof import('./settingsWords')>()), UNDO_MS: 600 }));
MotionGlobalConfig.skipAnimations = true;

let calls: string[] = [];
let real: Backend;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-06T09:30:00'));
  locked.on = false;
  localStorage.clear();
  history.replaceState(null, '', '/index.html');
  resetMockState();
  resetReadBudget();
  resetFlows();
  setTheme('dark');
  real = mockBackend('main');
  calls = [];
  const wrapped: Backend = { kind: real.kind, label: real.label, invoke: async (cmd, args, opts) => { calls.push(cmd); return real.invoke(cmd, args, opts); }, listen: real.listen };
  setHarnessBackend(wrapped);
});
afterEach(() => { cleanup(); vi.useRealTimers(); history.replaceState(null, '', '/'); localStorage.clear(); setTheme('dark'); });

function Host() {
  const f = useFlows();
  return <WorldProvider><ol>{f.turns.map((t) => <li key={t.serial}><FlowTurnView turn={t} /></li>)}</ol></WorldProvider>;
}
const live = () => document.querySelector<HTMLElement>('.fc');
const btn = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.fc button')].find((b) => b.textContent === text);
const press = async (text: string) => { const b = await waitFor(() => { const x = btn(text); expect(x).toBeTruthy(); expect(x!.disabled).toBe(false); return x!; }, { timeout: 5000 }); fireEvent.click(b); };
const folded = () => [...document.querySelectorAll('.fc-folded')].map((e) => e.textContent ?? '');

describe('the settings flow', () => {
  it('look: theme and calm motion apply only after Apply, and Undo puts the theme back', async () => {
    render(<Host />);
    act(() => { startFlow('settings', 'topic'); });
    await press(W.topic.look);
    await press(W.theme.light);
    await press(W.calm.off);
    expect(currentTheme()).toBe('dark');
    await press(W.confirm.apply);
    await waitFor(() => expect(live()?.getAttribute('data-step')).toBe('done'));
    expect(currentTheme()).toBe('light');
    await press(W.done.undo);
    await waitFor(() => expect(folded()).toContain(W.done.undone));
    expect(currentTheme()).toBe('dark');
  });

  it('alerts: one question, Apply writes the notification choice from a fresh read', async () => {
    render(<Host />);
    act(() => { startFlow('settings', 'topic'); });
    await press(W.topic.alerts);
    await press(W.alerts.dnd);
    expect(calls).not.toContain('settings_write');
    await press(W.confirm.apply);
    await waitFor(() => expect(calls).toContain('settings_write'));
    await waitFor(() => expect(live()?.getAttribute('data-step')).toBe('done'));
    expect(((await real.invoke('get_settings', null)) as { preferences: { dnd: boolean } }).preferences.dnd).toBe(true);
  });

  it('pause applies, and the done card closes by itself after the undo window', async () => {
    render(<Host />);
    act(() => { startFlow('settings', 'topic'); });
    await press(W.topic.pause);
    await press(W.pause.doPause);
    await press(W.confirm.apply);
    await waitFor(() => expect(calls).toContain('pause_all_agents'));
    await waitFor(() => expect(live()?.getAttribute('data-step')).toBe('done'));
    await waitFor(() => expect(live()).toBeNull(), { timeout: 3000 });
    expect(folded().some((t) => t.startsWith('Changed:'))).toBe(true);
  });

  it('Cancel changes nothing', async () => {
    render(<Host />);
    act(() => { startFlow('settings', 'topic'); });
    await press(W.topic.look);
    fireEvent.click(document.querySelector<HTMLButtonElement>('.fc-cancel')!);
    expect(folded().at(-1)).toBe(FLOW_WORDS.cancelled);
    expect(currentTheme()).toBe('dark');
    expect(calls.some((c) => /write|pause|resume/.test(c))).toBe(false);
  });

  it('a locked wallet says so in one line and ends', async () => {
    locked.on = true;
    render(<Host />);
    act(() => { startFlow('settings', 'topic'); });
    await waitFor(() => expect(folded()).toEqual([W.locked]));
    expect(live()).toBeNull();
  });
});

// The Charter in the first-run mock world: five lines with their state, the privileged lines hand off
// to the approval window with the Set up page's targets, a line waits and says "not finished" when
// the window gives the focus back unfinished, and a line moves on by itself when its state turns done.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../lib/contract';
import { CHARTER_IN_APPROVAL, CHARTER_TITLE, CONNECTIONS_ENGINE, KEEP_PRACTICE_AGENT, TOUR, tourCount, SETUP_FINISH, SETUP_NEXT, SETUP_NOT_DONE, SETUP_STEP_COPY, SETUP_STEP_LABEL, SETUP_WAITING } from '../../../lib/words';
import { mockBackend, resetMockState } from '../../../mock/backend';
import { WorldProvider } from '../world';
import { ToastProvider } from '../ui';
import { Charter, HANDOFF } from './Charter';
import type { SetupStep } from '../logic';
import { resetTourMemory } from '../../../lib/tour';

const hoisted = vi.hoisted(() => ({ current: null as Backend | null, opened: [] as unknown[] }));
vi.mock('../../../lib/runtime', () => ({ backend: () => hoisted.current }));

// The mock, with the approval window stubbed (a browser tab cannot open here).
function stubbed(): Backend {
  const real = mockBackend('main');
  return {
    kind: real.kind,
    label: real.label,
    listen: (e, cb) => real.listen(e, cb),
    invoke: async (cmd, args, opts) => {
      if (cmd === 'approval_open') { hoisted.opened.push(args); return null as never; }
      return real.invoke(cmd, args, opts);
    },
  };
}

function view(step: SetupStep | null, onStep = vi.fn(), onDone = vi.fn()) {
  render(<ToastProvider><WorldProvider><Charter step={step} onStep={onStep} onDone={onDone} /></WorldProvider></ToastProvider>);
  return { onStep, onDone };
}

describe('the Charter', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '', '/index.html?first_run=1'); resetMockState(); hoisted.opened = []; hoisted.current = stubbed(); });
  afterEach(() => { cleanup(); hoisted.current = null; });

  it('lists the five lines, marks the ones signed in the approval window, and opens on the first one not signed', async () => {
    view(null);
    expect(await screen.findByRole('heading', { name: SETUP_STEP_COPY.keys.lead })).toBeTruthy();
    const lines = screen.getByRole('list', { name: CHARTER_TITLE }).querySelectorAll('li');
    expect(lines).toHaveLength(5);
    for (const [i, k] of (['keys', 'rules', 'practice', 'agent', 'unlock'] as const).entries()) {
      expect(lines[i]?.textContent).toContain(SETUP_STEP_LABEL[k]);
      expect(lines[i]?.textContent?.includes(CHARTER_IN_APPROVAL)).toBe(!!HANDOFF[k]);
    }
    expect(screen.getAllByRole('button', { name: new RegExp(SETUP_STEP_COPY.keys.act) })).toHaveLength(1);
  });

  it('hands a privileged line to the approval window with its target, waits, and says when it came back unfinished', async () => {
    view('rules');
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(SETUP_STEP_COPY.rules.act) }));
    expect(await screen.findByText(SETUP_WAITING.title)).toBeTruthy();
    expect(hoisted.opened).toEqual([{ deal_id: null, target: 'mandate' }]);
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(await screen.findByText(SETUP_NOT_DONE.title, undefined, { timeout: 2000 })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(SETUP_WAITING.reopen) }));
    await waitFor(() => expect(hoisted.opened).toHaveLength(2));
  });

  it('the keys and unlock lines open the approval window on their own pages', async () => {
    view('keys');
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(SETUP_STEP_COPY.keys.act) }));
    await waitFor(() => expect(hoisted.opened).toEqual([{ deal_id: null, target: 'credentials' }]));
  });

  it('moves on by itself when the agent line turns done', async () => {
    const { onStep } = view('agent');
    const keep = await screen.findByRole('button', { name: KEEP_PRACTICE_AGENT.act });
    await waitFor(() => expect((keep as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(keep);
    await waitFor(() => expect(onStep).toHaveBeenCalledWith('unlock'));
  });

  it('a line signed on arrival offers Next or Done instead of jumping ahead', async () => {
    const { onStep } = view('unlock');
    // (the done words also show in the "line V reads" preview, so wait for the line's own Done)
    expect(await screen.findByRole('button', { name: SETUP_FINISH })).toBeTruthy();
    expect(document.querySelector('.ch-done')?.textContent).toContain(SETUP_STEP_COPY.unlock.done);
    expect(onStep).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: SETUP_NEXT })).toBeNull();
  });
});

// The agent line's words are the agent-app picker's (CONNECTIONS_ENGINE), so the two places that
// pick an agent app say the same thing and the area words guard sees them; none is spelled inline.
describe('the agent line speaks the picker’s words', () => {
  it('spells none of them inline', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/windows/main/setup/Charter.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const inline = [CONNECTIONS_ENGINE.looking, CONNECTIONS_ENGINE.notChecked, CONNECTIONS_ENGINE.checkAgain, CONNECTIONS_ENGINE.look, CONNECTIONS_ENGINE.practiceShort, 'Agent app set to', `'${CONNECTIONS_ENGINE.chipReady}`, `'${CONNECTIONS_ENGINE.chipOff}`, '`ready', '`not connected']
      .filter((w) => src.includes(w));
    expect(inline).toEqual([]);
  });
});

describe('the tour on a wallet that is already set up', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '', '/index.html'); resetMockState(); resetTourMemory(); hoisted.opened = []; hoisted.current = stubbed(); });
  afterEach(() => { cleanup(); hoisted.current = null; });

  it('offers "Take the tour" on the Set up page and reopening shows stop 1 of at least 2', async () => {
    view('unlock');
    // Nothing starts by itself here: the tour is closed until the owner asks.
    expect(await screen.findByRole('heading', { name: SETUP_STEP_COPY.unlock.lead })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: TOUR.take }));
    const mark = await screen.findByRole('dialog');
    const kick = mark.querySelector('.tour-kick')?.textContent ?? '';
    const m = /(\d+) of (\d+)$/.exec(kick);
    expect(m?.[1]).toBe('1');
    expect(Number(m?.[2])).toBeGreaterThanOrEqual(2);
    expect(kick).toBe(`${TOUR.label} · ${tourCount(1, Number(m?.[2]))}`);
  });
});

// The first-run steps as one list: done steps are ticked and have no action, the rest are one
// quiet click each, and the list itself never carries a gold button (the view's one gold action
// lives outside it).
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gettingStarted, type StartFacts } from '../lib/firstRun';
import type { StartStepKey } from '../lib/words';
import { StartProgress, StartSteps } from './start';

const facts: StartFacts = { firstRun: false, paypal: true, rulesInForce: 0, houseConnected: false, otherConnections: 0, engine: 'scripted' };
const gs = gettingStarted(facts);
const engineItem = (c: HTMLElement) => c.querySelectorAll('li.ss')[3]!;

describe('first-run steps list', () => {
  afterEach(cleanup);

  it('ticks what is done, marks the next step and offers one quiet click for the rest', () => {
    const run = vi.fn();
    const r = render(<StartSteps gs={gs} action={(k: StartStepKey) => ({ label: `go ${k}`, title: k, run: () => run(k) })} />);
    const items = r.container.querySelectorAll('li.ss');
    expect([...items].map((li) => li.className)).toEqual(['ss s-done', 'ss s-next', 'ss s-todo', 'ss s-todo']);
    expect(items[0]!.textContent).toContain('PayPal sandbox keys saved');
    expect(items[0]!.querySelector('button')).toBeNull();
    expect(r.container.querySelectorAll('button')).toHaveLength(3);
    expect(r.container.querySelector('.gold')).toBeNull();
    fireEvent.click(r.getByText('go practice'));
    expect(run).toHaveBeenCalledWith('practice');
    fireEvent.click(r.getByText('go engine'));
    expect(run).toHaveBeenCalledWith('engine');
    expect(r.getByLabelText('Getting started: 1 of 4 done')).toBeTruthy();
  });

  it('a step that happens in another window says where instead of offering a button', () => {
    const r = render(<StartSteps gs={gs} action={() => null} elsewhere={{ practice: 'In The Table', engine: 'In The Table: Settings › Agent app' }} />);
    expect(r.container.querySelectorAll('button')).toHaveLength(0);
    expect(r.getByText('In The Table')).toBeTruthy();
    expect(r.getByText('In The Table: Settings › Agent app')).toBeTruthy();
  });

  it('the agent app step: to do on the practice agent, ticked once an app is chosen, dashed where it cannot be told', () => {
    const go = () => ({ label: 'go', title: 'go', run: () => undefined });
    // The Table on the practice agent: to do, one click away.
    let r = render(<StartSteps gs={gs} action={go} />);
    expect(engineItem(r.container).className).toBe('ss s-todo');
    expect(engineItem(r.container).textContent).toContain('Choose your agent app');
    expect(engineItem(r.container).querySelector('button')).not.toBeNull();
    cleanup();
    // The Table, an app chosen but reported not installed: still to do.
    r = render(<StartSteps gs={gettingStarted({ ...facts, engine: 'claude-code', engineAvailable: false })} action={go} />);
    expect(engineItem(r.container).className).toBe('ss s-todo');
    cleanup();
    // The approval window with codex-cli chosen: ticked, no action.
    r = render(<StartSteps gs={gettingStarted({ ...facts, engine: 'codex-cli' })} action={() => null} elsewhere={{ engine: 'In The Table' }} />);
    expect(engineItem(r.container).className).toBe('ss s-done');
    expect(engineItem(r.container).textContent).toContain('Agent app chosen');
    expect(engineItem(r.container).textContent).not.toContain('In The Table');
    cleanup();
    // Settings not read yet: never ticked.
    r = render(<StartSteps gs={gettingStarted({ ...facts, engine: null })} action={go} />);
    expect(engineItem(r.container).className).toBe('ss s-unknown');
    expect(engineItem(r.container).textContent).toContain('not checked from here');
  });

  it('progress reads as words for screen readers', () => {
    const r = render(<StartProgress gs={gs} />);
    expect(r.getByRole('img').getAttribute('aria-label')).toBe('1 of 4 steps done');
    expect(r.container.querySelectorAll('i.on')).toHaveLength(1);
    expect(r.container.querySelectorAll('i.next')).toHaveLength(1);
  });
});

// The three first-run steps as one list: done steps are ticked and have no action, the rest are one
// quiet click each, and the list itself never carries a gold button (the view's one gold action
// lives outside it).
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gettingStarted } from '../lib/firstRun';
import type { StartStepKey } from '../lib/words';
import { StartProgress, StartSteps } from './start';

const gs = gettingStarted({ firstRun: false, paypal: true, rulesInForce: 0, houseConnected: false, otherConnections: 0 });

describe('first-run steps list', () => {
  afterEach(cleanup);

  it('ticks what is done, marks the next step and offers one quiet click for the rest', () => {
    const run = vi.fn();
    const r = render(<StartSteps gs={gs} action={(k: StartStepKey) => ({ label: `go ${k}`, title: k, run: () => run(k) })} />);
    const items = r.container.querySelectorAll('li.ss');
    expect([...items].map((li) => li.className)).toEqual(['ss s-done', 'ss s-next', 'ss s-todo']);
    expect(items[0]!.textContent).toContain('PayPal sandbox connected');
    expect(items[0]!.querySelector('button')).toBeNull();
    expect(r.container.querySelectorAll('button')).toHaveLength(2);
    expect(r.container.querySelector('.gold')).toBeNull();
    fireEvent.click(r.getByText('go practice'));
    expect(run).toHaveBeenCalledWith('practice');
    expect(r.getByLabelText('Getting started: 1 of 3 done')).toBeTruthy();
  });

  it('a step that happens in another window says where instead of offering a button', () => {
    const r = render(<StartSteps gs={gs} action={() => null} elsewhere={{ practice: 'In The Table' }} />);
    expect(r.container.querySelectorAll('button')).toHaveLength(0);
    expect(r.getByText('In The Table')).toBeTruthy();
  });

  it('progress reads as words for screen readers', () => {
    const r = render(<StartProgress gs={gs} />);
    expect(r.getByRole('img').getAttribute('aria-label')).toBe('1 of 3 steps done');
    expect(r.container.querySelectorAll('i.on')).toHaveLength(1);
    expect(r.container.querySelectorAll('i.next')).toHaveLength(1);
  });
});

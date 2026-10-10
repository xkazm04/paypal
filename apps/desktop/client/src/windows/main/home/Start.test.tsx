// Home on first run keeps the practice deal the path just started in view, one click away.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gettingStarted } from '../../../lib/firstRun';
import { START_UNDERWAY } from '../../../lib/words';
import { StartSide, type StartActions } from './Start';

const gs = gettingStarted({ firstRun: true, paypal: true, rulesInForce: 1, houseConnected: true, otherConnections: 0, engine: 'scripted' });
const act: StartActions = { go: () => {}, busy: null, error: null };

describe('the getting-started column while a practice deal is under way', () => {
  afterEach(cleanup);

  it('shows the deal’s row and opens it with one click, beside the steps', () => {
    const onDeal = vi.fn();
    render(<StartSide gs={gs} act={act} underway={[{ id: 'd1', label: 'D-0201', title: 'Refurbished 24-inch IPS monitor' }]} onDeal={onDeal} />);
    expect(gs.show).toBe(true);
    const row = screen.getByRole('button', { name: /D-0201/ });
    expect(row.textContent).toContain('Refurbished 24-inch IPS monitor');
    expect(row.textContent).toContain(START_UNDERWAY.act);
    fireEvent.click(row);
    expect(onDeal).toHaveBeenCalledWith('d1');
    expect(screen.getByText('Getting started')).toBeTruthy();
  });

  it('shows no such row when nothing is under way', () => {
    render(<StartSide gs={gs} act={act} underway={[]} onDeal={() => {}} />);
    expect(screen.queryByText(START_UNDERWAY.title)).toBeNull();
  });
});

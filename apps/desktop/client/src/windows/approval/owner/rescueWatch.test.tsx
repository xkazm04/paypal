// Stopping a watched subscription: only the row the owner clicked says "Stopping…".
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RescueWatchView } from '@bindings/RescueWatchView';

const call = vi.fn();
const session = { tokenReady: true, pending: null as string | null, unlocking: false, call };
vi.mock('../session', () => ({ useSession: () => session }));

const { RescueWatch, STOP_KEEPS_FIX } = await import('./RescueWatch');

const row = (id: string): RescueWatchView => ({ subscription_id: id, recipient: 's•••@example.com', plan: 'plan-a' as RescueWatchView['plan'], state: 'waiting', added_at: 1, next_read_at: 4_000_000_000 });
const rows = [row('I-AAA'), row('I-BBB'), row('I-CCC')];

afterEach(() => { cleanup(); call.mockReset(); session.pending = null; });

describe('rescue watch, one stop in flight', () => {
  it('labels only the clicked row Stopping…', async () => {
    call.mockImplementation(() => { session.pending = 'rescue_watch_stop'; return new Promise(() => {}); });
    const { rerender } = render(<RescueWatch entries={[]} watching={rows} locked={false} onClose={() => {}} onChanged={() => {}} />);
    fireEvent.click(screen.getAllByText('Stop watching')[1]!);
    rerender(<RescueWatch entries={[]} watching={rows} locked={false} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getAllByText('Stopping…')).toHaveLength(1);
    expect(screen.getAllByText('Stop watching')).toHaveLength(2);
  });

  it('says why a watch is not being checked, in plain words', () => {
    const held: RescueWatchView = { ...row('I-HHH'), held: 'not_connected' };
    render(<RescueWatch entries={[]} watching={[held]} locked={false} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByText(/Not checking: PayPal isn’t connected\./)).toBeTruthy();
    expect(screen.queryByText(/checked again/)).toBeNull();
  });

  it('says stopping keeps a fix the watch already suggested open (stop_watching leaves it untouched)', () => {
    const opened: RescueWatchView = { ...row('I-FFF'), state: 'fix_opened' };
    render(<RescueWatch entries={[]} watching={[opened, row('I-GGG')]} locked={false} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByText(STOP_KEEPS_FIX)).toBeTruthy();
    for (const b of screen.getAllByText('Stop watching')) expect(b.closest('button')?.getAttribute('title')).toBe(STOP_KEEPS_FIX);
  });

  it('shows no such note when no watched subscription has a fix', () => {
    render(<RescueWatch entries={[]} watching={rows} locked={false} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.queryByText(STOP_KEEPS_FIX)).toBeNull();
  });
});

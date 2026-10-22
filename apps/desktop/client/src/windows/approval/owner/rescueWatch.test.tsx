// Stopping a watched subscription: only the row the owner clicked says "Stopping…".
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RescueWatchView } from '@bindings/RescueWatchView';

const call = vi.fn();
const session = { tokenReady: true, pending: null as string | null, unlocking: false, call };
vi.mock('../session', () => ({ useSession: () => session }));

const { RescueWatch } = await import('./RescueWatch');

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
});

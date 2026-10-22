// The rule-set strip in the editor: roles that say "tab" keep the tab keyboard pattern.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Clause } from '@bindings/Clause';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import { nowUnix } from '../../../lib/format';

const session = { tokenReady: true, pending: null as string | null, unlocking: false, settingsLocked: false, lockedByError: false, call: vi.fn() };
vi.mock('../session', () => ({ useSession: () => session }));
vi.mock('../../../lib/hooks', async (orig) => ({ ...(await orig<typeof import('../../../lib/hooks')>()), useQuery: () => ({ data: undefined, error: null, loading: false, refetch: async () => {} }) }));
vi.mock('../../../lib/runtime', () => ({ backend: () => ({ kind: 'tauri', invoke: vi.fn(), listen: vi.fn() }) }));
vi.mock('./data', () => ({ useSimulation: () => ({ sim: null, error: null, loading: false }) }));

const { MandateEditor } = await import('../MandateEditor');

const now = nowUnix();
const usd = (minor: number) => ({ minor, currency: 'USD' as const });
const clauses: Clause[] = [
  { type: 'roles', roles: ['buy'] },
  { type: 'per_deal', kind: 'purchase', max_amount: usd(10000), categories: ['office'] },
];
const entry = (id: string, agent: string) => ({ agent, owner_sig: [], payload: { id, version: 1, agent_key: Array(32).fill(0), clauses, not_before: now - 60, expires: now + 86400 } }) as unknown as MandateListEntry;
const A = entry('01JDRULESA00000000000000AA', 'negotiator');
const B = entry('01JDRULESB00000000000000BB', 'buyer');

afterEach(cleanup);

function setup(selected: string | null) {
  const onSelect = vi.fn();
  render(<MandateEditor mode={undefined} entries={[A, B]} selected={selected} onSelect={onSelect} onClose={() => {}} onSigned={() => {}} onRevoked={() => {}} />);
  return { onSelect, tabs: screen.getAllByRole('tab') };
}

describe('rule-set tabs', () => {
  it('ArrowRight selects the next rule set, ArrowLeft the previous, End the new one', () => {
    const { onSelect, tabs } = setup(A.payload.id);
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenLastCalledWith(B.payload.id);
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenLastCalledWith(null);
    fireEvent.keyDown(tabs[0]!, { key: 'End' });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
  it('only the selected tab is in the Tab order, and every tab names the region it controls', () => {
    const { tabs } = setup(A.payload.id);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    for (const t of tabs) expect(document.getElementById(t.getAttribute('aria-controls') ?? '')).not.toBeNull();
  });
});

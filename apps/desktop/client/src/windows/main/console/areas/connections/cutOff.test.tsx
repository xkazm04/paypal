// Cutting a wallet off cannot happen in the main window: Connections only hands off to the approval
// window (approval_open on owner configuration), where the cut is held. Nothing here asks the wallet
// to cut anyone off.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import { AUTHORITY } from '@bindings/authority';
import type { Backend } from '../../../../../lib/contract';
import { CONNECTIONS_PEOPLE } from '../../../../../lib/words';
import { mockBackend, resetMockState } from '../../../../../mock/backend';
import { WorldProvider } from '../../../world';
import { CutOffHandoff } from './CutOff';

const hoisted = vi.hoisted(() => ({ current: null as Backend | null }));
vi.mock('../../../../../lib/runtime', () => ({ backend: () => hoisted.current }));

afterEach(() => { cleanup(); hoisted.current = null; });

const cp = (key_id: string, pairing: CounterpartyDisplay['pairing']): CounterpartyDisplay => ({ key_id, display_name: key_id, house: false, first_seen: 1, deals_closed: 0, pairing, declared_payee: null } as CounterpartyDisplay);

describe('Cut off a wallet, from the main window', () => {
  it('the cut itself is an owner command of the approval window only', () => {
    expect(AUTHORITY.counterparty_revoke.labels).toEqual(['approval']);
    expect(AUTHORITY.counterparty_revoke.token).toBe(true);
    expect(AUTHORITY.counterparty_revoke.unlock).toBe(true);
  });

  it('opens the approval window on owner configuration and calls nothing else', async () => {
    resetMockState();
    const real = mockBackend('main');
    const calls: { cmd: string; args: unknown }[] = [];
    hoisted.current = { ...real, invoke: async (cmd: string, args: unknown) => { calls.push({ cmd, args }); return cmd === 'approval_open' ? null : real.invoke(cmd as never, args as never); } } as unknown as Backend;
    render(<WorldProvider><CutOffHandoff list={[cp('k1', 'words_confirmed')]} /></WorldProvider>);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(CONNECTIONS_PEOPLE.cutOff) }));
    await waitFor(() => expect(calls.some((c) => c.cmd === 'approval_open')).toBe(true));
    const acts = calls.filter((c) => AUTHORITY[c.cmd as keyof typeof AUTHORITY]?.tier !== 'read');
    expect(acts).toEqual([{ cmd: 'approval_open', args: { deal_id: null, target: null } }]);
  });

  it('is not offered when nobody is pinned', () => {
    hoisted.current = mockBackend('main');
    const { container } = render(<WorldProvider><CutOffHandoff list={[cp('k1', 'unpaired')]} /></WorldProvider>);
    expect(container.querySelector('button')).toBeNull();
  });
});

// The done sheet's "Follow it in The Table": it closes only when The Table opened; a failure stays on screen.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Deal } from '@bindings/Deal';
import type { HouseTableDraft } from '@bindings/HouseTableDraft';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import { WalletError } from '../../../lib/contract';
import { nowUnix } from '../../../lib/format';
import { APPROVAL_TABLE as W } from '../../../lib/words';

const call = vi.fn();
const session = { tokenReady: true, pending: null as string | null, unlocking: false, call };
vi.mock('../session', () => ({ useSession: () => session }));

const { TableSheet } = await import('./TableSheet');

const usd = (minor: number) => ({ minor, currency: 'USD' as const });
const now = nowUnix();
const terms = { item_ref: 'monitor-24-ips', qty: 1, unit_price: usd(22900), currency: 'USD' as const, delivery: { type: 'digital_now' as const } };
const house = { negotiation_deadline: now + 1800, deal_id: '01JDHOUSETABLE00000000000A', terms, category: 'office' } as unknown as HouseTableDraft;
const buy = {
  agent: 'negotiator', owner_sig: [],
  payload: {
    id: '01JDBUYRULES0000000000000A', version: 2, agent_key: Array(32).fill(0), not_before: now - 60, expires: now + 86400,
    clauses: [
      { type: 'roles', roles: ['buy'] },
      { type: 'per_deal', kind: 'haggle', max_amount: usd(25000), categories: ['office'] },
      { type: 'band', item_refs: ['monitor-24-ips'], floor: null, ceiling: usd(25000), max_rounds: 6, deadline: now + 3600 },
    ],
  },
} as unknown as MandateListEntry;
const deal = { id: 'd1', side: 'buyer', terms } as unknown as Deal;

afterEach(() => { cleanup(); call.mockReset(); });

async function followWith(main: unknown) {
  call.mockImplementation(async (cmd: string) => (cmd === 'deal_join' ? { ok: true, value: deal } : main));
  const onClose = vi.fn();
  render(<TableSheet seed={{ counterparty: 'kp_house', house }} entries={[buy]} counterparties={[]} locked={false} onClose={onClose} />);
  fireEvent.click(screen.getByText(W.join));
  fireEvent.click(await screen.findByText(`${W.follow} ↗`));
  return onClose;
}

describe('following a joined table', () => {
  it('stays open and says The Table did not open when main_open fails', async () => {
    const onClose = await followWith({ ok: false, error: new WalletError({ code: 'UNAVAILABLE', message: 'main window is not available' }) });
    await screen.findByText(new RegExp(W.failFollow));
    expect(onClose).not.toHaveBeenCalled();
  });
  it('closes when main_open answers', async () => {
    const onClose = await followWith({ ok: true, value: null });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

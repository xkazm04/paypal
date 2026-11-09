// The deal page when the deals do not answer: a failure that says what happened (never "this deal
// is not there any more"), Try again that asks for the deals again, and the way back; while they are
// on their way, a placeholder shaped like the page.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WalletError } from '../../../../../lib/contract';
import type { Query } from '../../../../../lib/hooks';
import type { Deal } from '@bindings/Deal';
import { DEAL_FAILED, DEAL_GONE, DEAL_UNREAD, LOADING_WHAT, UI_WORDS } from '../../../../../lib/words';
import type { LayerProps } from '../../layers';
import { DealLayer } from './DealLayer';

const world = vi.hoisted(() => ({ deals: null as unknown }));
vi.mock('../../../world', () => ({
  useDeals: () => world.deals,
  useDealLabels: () => new Map<string, string>(),
  useStaleBanner: () => null,
  useWorldSelector: () => true,
}));

afterEach(cleanup);

const nav = { home: vi.fn() } as unknown as LayerProps['nav'];
const props: LayerProps = { route: { level: 'deal', deal: '01J0000000000000000000DEAL' }, nav, state: { rewindAt: null, pairMode: undefined, firstRun: false, presence: { state: 'quiet', word: '', line: '' } } };

describe('Deal page failure', () => {
  it('says what happened, and Try again asks for the deals again', async () => {
    const refetch = vi.fn(async () => {});
    world.deals = { data: undefined, error: new WalletError({ code: 'UNAVAILABLE', message: 'timed out' }), loading: false, refetch } satisfies Query<Deal[]>;
    render(<DealLayer {...props} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(DEAL_UNREAD);
    expect(screen.getByText(DEAL_FAILED.line)).toBeTruthy();
    expect(screen.queryByText(DEAL_GONE.text)).toBeNull();
    expect(screen.getByRole('button', { name: DEAL_GONE.back })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: UI_WORDS.tryAgain })); });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('while the deals are on their way: a placeholder, no failure, no "not there"', () => {
    world.deals = { data: undefined, error: null, loading: true, refetch: async () => {} } satisfies Query<Deal[]>;
    render(<DealLayer {...props} />);
    expect(screen.getByRole('status').textContent).toBe(UI_WORDS.reading(LOADING_WHAT.deal));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(DEAL_GONE.text)).toBeNull();
  });
});

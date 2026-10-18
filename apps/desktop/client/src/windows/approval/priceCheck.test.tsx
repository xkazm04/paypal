// "Check the price now": a success shows the typical price, an unbound product shows the refusal
// words instead of a button that fails, no selected deal shows nothing. A check never offers to move money.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Deal } from '@bindings/Deal';
import type { MandatePayload } from '@bindings/MandatePayload';
import { WalletError } from '../../lib/contract';
import { PRICE_CHECK } from '../../lib/words';

const call = vi.fn();
const session = { tokenReady: true, pending: null as string | null, call };
vi.mock('./session', () => ({ useSession: () => session }));

const { PriceCheck, marketProductFor } = await import('./PriceCheck');

const usd = (minor: number) => ({ minor, currency: 'USD' });
const deal = (item_ref: string) => ({ id: 'd1', terms: { item_ref } }) as unknown as Deal;
const watch = { clauses: [{ type: 'market_watch', max_refreshes_day: 4, items: [{ item_ref: 'listing 7', product_id: 'lg-27uk850-w' }] }] } as unknown as MandatePayload;
const market = { p25: usd(30000), median: usd(32900), p75: usd(36000), retrieved_at: 1, response_hash: '', cached: false };

afterEach(() => { cleanup(); call.mockReset(); session.tokenReady = true; session.pending = null; });

describe('Check the price now', () => {
  it('binds the product as Rust does', () => {
    expect(marketProductFor(watch, 'listing 7')).toBe('lg-27uk850-w');
    expect(marketProductFor(null, 'lg-27uk850-w')).toBe('lg-27uk850-w');
    expect(marketProductFor(null, 'a used lamp')).toBeNull();
  });

  it('shows the stored typical price after a successful check, and offers no payment', async () => {
    call.mockResolvedValue({ ok: true, value: market });
    const { container } = render(<PriceCheck deal={deal('listing 7')} payload={watch} />);
    fireEvent.click(screen.getByRole('button', { name: PRICE_CHECK.label }));
    await waitFor(() => expect(container.textContent).toContain('329.00'));
    expect(call).toHaveBeenCalledWith('market_refresh', { deal_id: 'd1', product_id: 'lg-27uk850-w' }, true);
    expect(container.textContent).toContain('usually');
    expect(container.textContent).not.toMatch(/hold to|pay now|approve/i);
  });

  it('shows the refusal in words when the wallet refuses', async () => {
    call.mockResolvedValue({ ok: false, error: new WalletError({ code: 'UNAVAILABLE', message: 'no market reference for this item' }) });
    const { container } = render(<PriceCheck deal={deal('listing 7')} payload={watch} />);
    fireEvent.click(screen.getByRole('button', { name: PRICE_CHECK.label }));
    await waitFor(() => expect(container.textContent).toContain('no market reference for this item'));
    expect(container.textContent).toContain(PRICE_CHECK.failed);
  });

  it('shows the refusal words, and no button, when no product is bound', () => {
    const { container } = render(<PriceCheck deal={deal('a used lamp')} payload={null} />);
    expect(container.textContent).toContain(PRICE_CHECK.unbound);
    expect(screen.queryByRole('button')).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it('renders nothing when no deal is selected', () => {
    const { container } = render(<PriceCheck deal={null} payload={watch} />);
    expect(container.textContent).toBe('');
  });

  it('is disabled without the approval capability', () => {
    session.tokenReady = false;
    render(<PriceCheck deal={deal('listing 7')} payload={watch} />);
    expect((screen.getByRole('button', { name: PRICE_CHECK.label }) as HTMLButtonElement).disabled).toBe(true);
  });
});

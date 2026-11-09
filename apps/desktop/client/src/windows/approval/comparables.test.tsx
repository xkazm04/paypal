// Comparables at the review: each state, names and prices as text, one inform-only line, and nothing
// that could block or change the deal.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Deal } from '@bindings/Deal';
import type { MandatePayload } from '@bindings/MandatePayload';
import type { MarketComparablesAnswer } from '@bindings/MarketComparablesAnswer';
import { WalletError } from '../../lib/contract';
import { COMPARABLES, FINDER_WIRE_NO_KEY } from '../../lib/words';

const call = vi.fn();
const session = { tokenReady: true, pending: null as string | null, call, settings: { channel3_configured: true } as { channel3_configured: boolean } | undefined };
vi.mock('./session', () => ({ useSession: () => session, useOptionalSession: () => session }));

const { Comparables } = await import('./Comparables');

afterEach(() => { cleanup(); call.mockReset(); session.tokenReady = true; session.settings = { channel3_configured: true }; });

const deal = (item_ref: string) => ({ id: 'd1', terms: { item_ref } }) as unknown as Deal;
const watch = { clauses: [{ type: 'market_watch', max_refreshes_day: 4, items: [{ item_ref: 'listing 7', product_id: 'lg-27uk850-w' }] }] } as unknown as MandatePayload;
const answer = (over: Partial<MarketComparablesAnswer> = {}): MarketComparablesAnswer => ({
  comparables: [
    { id: 'dell-p2422h', title: 'Dell P2422H', brand: 'Dell', price_minor: 17900, currency: 'USD', shop: 'bayside-shop.example' },
    { id: 'x' },
  ],
  cheaper: [{ shop: 'northwind-tech.example', price_minor: 28900, currency: 'USD', saving_minor: 4000 }],
  ...over,
});
const state = (c: HTMLElement) => c.querySelector('[data-comparables]')?.getAttribute('data-comparables');

describe('Comparables at the review', () => {
  it('shows nothing when no market product is bound to the item', () => {
    const { container } = render(<Comparables deal={deal('a used lamp')} payload={null} />);
    expect(container.textContent).toBe('');
    expect(call).not.toHaveBeenCalled();
  });

  it('loads, then lists names, shops and prices as plain text with the one cheaper line', async () => {
    let done: (v: unknown) => void = () => {};
    call.mockReturnValue(new Promise((r) => { done = r; }));
    const { container } = render(<Comparables deal={deal('listing 7')} payload={watch} />);
    expect(state(container)).toBe('loading');
    expect(container.textContent).toContain(COMPARABLES.loading);
    done({ ok: true, value: answer() });
    await waitFor(() => expect(state(container)).toBe('ready'));
    expect(call).toHaveBeenCalledWith('market_comparables', { deal_id: 'd1' }, true, { background: true });
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(container.textContent).toContain('Dell P2422H');
    expect(container.textContent).toContain('Dell · $179.00 · bayside-shop.example');
    // A hit with no title, price or shop is drawn with dashes.
    expect(container.textContent).toContain('— · —');
    const line = container.querySelector('[data-cheaper]');
    expect(line?.textContent).toContain('Cheaper at northwind-tech.example: $289.00, $40.00 less.');
    // Plain text only, and informing only: no image, link or button anywhere in the panel.
    expect(container.querySelector('img, a, button, input')).toBeNull();
    expect(container.textContent).toContain(COMPARABLES.note);
  });

  it('draws no cheaper line when no shop sells the identical product for less', async () => {
    call.mockResolvedValue({ ok: true, value: answer({ cheaper: [] }) });
    const { container } = render(<Comparables deal={deal('listing 7')} payload={watch} />);
    await waitFor(() => expect(state(container)).toBe('ready'));
    expect(container.querySelector('[data-cheaper]')).toBeNull();
  });

  it('says none, offline and no key in one calm line each', async () => {
    call.mockResolvedValue({ ok: true, value: answer({ comparables: [], cheaper: [] }) });
    const none = render(<Comparables deal={deal('listing 7')} payload={watch} />);
    await waitFor(() => expect(state(none.container)).toBe('none'));
    expect(none.container.textContent).toContain(COMPARABLES.none);
    cleanup();
    call.mockResolvedValue({ ok: false, error: new WalletError({ code: 'UNAVAILABLE', message: 'The market is unavailable right now.' }) });
    const off = render(<Comparables deal={deal('listing 7')} payload={watch} />);
    await waitFor(() => expect(state(off.container)).toBe('offline'));
    expect(off.container.textContent).toContain(COMPARABLES.offline);
    cleanup();
    call.mockResolvedValue({ ok: false, error: new WalletError({ code: 'UNAVAILABLE', message: FINDER_WIRE_NO_KEY }) });
    const key = render(<Comparables deal={deal('listing 7')} payload={watch} />);
    await waitFor(() => expect(state(key.container)).toBe('no-key'));
    cleanup();
    // The settings say no key: shown at once, and the market is not asked.
    call.mockReset();
    session.settings = { channel3_configured: false };
    const set = render(<Comparables deal={deal('listing 7')} payload={watch} />);
    expect(state(set.container)).toBe('no-key');
    expect(set.container.textContent).toContain(COMPARABLES.noKey);
    expect(call).not.toHaveBeenCalled();
  });

  it('draws a shop’s words as text, never as markup', async () => {
    call.mockResolvedValue({
      ok: true,
      value: answer({
        comparables: [{ id: 'p', title: '<img src=x onerror=alert(1)> **x**', brand: '<b>B</b>', shop: 'evil.example' }],
        cheaper: [{ shop: '<a href="https://evil.example">s</a>', price_minor: 1, currency: 'USD', saving_minor: 1 }],
      }),
    });
    const { container } = render(<Comparables deal={deal('listing 7')} payload={watch} />);
    await waitFor(() => expect(state(container)).toBe('ready'));
    expect(container.querySelector('img, a, script')).toBeNull();
    expect(container.querySelectorAll('b')).toHaveLength(1);
    expect(container.textContent).toContain('<b>B</b>');
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

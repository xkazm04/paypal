// The product finder in a rule row: each state, picking fills the product code, shop text is text.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductHit } from '@bindings/ProductHit';
import { WalletError } from '../../../lib/contract';
import { FINDER, FINDER_WIRE_NO_KEY } from '../../../lib/words';

const call = vi.fn();
const session = { tokenReady: true, pending: null as string | null, call, settings: { channel3_configured: true } as { channel3_configured: boolean } | undefined };
vi.mock('../session', () => ({ useSession: () => session, useOptionalSession: () => session }));

const { ProductFinder, hitLine } = await import('./ProductFinder');

afterEach(() => { cleanup(); call.mockReset(); session.settings = { channel3_configured: true }; });

const hit = (over: Partial<ProductHit> = {}): ProductHit => ({ id: 'lg-27uk850-w', title: 'LG 27UK850-W', brand: 'LG', price_minor: 28900, currency: 'USD', shop: 'northwind-tech.example', ...over });
const box = () => screen.getByRole('textbox', { name: FINDER.label });
const search = (text: string) => { fireEvent.change(box(), { target: { value: text } }); fireEvent.click(screen.getByRole('button', { name: FINDER.search })); };
const noop = () => {};

describe('the product finder', () => {
  it('starts idle with one calm line and searches by name', async () => {
    call.mockResolvedValue({ ok: true, value: [hit(), hit({ id: 'dell-p2422h', title: 'Dell P2422H', brand: undefined, price_minor: undefined, currency: undefined, shop: undefined })] });
    const { container } = render(<ProductFinder n={1} onPick={noop} onClose={noop} />);
    expect(container.querySelector('[data-finder="idle"]')?.textContent).toBe(FINDER.idle);
    search(' 27 inch ');
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(call).toHaveBeenCalledWith('market_search', { query: '27 inch' }, true, { background: true });
    // A missing brand, price and shop are the dash, never blank or "undefined".
    expect(container.textContent).toContain('$289.00 · northwind-tech.example');
    expect(container.textContent).toContain('— · — · —');
    expect(container.textContent).not.toMatch(/undefined|null/);
  });

  it('shows loading while a call is out, then no results when it finds nothing', async () => {
    let done: (v: unknown) => void = noop;
    call.mockReturnValue(new Promise((r) => { done = r; }));
    const { container } = render(<ProductFinder n={1} onPick={noop} onClose={noop} />);
    search('monitor');
    await waitFor(() => expect(container.querySelector('[data-finder="loading"]')?.textContent).toBe(FINDER.busy));
    done({ ok: true, value: [] });
    await waitFor(() => expect(container.querySelector('[data-finder="none"]')?.textContent).toBe(FINDER.none));
  });

  it('looks a pasted https link up rather than searching it, and an unreadable page says so', async () => {
    call.mockResolvedValue({ ok: true, value: hit() });
    render(<ProductFinder n={1} onPick={noop} onClose={noop} />);
    search('https://bayside-shop.example/p/lg-27uk850');
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(call).toHaveBeenCalledWith('market_lookup', { url: 'https://bayside-shop.example/p/lg-27uk850' }, true, { background: true });
    cleanup();
    call.mockResolvedValue({ ok: false, error: new WalletError({ code: 'UNAVAILABLE', message: 'The market found nothing for that.' }) });
    const { container } = render(<ProductFinder n={1} onPick={noop} onClose={noop} />);
    search('https://bayside-shop.example/nothing');
    await waitFor(() => expect(container.querySelector('[data-finder="not-a-product"]')?.textContent).toBe(FINDER.notAProduct));
  });

  it('says offline and no key in one calm line each', async () => {
    call.mockResolvedValue({ ok: false, error: new WalletError({ code: 'UNAVAILABLE', message: 'The market is unavailable right now.' }) });
    const { container } = render(<ProductFinder n={1} onPick={noop} onClose={noop} />);
    search('monitor');
    await waitFor(() => expect(container.querySelector('[data-finder="offline"]')?.textContent).toBe(FINDER.offline));
    call.mockResolvedValue({ ok: false, error: new WalletError({ code: 'UNAVAILABLE', message: FINDER_WIRE_NO_KEY }) });
    fireEvent.click(screen.getByRole('button', { name: FINDER.search }));
    await waitFor(() => expect(container.querySelector('[data-finder="no-key"]')?.textContent).toBe(FINDER.noKey));
    cleanup();
    // The settings already say no key: the line shows at once and no call is made.
    call.mockReset();
    session.settings = { channel3_configured: false };
    const again = render(<ProductFinder n={1} onPick={noop} onClose={noop} />);
    expect(again.container.querySelector('[data-finder="no-key"]')?.textContent).toBe(FINDER.noKey);
    expect(box()).toHaveProperty('disabled', true);
    expect(call).not.toHaveBeenCalled();
  });

  it('fills the code with the picked hit id and closes', async () => {
    call.mockResolvedValue({ ok: true, value: [hit()] });
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<ProductFinder n={2} onPick={onPick} onClose={onClose} />);
    search('lg');
    fireEvent.click(await screen.findByRole('button', { name: 'Use LG 27UK850-W for item 2' }));
    expect(onPick).toHaveBeenCalledWith('lg-27uk850-w');
    expect(onClose).toHaveBeenCalled();
  });

  it('draws a shop’s words as text: markup stays literal and nothing becomes a link or an image', async () => {
    call.mockResolvedValue({ ok: true, value: [hit({ title: '<img src=x onerror=alert(1)> **bold** [click](https://evil.example)', shop: 'evil.example' })] });
    const { container } = render(<ProductFinder n={1} onPick={noop} onClose={noop} />);
    search('x');
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(container.querySelector('img, a, script')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('writes a hit line with dashes for what it does not say', () => {
    expect(hitLine({ id: 'a' })).toBe('— · —');
  });
});

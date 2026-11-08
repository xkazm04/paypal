// Two keys, two Save / Replace buttons: each names what it replaces (UAT R-N5), so no two
// buttons on the PayPal page share an accessible name.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockBackend, resetMockState } from '../../../../../mock/backend';
import { WorldProvider } from '../../../world';
import { PaypalView } from './ConnectionsLayer';

vi.mock('../../../../../lib/runtime', () => ({ backend: () => mockBackend('main') }));
afterEach(cleanup);

describe('PayPal page buttons', () => {
  it('give Save / Replace a unique accessible name naming the key', async () => {
    resetMockState();
    const { container } = render(<WorldProvider><PaypalView keyAt={1_700_000_000} marketAt={1_700_000_000} ownerKey={undefined} factsError={undefined as never} watch={[]} /></WorldProvider>);
    await screen.findAllByRole('button', { name: /^(Save|Replace)/ });
    const names = [...container.querySelectorAll('button')].map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim());
    expect(new Set(names).size).toBe(names.length);
  });
  it('names the key in each', async () => {
    resetMockState();
    render(<WorldProvider><PaypalView keyAt={null} marketAt={null} ownerKey={undefined} factsError={undefined as never} watch={[]} /></WorldProvider>);
    const btns = await screen.findAllByRole('button', { name: /^(Save|Replace)/ });
    const names = btns.map((b) => b.textContent ?? '');
    expect(names.some((n) => /PayPal \(sandbox\) key/.test(n))).toBe(true);
    expect(names.some((n) => /Market prices key/.test(n))).toBe(true);
  });
});

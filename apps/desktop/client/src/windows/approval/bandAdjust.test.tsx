// Changing the price range (band_set): a refusal is said in plain words. A rules refusal keeps the
// rules editor's own sentence; every other code reads as a refused decision does, never the
// wallet's own text ("Invalid or stale wallet command", "missing approval capability").
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Deal } from '@bindings/Deal';
import { WalletError } from '../../lib/contract';
import { refusalText } from './model';

const call = vi.fn();
const session = { tokenReady: true, pending: null as string | null, call };
vi.mock('./session', () => ({ useSession: () => session }));

const { BandAdjust } = await import('./BandAdjust');

const usd = (minor: number) => ({ minor, currency: 'USD' as const });
const deal = { id: 'd1', side: 'buyer', terms: { item_ref: 'monitor', currency: 'USD' } } as unknown as Deal;
const band = { floor: null, ceiling: usd(34000), max_rounds: 6, rounds_used: 2 };
const open = { visible: true, enabled: true, reason: null };

afterEach(() => { cleanup(); call.mockReset(); });

async function signWith(error: WalletError) {
  call.mockResolvedValue({ ok: false, error });
  const { container } = render(<BandAdjust deal={deal} band={band} gate={open} onDone={async () => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Change price range' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sign new range' }));
  await waitFor(() => expect(container.textContent).toContain('Price range not changed'));
  return container.textContent ?? '';
}

describe('a refused price range', () => {
  for (const [code, message] of [
    ['INVALID', 'Invalid or stale wallet command'],
    ['PERMISSION', 'missing approval capability'],
    ['LOCKED', 'idle for more than 15 minutes · unlock with Windows Hello'],
    ['NOT_FOUND', 'the deal\'s mandate version is not active'],
  ] as const) {
    it(`${code}: plain words, never the wallet’s text`, async () => {
      const error = new WalletError({ code, message });
      const text = await signWith(error);
      expect(text).toContain(refusalText(error));
      expect(text).not.toContain(message);
    });
  }
  it('REFUSED keeps the rules editor’s sentence', async () => {
    const text = await signWith(new WalletError({ code: 'REFUSED', message: 'mandate clause 2: something' }));
    expect(text).toContain('These rules can’t be signed');
  });
});

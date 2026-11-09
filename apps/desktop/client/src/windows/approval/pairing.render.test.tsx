// The pairing ceremony's answer stays on screen. When pairing_confirm is refused because the waiting
// connection lapsed or is gone (INVALID, NOT_FOUND), the window re-reads approval_pairing, which then
// answers null. The "Not connected" notice must survive that re-read: it is the owner's only answer
// to the click, and the generic "no connection is waiting" text alone does not say this one failed.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { H256 } from '@bindings/H256';
import type { PendingPairing } from '@bindings/PendingPairing';
import { WalletError } from '../../lib/contract';
import { footerNoticeText } from './model';
import type { Session } from './session';

const h = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../lib/runtime', () => ({ backend: () => ({ kind: 'mock', invoke: vi.fn(async () => { throw new Error('no backend in this test'); }), listen: vi.fn(async () => () => {}) }) }));
vi.mock('./session', () => ({
  useSession: (): Partial<Session> => ({
    tokenReady: true, tokenError: null, settingsLocked: false, lockedByError: false, pending: null,
    settings: undefined, unlocking: false, unlockError: null, call: h.call as Session['call'], unlock: async () => false,
  }),
}));

const { PairingConfirm } = await import('./PairingConfirm');

const PENDING: PendingPairing = {
  pairing_id: Array.from({ length: 32 }, (_, i) => i) as H256, words: ['amber', 'birch', 'cobalt', 'dune'],
  display_context: 'Joined with a code', expires: 1_800_000_000, house: false,
};

afterEach(() => { cleanup(); h.call.mockReset(); });

describe('a refused pairing confirmation keeps its answer after the re-read', () => {
  for (const code of ['INVALID', 'NOT_FOUND'] as const) {
    it(`${code}: “Not connected” still shows once approval_pairing answers null`, async () => {
      h.call.mockResolvedValue({ ok: false, error: new WalletError({ code, message: 'pairing is gone' }) });
      const onSettled = vi.fn();
      const view = render(<PairingConfirm pending={PENDING} readError={null} onSettled={onSettled} />);
      fireEvent.change(screen.getByLabelText('Name (only you see it)'), { target: { value: 'Dan' } });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'All four match: connect' })); });
      expect(onSettled).toHaveBeenCalledTimes(1);
      const answer = footerNoticeText('pairing', { code });
      expect(screen.getByText(answer)).toBeTruthy();

      // The re-read onSettled asked for: the lapsed connection is no longer waiting.
      view.rerender(<PairingConfirm pending={null} readError={null} onSettled={onSettled} />);
      expect(screen.getByText(answer)).toBeTruthy();
      expect(screen.getByText(/Not connected/)).toBeTruthy();
    });
  }
});

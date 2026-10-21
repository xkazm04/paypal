// The quit sheet when its forecast cannot be read: the owner is told so and can ask again, so a
// failed read is never a dead end where Quit stays disabled with nothing to press but Keep.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../lib/contract';
import { WalletError } from '../../lib/contract';
import { BOUNDARY_RETRY, QUIT_SHEET } from '../../lib/words';
import { mockBackend, resetMockState } from '../../mock/backend';

const h = vi.hoisted(() => ({ current: null as Backend | null, failSummary: 0 }));
vi.mock('../../lib/runtime', () => ({ backend: () => h.current }));

import { QuitSheet } from './QuitSheet';
import { ToastProvider } from './ui';
import { WorldProvider } from './world';

beforeEach(() => {
  localStorage.clear();
  resetMockState();
  const real = mockBackend('main');
  h.failSummary = 1;
  h.current = {
    ...real,
    invoke: async (cmd, args, opts) => {
      if (cmd === 'quit_summary' && h.failSummary > 0) { h.failSummary -= 1; throw new WalletError({ code: 'UNAVAILABLE', message: 'store busy' }); }
      return real.invoke(cmd, args, opts);
    },
  };
});
afterEach(() => { cleanup(); });

describe('the quit sheet', () => {
  it('offers to read the forecast again when it could not be read, and then lets the owner quit', async () => {
    render(<ToastProvider><WorldProvider><QuitSheet onClose={() => {}} /></WorldProvider></ToastProvider>);
    await screen.findByRole('heading', { name: QUIT_SHEET.title });
    const quit = () => screen.getByRole('button', { name: 'Quit The Table' }) as HTMLButtonElement;
    const again = await screen.findByRole('button', { name: BOUNDARY_RETRY });
    expect(quit().disabled).toBe(true);
    await act(async () => { fireEvent.click(again); });
    await waitFor(() => expect(quit().disabled).toBe(false));
    expect(screen.queryByRole('button', { name: BOUNDARY_RETRY })).toBeNull();
  }, 20_000);
});

// Wallet limits on Layer 1: a read that failed never reads as "no wallet limit".
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WalletError } from '../../../lib/contract';
import { NO_WALLET_LIMIT } from '../../../lib/words';
import { WalletLimits } from './WalletLimits';

afterEach(cleanup);
const noop = () => {};

describe('wallet limits, when they cannot be read', () => {
  it('says they can’t be read, not that there are none', () => {
    const error = new WalletError({ code: 'UNAVAILABLE', message: 'envelope_get failed' });
    const { container } = render(<WalletLimits view={undefined} error={error} loading={false} currency="USD" locked={false} onSigned={noop} />);
    expect(container.textContent).not.toContain(NO_WALLET_LIMIT);
    expect(screen.getAllByText(/can’t be read/).length).toBeGreaterThan(0);
  });
  it('still says there are none when the wallet answered none', () => {
    const { container } = render(<WalletLimits view={{ status: 'none', limits: null, currencies: [], day_start: 0 }} error={null} loading={false} currency="USD" locked={false} onSigned={noop} />);
    expect(container.textContent).toContain(NO_WALLET_LIMIT);
  });
});

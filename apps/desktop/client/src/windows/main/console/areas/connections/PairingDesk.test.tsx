// A copy built with no relay address says so in plain words, not as a passing network fault
// (DECISIONS §42 item 2, "Built in once deployed").
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../../../lib/contract';
import { PAIR } from '../../../../../lib/words/connections';
import { mockBackend, resetMockState } from '../../../../../mock/backend';
import { WorldProvider } from '../../../world';
import { PairingDesk } from './PairingDesk';

const hoisted = vi.hoisted(() => ({ current: null as Backend | null }));
vi.mock('../../../../../lib/runtime', () => ({ backend: () => hoisted.current }));

function withoutRelay(): Backend {
  const real = mockBackend('main');
  return {
    kind: real.kind,
    label: real.label,
    listen: (e, cb) => real.listen(e, cb),
    invoke: async (cmd, args, opts) => {
      const r = await real.invoke(cmd, args, opts);
      if (cmd === 'get_settings') return { ...(r as object), relay_available: false, house: 'unavailable' } as typeof r;
      return r;
    },
  };
}

describe('a copy with no relay', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); resetMockState(); });
  afterEach(() => { cleanup(); hoisted.current = null; });

  it('says it is not set up, not Offline', async () => {
    hoisted.current = withoutRelay();
    render(<WorldProvider><PairingDesk mode="house" setMode={() => {}} /></WorldProvider>);
    expect(await screen.findByText(PAIR.offline)).toBeTruthy();
    expect(screen.getByText(PAIR.offlineText)).toBeTruthy();
    expect(screen.queryByText('Offline')).toBeNull();
    expect(document.body.textContent).not.toMatch(/meeting point/i);
  });

  it('keeps the wake and retry words away from the not-set-up state', () => {
    for (const w of [PAIR.offline, PAIR.offlineText, PAIR.noRelayHint, PAIR.houseState.unavailable, PAIR.notInVersion]) {
      expect(w).not.toMatch(/offline|meeting point|waking|try again/i);
    }
    expect(PAIR.offlineText).not.toMatch(/—/);
  });
});

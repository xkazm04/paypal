// U2 in the Main console: the footer carries the wallet's mode badge on every layer, and the Book
// ledger badges a deal whose mode is not sandbox and leaves a sandbox deal bare (Ledger.tsx, LedgerRow).
// Exports: toCSV's `mode` column is asserted in modules/book/model.test.ts ('writes exact decimals,
// neutralises formulas and carries the mode on every row'); the export's file name carries the modes.
import { act, cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setClockOffset } from '../../../lib/clock';
import { mockBackend } from '../../../mock/backend';
import { renderLayerAtScale } from './testing/scaleSmoke';

vi.mock('../../../lib/runtime', async () => (await import('./testing/runtime')).runtimeMock);

afterEach(() => { vi.useRealTimers(); cleanup(); history.replaceState(null, '', '/'); });

describe('U2: the Main console carries a mode badge', () => {
  it.each(['#', '#m=book', '#p=settings'])('the footer shows the wallet’s mode badge on %s', async (hash) => {
    await renderLayerAtScale(hash === '#' ? { level: 'home' } : hash, null);
    const mode = mockBackend('main').world.settings().mode;
    const badge = document.querySelector('.cs-foot .badge:not(.mock)');
    expect(badge?.textContent).toBe(mode === 'sandbox' ? 'Sandbox' : mode === 'replay' ? 'Replay' : 'Practice agent');
  }, 30_000);

  // The ledger opens on this week, and until the sample week fits before now (early on a Monday) the mock
  // plays it as last week, replayed deal included: pin a Wednesday afternoon (local time, Date only).
  it('the Book ledger badges non-sandbox deals and leaves sandbox deals bare', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 21, 15, 0));
    const r = await renderLayerAtScale('#m=book&v=ledger', null);
    // useNow keeps its last tick until the next one: tick it onto the pinned instant.
    await act(async () => { setClockOffset(1); setClockOffset(0); });
    const deals = await mockBackend('main').invoke('list_deals', null);
    expect(deals.some((d) => d.mode === 'replay'), 'the sample wallet has a replayed deal').toBe(true);
    expect(deals.some((d) => d.mode === 'sandbox'), 'and a sandbox deal').toBe(true);
    const rows = await waitFor(() => {
      const found = [...r.layer.querySelectorAll('.sg-grid .ag-center-cols-container .ag-row')];
      if (!found.length) throw new Error('no rows');
      return found;
    });
    const badged = rows.filter((row) => row.querySelector('[col-id="status"] .badge'));
    const bare = rows.filter((row) => !row.querySelector('[col-id="status"] .badge'));
    expect(badged.length, 'a replayed deal is on the ledger with its badge').toBeGreaterThan(0);
    expect(bare.length, 'sandbox deals are on the ledger without one').toBeGreaterThan(0);
    for (const row of badged) expect(row.querySelector('[col-id="status"] .badge')!.textContent).not.toBe('Sandbox');
  }, 30_000);
});

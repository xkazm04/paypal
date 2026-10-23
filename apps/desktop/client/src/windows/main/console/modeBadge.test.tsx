// U2 in the Main console: the footer carries the wallet's mode badge on every layer, and the Book
// ledger badges a deal whose mode is not sandbox and leaves a sandbox deal bare (Ledger.tsx, LedgerRow).
// Exports: toCSV's `mode` column is asserted in modules/book/model.test.ts ('writes exact decimals,
// neutralises formulas and carries the mode on every row'); the export's file name carries the modes.
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockBackend } from '../../../mock/backend';
import { renderLayerAtScale } from './testing/scaleSmoke';

vi.mock('../../../lib/runtime', async () => (await import('./testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

describe('U2: the Main console carries a mode badge', () => {
  it.each(['#', '#m=book', '#p=settings'])('the footer shows the wallet’s mode badge on %s', async (hash) => {
    await renderLayerAtScale(hash === '#' ? { level: 'home' } : hash, null);
    const mode = mockBackend('main').world.settings().mode;
    const badge = document.querySelector('.cs-foot .badge:not(.mock)');
    expect(badge?.textContent).toBe(mode === 'sandbox' ? 'Sandbox' : mode === 'replay' ? 'Replay' : 'Practice agent');
  }, 30_000);

  it('the Book ledger badges non-sandbox deals and leaves sandbox deals bare', async () => {
    const r = await renderLayerAtScale('#m=book&v=ledger', null);
    const deals = await mockBackend('main').invoke('list_deals', null);
    expect(deals.some((d) => d.mode === 'replay'), 'the sample wallet has a replayed deal').toBe(true);
    expect(deals.some((d) => d.mode === 'sandbox'), 'and a sandbox deal').toBe(true);
    const rows = [...r.layer.querySelectorAll('.bk-row')];
    const badged = rows.filter((row) => row.querySelector('.bk-sub .badge'));
    const bare = rows.filter((row) => !row.querySelector('.bk-sub .badge'));
    expect(badged.length, 'a replayed deal is on the ledger with its badge').toBeGreaterThan(0);
    expect(bare.length, 'sandbox deals are on the ledger without one').toBeGreaterThan(0);
    for (const row of badged) expect(row.querySelector('.bk-sub .badge')!.textContent).not.toBe('Sandbox');
  }, 30_000);
});

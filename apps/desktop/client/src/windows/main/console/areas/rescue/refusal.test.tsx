// The wallet's refusal of a fix, as one quiet line on the case and on the row (LENA-L1): the same
// words in both, no second gold button, and "If you do nothing" untouched.
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RESCUE } from '../../../../../lib/words';
import { renderLayerAtScale } from '../../testing/scaleSmoke';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 }); });

const GRID_ROW = '.sg-grid .ag-center-cols-container .ag-row';
const refusedRow = (layer: HTMLElement) => waitFor(() => { const e = layer.querySelector<HTMLElement>(`${GRID_ROW} .rs-refusal`); if (!e) throw new Error('no refused row'); return e.closest('.ag-row') as HTMLElement; });

const LINE = RESCUE.refusal.line(RESCUE.refusal.why.over_discount_share);

describe('Rescue refusal line', () => {
  it('says the wallet would not allow the offer, on the row and on the case, with one gold button', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
    const r = await renderLayerAtScale('#m=rescue&v=failed', null);
    const refused = await refusedRow(r.layer);
    const rows = [...r.layer.querySelectorAll(`${GRID_ROW} .rs-refusal`)].map((e) => e.textContent);
    expect(rows).toEqual([RESCUE.refusal.short]);
    expect(LINE).toBe('The wallet won’t allow this offer: the discount is a bigger share than your rules allow. Nothing is sent.');
    await act(async () => { fireEvent.click(refused); });
    const panel = await waitFor(() => { const p = r.layer.querySelector('.rs-panel'); if (!p) throw new Error('no panel'); return p; });
    expect(panel?.querySelector('.rs-refusal')?.textContent).toBe(LINE);
    expect(panel?.querySelector('.rs-sil')?.textContent).toContain(RESCUE.ifNothing);
    expect(r.layer.querySelectorAll('.ui-btn.gold').length).toBeLessThanOrEqual(1);
  }, 60_000);

  it('is not gold on a case the wallet refuses: nothing waits on the owner', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
    const r = await renderLayerAtScale('#m=rescue&v=failed', null);
    const refused = await refusedRow(r.layer);
    await act(async () => { fireEvent.click(refused); });
    const panel = await waitFor(() => { const p = r.layer.querySelector<HTMLElement>('.rs-panel'); if (!p) throw new Error('no panel'); return p; });
    expect(panel.querySelector('.rs-refusal')).not.toBeNull();
    const handoff = panel.querySelector('[data-fk="rescue-handoff"]') as HTMLElement;
    expect(handoff).not.toBeNull();
    expect(handoff.className).not.toMatch(/\bgold\b/);
  }, 60_000);
});

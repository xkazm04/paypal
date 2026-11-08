// The wallet's refusal of a fix, as one quiet line on the case and on the row (LENA-L1): the same
// words in both, no second gold button, and "If you do nothing" untouched.
import { act, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RESCUE } from '../../../../../lib/words';
import { renderLayerAtScale } from '../../testing/scaleSmoke';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 }); });

const LINE = RESCUE.refusal.line(RESCUE.refusal.why.over_discount_share);

describe('Rescue refusal line', () => {
  it('says the wallet would not allow the offer, on the row and on the case, with one gold button', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
    const r = await renderLayerAtScale('#m=rescue&v=failed', null);
    const rows = [...r.layer.querySelectorAll('.rs-row .rs-refusal')].map((e) => e.textContent);
    expect(rows).toEqual([LINE]);
    expect(LINE).toBe('The wallet won’t allow this offer: the discount is a bigger share than your rules allow. Nothing is sent.');
    const refused = r.layer.querySelector('.rs-refusal')?.closest('.le-row') as HTMLElement | null;
    await act(async () => { fireEvent.click(refused ?? (r.layer.querySelector('.le-row') as HTMLElement)); });
    const panel = r.layer.querySelector('.rs-panel');
    expect(panel?.querySelector('.rs-refusal')?.textContent).toBe(LINE);
    expect(panel?.querySelector('.rs-sil')?.textContent).toContain(RESCUE.ifNothing);
    expect(r.layer.querySelectorAll('.ui-btn.gold').length).toBeLessThanOrEqual(1);
  }, 60_000);

  it('is not gold on a case the wallet refuses: nothing waits on the owner', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
    const r = await renderLayerAtScale('#m=rescue&v=failed', null);
    const refused = r.layer.querySelector('.rs-refusal')?.closest('.le-row') as HTMLElement | null;
    await act(async () => { fireEvent.click(refused ?? (r.layer.querySelector('.le-row') as HTMLElement)); });
    const panel = r.layer.querySelector('.rs-panel') as HTMLElement;
    expect(panel.querySelector('.rs-refusal')).not.toBeNull();
    const handoff = panel.querySelector('[data-fk="rescue-handoff"]') as HTMLElement;
    expect(handoff).not.toBeNull();
    expect(handoff.className).not.toMatch(/\bgold\b/);
  }, 60_000);
});

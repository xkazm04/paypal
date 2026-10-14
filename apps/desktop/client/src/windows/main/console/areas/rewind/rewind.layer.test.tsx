// The Rewind layer (rebuild WP3c): its tape is windowed, filtered by who decided and opens a
// step's deal one layer down; the day anchors move the playhead; nothing is sent but reads.
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REWIND_BAR, REWIND_TAPE } from '../../../../../lib/words';
import { expectLayerHealthy, renderLayerAtScale } from '../../testing/scaleSmoke';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

describe('the Rewind', () => {
  it('filters the tape by who decided and opens a step’s deal', async () => {
    const r = await renderLayerAtScale({ level: 'rewind' }, 'large');
    expectLayerHealthy(r);
    const tape = within(r.layer).getByRole('region', { name: REWIND_TAPE.label });
    const refused = within(tape).getByRole('button', { name: new RegExp(`^${REWIND_BAR.legendShort.refused}`) });
    fireEvent.click(refused);
    await waitFor(() => {
      const lines = [...tape.querySelectorAll('.rw-line')];
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) expect(l.classList.contains('t-refused')).toBe(true);
    });
    const row = tape.querySelector<HTMLButtonElement>('.le-row');
    fireEvent.click(row as HTMLButtonElement);
    await waitFor(() => expect(document.querySelector('.cs-layer')?.getAttribute('data-layer')).toBe('deal'));
  }, 60_000);

  it('a day anchor moves the playhead to that day', async () => {
    const r = await renderLayerAtScale({ level: 'rewind' }, 'small');
    const slider = within(r.layer).getByRole('slider', { name: REWIND_BAR.playhead });
    const mon = within(r.layer).getByRole('button', { name: REWIND_BAR.days[0] });
    const was = Number(slider.getAttribute('aria-valuenow'));
    fireEvent.click(mon);
    await waitFor(() => expect(Number(slider.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(was));
    expect(Number(slider.getAttribute('aria-valuenow'))).toBe(Number(slider.getAttribute('aria-valuemin')) + 12 * 3600);
  }, 60_000);
});

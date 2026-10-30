// The Rewind layer (rebuild WP3c): its tape is windowed, filtered by who decided and opens a
// step's deal one layer down; the day anchors move the playhead; nothing is sent but reads.
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setClockOffset } from '../../../../../lib/clock';
import { REWIND_ANSWER, REWIND_BAR, REWIND_TAPE, REWIND_TRUNCATED } from '../../../../../lib/words';
import { expectLayerHealthy, renderLayerAtScale } from '../../testing/scaleSmoke';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

const PINNED_INSTANTS = [
  ['Monday 09:00', new Date(2026, 9, 19, 9, 0), false],
  ['Wednesday 15:00', new Date(2026, 9, 21, 15, 0), true],
  ['Sunday 23:30', new Date(2026, 9, 25, 23, 30), true],
] as const;

afterEach(() => { vi.useRealTimers(); cleanup(); history.replaceState(null, '', '/'); });

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

  // The busy merchant's week holds more steps than one read returns (the oldest are left out): its
  // counts are a floor, and the answer says so where it gives them, not only in the bar's note.
  it('says its counts are at least, and why, when the week was cut to its latest steps', async () => {
    const big = await renderLayerAtScale({ level: 'rewind' }, 'large');
    const head = () => big.layer.querySelector('[data-layer-title]')?.textContent ?? '';
    await waitFor(() => expect(head()).not.toBe(REWIND_ANSWER.reading));
    expect(head()).toMatch(/^At least /);
    expect(big.layer.querySelector('.pf-sub')?.textContent).toBe(REWIND_TRUNCATED);
    cleanup();
    const small = await renderLayerAtScale({ level: 'rewind' }, 'small');
    await waitFor(() => expect(small.layer.querySelector('[data-layer-title]')?.textContent).not.toBe(REWIND_ANSWER.reading));
    expect(small.layer.querySelector('[data-layer-title]')?.textContent).not.toMatch(/^At least /);
    expect(small.layer.querySelector('.pf-sub')?.textContent).toBe(REWIND_ANSWER.sub);
  }, 60_000);

  // The playhead runs on past now into the forecast's 72 hours, so the Mon 12:00 anchor lands there even
  // when Monday noon has not come yet: pin the instant (local time, Date only) instead of reading the clock.
  it.each(PINNED_INSTANTS)('a day anchor moves the playhead to that day — %s', async (_name, at) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at);
    const r = await renderLayerAtScale({ level: 'rewind' }, 'small');
    // useNow keeps its last tick until the next one: tick it onto the pinned instant.
    await act(async () => { setClockOffset(1); setClockOffset(0); });
    const slider = within(r.layer).getByRole('slider', { name: REWIND_BAR.playhead });
    const mon = within(r.layer).getAllByRole('button', { name: REWIND_BAR.days[0] })[0] as HTMLElement;
    // The playhead opens at now; the track ends 72 hours past it (the forecast's reach).
    const now = Math.floor(at.getTime() / 1000);
    expect(Number(slider.getAttribute('aria-valuemax'))).toBe(now + 72 * 3600);
    fireEvent.click(mon);
    // Monday noon is where the anchor lands, before now or after it.
    const noon = Number(slider.getAttribute('aria-valuemin')) + 12 * 3600;
    await waitFor(() => expect(Number(slider.getAttribute('aria-valuenow'))).toBe(noon));
  }, 60_000);

  it('draws the next 72 hours past a gold now line, one dashed tick for each forecast step', async () => {
    const r = await renderLayerAtScale({ level: 'rewind' }, 'small');
    await waitFor(() => expect(r.layer.querySelector('.rw-now')).not.toBeNull());
    const ticks = r.layer.querySelectorAll('.rw-tick.fut');
    expect(ticks.length).toBeGreaterThan(0);
    expect(r.layer.querySelector('.rw-walk')?.textContent).toMatch(/^If you walk away: \$0 leaves\./);
    // Past the line the hub says what the forecast says, and no money moves.
    const slider = within(r.layer).getByRole('slider', { name: REWIND_BAR.playhead });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    await waitFor(() => expect(r.layer.querySelector('.rw-ahead-hub')).not.toBeNull());
    expect(r.layer.querySelector('.rw-ahead-hub')?.textContent).toMatch(/no money moves|Nothing is scheduled/);
  }, 60_000);
});

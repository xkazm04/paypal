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

  // The playhead stops at now, so the Mon 12:00 anchor only lands there once Monday noon has passed:
  // pin the instant (local time, Date only) instead of reading the real clock.
  it.each(PINNED_INSTANTS)('a day anchor moves the playhead to that day — %s', async (_name, at, pastNoon) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at);
    const r = await renderLayerAtScale({ level: 'rewind' }, 'small');
    // useNow keeps its last tick until the next one: tick it onto the pinned instant.
    await act(async () => { setClockOffset(1); setClockOffset(0); });
    const slider = within(r.layer).getByRole('slider', { name: REWIND_BAR.playhead });
    const mon = within(r.layer).getByRole('button', { name: REWIND_BAR.days[0] });
    // The playhead opens at the live end (now); the tick above moved that end, so measure from it.
    const was = Number(slider.getAttribute('aria-valuemax'));
    fireEvent.click(mon);
    await waitFor(() => expect(Number(slider.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(was));
    // Monday noon is where the anchor lands; before it the playhead stops at now, the latest moment of the week.
    const noon = Number(slider.getAttribute('aria-valuemin')) + 12 * 3600;
    expect(Number(slider.getAttribute('aria-valuenow'))).toBe(pastNoon ? noon : Number(slider.getAttribute('aria-valuemax')));
    expect(Number(slider.getAttribute('aria-valuemax'))).toBe(Math.floor(at.getTime() / 1000));
  }, 60_000);
});

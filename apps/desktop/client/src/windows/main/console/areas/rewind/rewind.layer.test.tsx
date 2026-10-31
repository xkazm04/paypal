// The Rewind layer (rebuild WP3c): its tape is windowed, filtered by who decided and opens a
// step's deal one layer down; the day anchors move the playhead; nothing is sent but reads.
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setClockOffset } from '../../../../../lib/clock';
import { sayClear } from '../../../../../lib/say/store';
import { REWIND_AHEAD, REWIND_ANSWER, REWIND_BAR, REWIND_TAPE, REWIND_TRUNCATED, SAY } from '../../../../../lib/words';
import { frameUrls, storyFor } from '../../../../../director/stories';
import { expectLayerHealthy, renderLayerAtScale } from '../../testing/scaleSmoke';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

const PINNED_INSTANTS = [
  ['Monday 09:00', new Date(2026, 9, 19, 9, 0), false],
  ['Wednesday 15:00', new Date(2026, 9, 21, 15, 0), true],
  ['Sunday 23:30', new Date(2026, 9, 25, 23, 30), true],
] as const;

afterEach(() => { vi.useRealTimers(); cleanup(); history.replaceState(null, '', '/'); sayClear(); });

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

  it('steps the playhead event by event, and N comes back to now', async () => {
    const r = await renderLayerAtScale({ level: 'rewind' }, 'small');
    await waitFor(() => expect(r.layer.querySelector('.rw-now')).not.toBeNull());
    const slider = within(r.layer).getByRole('slider', { name: REWIND_BAR.playhead });
    const at = () => Number(slider.getAttribute('aria-valuenow'));
    const start = at();
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    const back = at();
    expect(back).toBeLessThan(start);
    // a recorded step sits exactly where the playhead stopped (it went event by event, not by the hour)
    expect(start - back).not.toBe(3600);
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(at()).toBeGreaterThanOrEqual(start - 1);
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(at()).toBeGreaterThan(start);
    fireEvent.keyDown(slider, { key: 'n' });
    expect(Math.abs(at() - start)).toBeLessThanOrEqual(2);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(at()).toBe(Number(slider.getAttribute('aria-valuemax')));
    expect(slider.getAttribute('aria-valuetext')).toContain(REWIND_AHEAD.forecastWord);
  }, 60_000);

  // Late in the week the mock week's first timed step has passed and the next one is an untimed tick:
  // pin a Wednesday 10:00 (local time, Date only) instead of reading the clock.
  it('says what happens first if she does nothing, and counts down to it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 21, 10, 0));
    const r = await renderLayerAtScale({ level: 'rewind' }, null);
    await act(async () => { setClockOffset(1); setClockOffset(0); });
    const line = await waitFor(() => { const e = r.layer.querySelector('.rw-nextline'); expect(e).not.toBeNull(); return e as HTMLElement; });
    expect(line.textContent).toContain(REWIND_AHEAD.next);
    expect(line.textContent).toMatch(/nothing is paid|hold .* ends on its own|collected|put on hold/);
    const t = line.querySelector('time');
    expect(t?.getAttribute('aria-label')).toMatch(/left$/);
  }, 60_000);

  it('a past week ends where it always did: no Now line, no forecast, no headline', async () => {
    const r = await renderLayerAtScale({ level: 'rewind' }, 'small');
    await waitFor(() => expect(r.layer.querySelector('.rw-now')).not.toBeNull());
    fireEvent.click(within(r.layer).getByRole('button', { name: REWIND_BAR.before }));
    await waitFor(() => expect(r.layer.querySelector('.rw-now')).toBeNull());
    expect(r.layer.querySelector('.rw-walk')).toBeNull();
    expect(r.layer.querySelectorAll('.rw-tick.fut')).toHaveLength(0);
    expect(r.layer.querySelector('.rw-zoom')).toBeNull();
    const slider = within(r.layer).getByRole('slider', { name: REWIND_BAR.playhead });
    // the playhead stops at the week's end, as before
    // (a week that holds a clock change is an hour longer or shorter)
    expect(Math.abs(Number(slider.getAttribute('aria-valuemax')) - Number(slider.getAttribute('aria-valuemin')) - 7 * 86400)).toBeLessThanOrEqual(3600);
  }, 60_000);

  it('zooms the track to the next 72 hours and back, keeping every forecast tick', async () => {
    const r = await renderLayerAtScale({ level: 'rewind' }, 'small');
    await waitFor(() => expect(r.layer.querySelector('.rw-tick.fut')).not.toBeNull());
    const n = r.layer.querySelectorAll('.rw-tick.fut').length;
    // the clock ticks while this runs, so positions are compared to a tenth of a percent
    const left = () => [...r.layer.querySelectorAll<HTMLElement>('.rw-tick.fut')].map((e) => Number.parseFloat(/calc\(([\d.]+)%/.exec(e.style.left)?.[1] ?? 'NaN'));
    const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => Math.abs(x - (b[i] ?? NaN)) < 0.1);
    const week = left();
    fireEvent.click(within(r.layer).getByRole('button', { name: REWIND_AHEAD.zoom.ahead }));
    await waitFor(() => expect(same(left(), week)).toBe(false));
    expect(r.layer.querySelectorAll('.rw-tick.fut')).toHaveLength(n);
    fireEvent.click(within(r.layer).getByRole('button', { name: REWIND_AHEAD.zoom.week }));
    await waitFor(() => expect(same(left(), week)).toBe(true));
  }, 60_000);

  it('says a rule, shows what it allows over the same hours, and lines her open tables up against it', async () => {
    // Maya's own week (no scale): her two open tables for the 27-inch 4K monitor
    const r = await renderLayerAtScale({ level: 'rewind' }, null);
    const box = await within(r.layer).findByRole('textbox', { name: SAY.label });
    fireEvent.change(box, { target: { value: 'Haggle for a monitor, up to $340, ask me above $320, six offers, for 3 days' } });
    fireEvent.click(within(r.layer).getByRole('button', { name: SAY.read }));
    // "a monitor" fits two of her items: it asks which, with her open tables first
    const q = await waitFor(() => { const e = r.layer.querySelector('.say-q[data-q="item-which"]'); expect(e).not.toBeNull(); return e as HTMLElement; });
    fireEvent.click(within(q).getByRole('button', { name: /27-inch 4K monitor/ }));
    await waitFor(() => expect(r.layer.querySelector('.rw-reach')).not.toBeNull());
    expect(r.layer.querySelector('.rw-flag.rule')?.textContent).toContain('Your new rules end');
    const peeks = await waitFor(() => { const e = r.layer.querySelector('.rw-peeks'); expect(e).not.toBeNull(); return e as HTMLElement; });
    expect(peeks.textContent).toContain('your agent could agree to this on its own');
    expect(peeks.textContent).toContain('so your agent would stop and ask you');
    // and the track zoomed to the days the rules cover
    expect(within(r.layer).getByRole('button', { name: REWIND_AHEAD.zoom.ahead }).getAttribute('aria-pressed')).toBe('true');
  }, 60_000);

  it('draws no forecast tick and no zero when the forecast could not be read', async () => {
    // the mock's ?forecast=off previews a shell whose forecast read failed (the harness takes only a scale, so it rides on it)
    const r = await renderLayerAtScale({ level: 'rewind' }, 'small&forecast=off' as 'small');
    await waitFor(() => expect(r.layer.querySelector('.rw-walk')).not.toBeNull());
    expect(r.layer.querySelectorAll('.rw-tick.fut')).toHaveLength(0);
    expect(r.layer.querySelector('.rw-walk')?.textContent).toContain(REWIND_AHEAD.unknown);
    expect(r.layer.querySelector('.rw-walk')?.textContent).not.toMatch(/\$0/);
    expect(r.layer.querySelector('.rw-walk')?.className).toContain('unknown');
  }, 60_000);
});

// The director's film switch: Maya's film ends on the Rewind as it always did (`film_ending=today`, the story's
// default) or on Say it and the timeline past now (`say`). The main frame's address carries it; the app itself
// has none, and always shows both.
describe('the film ending', () => {
  /** The main frame's address for a director page, as the director builds it, opened on the Rewind. */
  const frameSearch = (directorSearch: string) => new URL(frameUrls(storyFor(directorSearch)).main('#r=rewind'), 'http://preview/').search.slice(1);
  const drawn = async (search: string) => {
    const r = await renderLayerAtScale({ level: 'rewind' }, null, { search });
    await waitFor(() => expect(r.layer.querySelector('.rw-bar')).not.toBeNull());
    return r.layer;
  };

  it('Maya’s story with film_ending=today renders the Rewind without the Say box or the forecast past now', async () => {
    expect(storyFor('').filmEnding).toBe('today');
    for (const q of ['', '?story=maya', '?film_ending=today']) expect(frameSearch(q), q).toBe('film_ending=today');
    const layer = await drawn(frameSearch(''));
    // the week's figures are there, the Say box is not
    await waitFor(() => expect(layer.querySelector('[data-layer-title]')?.textContent).not.toBe(REWIND_ANSWER.reading));
    expect(layer.querySelector('.say')).toBeNull();
    expect(layer.textContent).not.toContain(SAY.titleShort);
    // no gold now line, no forecast ticks, no walk-away line, and the playhead stops at now
    expect(layer.querySelector('.rw-now')).toBeNull();
    expect(layer.querySelectorAll('.rw-tick.fut')).toHaveLength(0);
    expect(layer.querySelector('.rw-walk')).toBeNull();
    const slider = within(layer).getByRole('slider', { name: REWIND_BAR.playhead });
    expect(Number(slider.getAttribute('aria-valuemax'))).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 2);
  }, 60_000);

  it('under film_ending=say, and in the app itself, the Say box and the timeline past now show', async () => {
    expect(frameSearch('?film_ending=say')).toBe('film_ending=say');
    for (const search of [frameSearch('?film_ending=say'), '']) {
      const layer = await drawn(search);
      await waitFor(() => expect(layer.querySelector('.rw-now')).not.toBeNull());
      expect(layer.querySelector('.say')).not.toBeNull();
      expect(layer.querySelector('.rw-walk')?.textContent).toMatch(/^If you walk away: \$0 leaves\./);
      cleanup();
    }
  }, 60_000);
});

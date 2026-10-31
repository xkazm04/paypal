// Break The Table's table panel is e4's corridor on D-0193's recorded haggle: the beats the arena draws
// equal the ones the Tables layer's "Watch it" reads back from the sample world's D-0193 (one recorded
// truth), an attack that pushed a price past her band adds a hit on her wall, and the corridor shows its
// final frame (every beat landed) when the document is hidden or motion is calm, not only when there is
// no animation frame clock. Beats added to a replay at rest play on to the new last frame.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mockBackend, resetMockState } from '../mock/backend';
import { DAN_LABEL, RECORDED } from '../mock/haggle';
import { TABLES_WATCH } from '../lib/words';
import { Corridor } from '../windows/main/console/areas/tables/Corridor';
import { captionOf, haggleOf } from '../windows/main/modules/tables/corridor';
import { short } from '../windows/main/modules/tables/ladder';
import { arenaHaggle, attackPrice, hitsWall, recordedBeats } from './corridor';
import { RECORD } from './record';

const usd = (minor: number) => short(minor, 'USD');
const wallHits = RECORD.attacks.filter((a) => hitsWall(a));

describe('the arena’s corridor', () => {
  afterEach(() => { cleanup(); resetMockState(); });

  it('draws the same beats Tables reads back for D-0193 from the sample world', async () => {
    resetMockState();
    const main = mockBackend('main');
    const id = main.world.deal(DAN_LABEL)?.deal.id ?? '';
    const [deal, transcript, history, display] = await Promise.all([
      main.invoke('get_deal', { deal_id: id }),
      main.invoke('deal_transcript', { deal_id: id }),
      main.invoke('deal_history', { deal_id: id }),
      main.invoke('deal_display', { deal_id: id }),
    ]);
    const tables = haggleOf({
      currency: deal.terms.currency, side: deal.side, transcript, history: history.steps,
      ceiling: display.band?.ceiling?.minor ?? null, floor: display.band?.floor?.minor ?? null, maxOffers: display.band?.max_rounds ?? null,
    });
    expect(recordedBeats(RECORDED.dan)).toEqual(tables.beats);
    expect(arenaHaggle([]).beats).toEqual(tables.beats);
    expect(arenaHaggle([]).ceiling).toBe(display.band?.ceiling?.minor ?? null);
  });

  it('hits the wall only for the attacks whose price is past her band, on the haggle, refused', () => {
    expect(wallHits.length).toBeGreaterThan(0);
    for (const a of RECORD.attacks) {
      const p = attackPrice(a);
      const past = a.deal.which === 'haggle' && 'code' in a.answer && p !== null && p > RECORDED.dan.rules.ceiling;
      expect(hitsWall(a), a.id).toBe(past);
    }
    const h = arenaHaggle([...RECORD.attacks, ...RECORD.attacks]);
    const added = h.beats.slice(recordedBeats(RECORDED.dan).length);
    expect(added).toHaveLength(2 * wallHits.length);
    for (const b of added) {
      expect(b).toEqual({ kind: 'refused', price: null, clause: 4 });
      expect(captionOf(b, h, 'Dan')).toBe(TABLES_WATCH.refusedWall(usd(RECORDED.dan.rules.ceiling)));
    }
  });
});

describe('the corridor’s final frame', () => {
  const haggle = arenaHaggle([]);
  const last = () => captionOf(haggle.beats[haggle.beats.length - 1]!, haggle, 'Dan');
  const caption = (c: HTMLElement) => c.querySelector('.hc-caption')?.textContent;
  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove('calm');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });

  it('starts on its first frame while visible, with motion', () => {
    const { container } = render(<Corridor haggle={haggle} who="Dan" />);
    expect(caption(container)).not.toBe(last());
  });

  it('shows the last frame at once in a hidden document', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    const { container } = render(<Corridor haggle={haggle} who="Dan" />);
    expect(caption(container)).toBe(last());
  });

  it('jumps to the last frame when the document is hidden mid-play', () => {
    const { container } = render(<Corridor haggle={haggle} who="Dan" />);
    expect(caption(container)).not.toBe(last());
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(caption(container)).toBe(last());
  });

  it('shows the last frame under calm motion, and a wall hit added later lands at once', () => {
    document.documentElement.classList.add('calm');
    const { container, rerender } = render(<Corridor haggle={haggle} who="Dan" />);
    expect(caption(container)).toBe(last());
    const hit = arenaHaggle(wallHits.slice(0, 1));
    rerender(<Corridor haggle={hit} who="Dan" />);
    expect(caption(container)).toBe(TABLES_WATCH.refusedWall(usd(RECORDED.dan.rules.ceiling)));
    expect(container.querySelector('.hc-wall.hit')).toBeTruthy();
  });
});

// The "Latest" strip under every summary (rebuild WP4a, Director decision 1: no dead band under the
// cards). jsdom has no layout, so the room is measured as none and the strip draws its minimum; the
// band itself is measured in the browser (docs/build/rebuild/wp4a.md, scratchpad wp4a_measure.py).
// What is guarded here: how many rows fit (pure), that every module summary and the short places
// carry a strip after their cards, that the strip stays quiet (no gold, no second gold action) and
// that a row opens its deal and "See all" opens the full view.
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Module } from '@bindings/Module';
import { MAX_ROWS, MIN_ROWS, rowsThatFit } from './Latest';
import { renderLayerAtScale, settle } from './testing/scaleSmoke';

vi.mock('../../../lib/runtime', async () => (await import('./testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

describe('rows that fit', () => {
  it('never fewer than the minimum, never more than the maximum or than there are', () => {
    expect(rowsThatFit(0, 52, 40)).toBe(MIN_ROWS);
    expect(rowsThatFit(52 * 5, 52, 40)).toBe(5);
    expect(rowsThatFit(52 * 30, 52, 40)).toBe(MAX_ROWS);
    expect(rowsThatFit(52 * 30, 52, 2)).toBe(2);
    expect(rowsThatFit(52 * 30, 0, 40)).toBe(MIN_ROWS);
  });
});

const MODULES: Module[] = ['tables', 'spend', 'counter', 'book', 'shield', 'rescue'];
const strip = () => document.querySelector<HTMLElement>('.cs-layer .lt');
/** The strip once it is drawn. renderLayerAtScale settles on one quiet read window; on a busy machine
 *  the last read's answer can reach React just after it, so the strip is waited for, never assumed. */
const drawnStrip = () => waitFor(() => { const el = strip(); if (!el) throw new Error('no strip yet'); return el; });

describe('every module summary carries a quiet Latest strip under its cards', () => {
  for (const scale of ['small', 'large'] as const) {
    it.each(MODULES)(`%s (${scale})`, async (module) => {
      await renderLayerAtScale({ level: 'module', module }, scale);
      // Wait until the deals are read (the tab's count is known) and, unless it counts none, the strip.
      const count = await waitFor(() => {
        const tt = document.querySelector(`#cs-tab-${module} .tt`);
        if (!tt || tt.classList.contains('unknown')) throw new Error('deals not read yet');
        const n = tt.textContent?.trim() ?? '';
        if (n !== '0' && !strip()) throw new Error('no strip yet');
        return n;
      });
      // a module with no deal at all on this world (its tab counts 0) has nothing to list, also once
      // every read has settled
      if (count === '0') { await settle(); expect(strip()).toBeNull(); return; }
      const lt = strip();
      expect(lt, 'a strip').toBeTruthy();
      // after the cards, before the explanation
      const cards = document.querySelector('.cs-layer .ml-cards');
      expect(cards && lt && (cards.compareDocumentPosition(lt) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
      const rows = lt?.querySelectorAll('.lt-row').length ?? 0;
      expect(rows).toBeGreaterThan(0);
      expect(rows).toBeLessThanOrEqual(MAX_ROWS);
      // quiet: no gold button inside it, and the layer still has at most one gold action
      expect(lt?.querySelector('.ui-btn.gold, .gold.ui-btn')).toBeNull();
      expect(document.querySelectorAll('.cs-layer .ui-btn.gold').length).toBeLessThanOrEqual(1);
    }, 60_000);
  }

  it('a row opens its deal, and See all opens the full view with Back returning to the summary', async () => {
    await renderLayerAtScale({ level: 'module', module: 'spend' }, 'small');
    const row = (await drawnStrip()).querySelector<HTMLButtonElement>('.lt-row');
    if (!row) throw new Error('no row');
    await act(async () => { fireEvent.click(row); });
    await waitFor(() => expect(document.querySelector('.cs-layer')?.getAttribute('data-layer')).toBe('deal'));
    expect(location.hash).toMatch(/^#d=.+&m=spend$/);
    await renderLayerAtScale({ level: 'module', module: 'book' }, 'small');
    const all = (await drawnStrip()).querySelector<HTMLButtonElement>('.lt-all');
    if (!all) throw new Error('no See all');
    // a click focuses the button in a browser (jsdom does not)
    act(() => { all.focus(); });
    await act(async () => { fireEvent.click(all); });
    await waitFor(() => expect(location.hash).toBe('#m=book&v=recent'));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(location.hash).toBe('#m=book'));
    await waitFor(() => expect(document.activeElement?.classList.contains('lt-all')).toBe(true));
  }, 60_000);
});

describe('the short places carry the strip too', () => {
  it.each<[string, string, 'rows' | 'facts']>([
    ['wallet limits', '#p=limits', 'facts'],
    ['the safety record', '#p=safety', 'facts'],
    ['connect a wallet', '#p=pairing', 'rows'],
  ])('%s', async (_name, hash, kind) => {
    await renderLayerAtScale(hash, 'small');
    const lt = await drawnStrip();
    if (kind === 'facts') expect(lt.querySelectorAll('.lt-fact').length).toBeGreaterThanOrEqual(4);
    else expect(lt.querySelectorAll('.lt-row').length).toBeGreaterThan(0);
  }, 60_000);

  it('a short waiting list takes its own height and shows what was decided lately; a long one keeps the sheet', async () => {
    await renderLayerAtScale('#w=waiting', 'small');
    await waitFor(() => expect(document.querySelector('.cs-waiting')?.classList.contains('short')).toBe(true));
    const row = (await drawnStrip()).querySelector<HTMLButtonElement>('.lt-row');
    if (!row) throw new Error('no decided row');
    await act(async () => { fireEvent.click(row); });
    await waitFor(() => expect(document.querySelector('.cs-layer')?.getAttribute('data-layer')).toBe('deal'));
    await renderLayerAtScale('#w=waiting', 'large');
    // a long list: wait for its rows (not short because it is long, not because it is unread)
    await waitFor(() => expect(document.querySelectorAll('.cs-wrow').length).toBeGreaterThan(0));
    await settle();
    expect(document.querySelector('.cs-waiting')?.classList.contains('short')).toBe(false);
    expect(strip()).toBeNull();
  }, 60_000);

  it('a deal with nothing open shows its latest moments and the other deals with them; a moment opens the story', async () => {
    await renderLayerAtScale(async (w) => ({ level: 'deal', deal: (await w.invoke('list_deals', null))[0]?.id ?? 'none' }), 'small');
    await drawnStrip();
    const strips = document.querySelectorAll('.cs-layer .lt');
    expect(strips.length).toBeGreaterThanOrEqual(1);
    const moment = strips[0]?.querySelector<HTMLButtonElement>('.lt-row');
    if (!moment) throw new Error('no moment');
    await act(async () => { fireEvent.click(moment); });
    await waitFor(() => expect(location.hash).toMatch(/&dv=story$/));
    // with the view open the strips step aside
    expect(document.querySelector('.cs-layer .lt')).toBeNull();
  }, 60_000);
});

// Accessibility of the console (rebuild WP4a), without a new dependency: axe-style structural checks
// on every layer (unique ids, named controls, one heading per layer, resolvable aria references,
// list items inside lists, one tab stop in the module tablist, labelled pictures) and one full
// keyboard session down the chain and back up with Escape, the focus landing where it was left.
// Contrast is the token test's (src/lib/contrast.test.ts: 4.5:1 for every text ink on every surface,
// both themes).
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Route } from '../logic';
import { renderLayerAtScale } from './testing/scaleSmoke';

vi.mock('../../../lib/runtime', async () => (await import('./testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

/** The accessible name of an element, roughly as a browser computes it for buttons and links. */
function nameOf(el: Element): string {
  const by = el.getAttribute('aria-labelledby');
  if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
  return (el.getAttribute('aria-label') ?? el.textContent ?? el.getAttribute('title') ?? '').trim();
}

/** The structural checks, over the whole window. Returns what failed, in words. */
function audit(): string[] {
  const out: string[] = [];
  const ids = new Map<string, number>();
  for (const el of document.querySelectorAll('[id]')) ids.set(el.id, (ids.get(el.id) ?? 0) + 1);
  for (const [id, n] of ids) if (n > 1) out.push(`duplicate id ${id} x${n}`);
  for (const el of document.querySelectorAll('button, a[href], [role="button"], [role="tab"], [role="switch"]')) {
    if (!nameOf(el)) out.push(`unnamed ${el.tagName.toLowerCase()} ${el.className}`);
  }
  for (const el of document.querySelectorAll('input:not([type="hidden"]), select, textarea')) {
    const id = el.id;
    const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || el.closest('label');
    if (!labelled) out.push(`unlabelled field ${el.getAttribute('name') ?? el.className}`);
  }
  for (const attr of ['aria-controls', 'aria-labelledby', 'aria-describedby']) {
    for (const el of document.querySelectorAll(`[${attr}]`)) {
      for (const id of (el.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean)) if (!document.getElementById(id)) out.push(`${attr} -> missing #${id}`);
    }
  }
  for (const el of document.querySelectorAll('[role="listitem"]')) if (!el.parentElement?.closest('[role="list"], ul, ol')) out.push('listitem outside a list');
  for (const el of document.querySelectorAll('li')) if (!el.parentElement || !/^(UL|OL|MENU)$/.test(el.parentElement.tagName) && el.parentElement.getAttribute('role') !== 'list') out.push('li outside a list');
  for (const el of document.querySelectorAll('[role="img"]')) if (!nameOf(el)) out.push(`unlabelled picture ${el.className.toString()}`);
  const layer = document.querySelector('.cs-layer');
  const h1 = layer ? layer.querySelectorAll('h1').length : 0;
  if (h1 !== 1) out.push(`${h1} h1 in the layer`);
  const stops = [...document.querySelectorAll<HTMLElement>('[role="tablist"] [role="tab"]')].filter((t) => t.tabIndex === 0).length;
  if (stops !== 1) out.push(`${stops} tab stops in the module tabs`);
  return out;
}

const LAYERS: Array<[string, Route | string]> = [
  ['centre', ''],
  ['tables', '#m=tables'], ['spend', '#m=spend'], ['counter', '#m=counter'], ['book', '#m=book'], ['shield', '#m=shield'], ['rescue', '#m=rescue'],
  ['a module view', '#m=book&v=ledger'],
  ['waiting', '#w=waiting'], ['rewind', '#r=rewind'],
  ['rules', '#p=rules'], ['limits', '#p=limits'], ['connections', '#p=connections'], ['pairing', '#p=pairing'], ['settings', '#p=settings'], ['settings view', '#p=settings&v=agents'], ['safety', '#p=safety'],
];

describe('the checks themselves', () => {
  it('catch a duplicate id, an unnamed button, a dangling reference and a stray list item', () => {
    document.body.innerHTML = '<div class="cs-layer"><h1>x</h1><i id="a"></i><i id="a"></i><button></button><span aria-controls="nope"></span><div><li>x</li></div></div>';
    const found = audit();
    expect(found).toEqual(expect.arrayContaining(['duplicate id a x2', 'unnamed button ', 'aria-controls -> missing #nope', 'li outside a list']));
    document.body.innerHTML = '';
  });
});

describe('every layer passes the structural checks', () => {
  it.each(LAYERS)('%s', async (_name, target) => {
    await renderLayerAtScale(target, 'small');
    expect(audit()).toEqual([]);
  }, 60_000);
  it('a deal and its open view', async () => {
    await renderLayerAtScale(async (w) => ({ level: 'deal', deal: (await w.invoke('list_deals', null))[0]?.id ?? 'none', view: 'story' }), 'small');
    expect(audit()).toEqual([]);
  }, 60_000);
  it('the module tabs are a tablist whose panel is the sheet, with the lit tab selected', async () => {
    await renderLayerAtScale('#m=spend', 'small');
    const tab = document.getElementById('cs-tab-spend');
    expect(tab?.getAttribute('role')).toBe('tab');
    expect(tab?.getAttribute('aria-selected')).toBe('true');
    const panel = document.getElementById(tab?.getAttribute('aria-controls') ?? '');
    expect(panel?.getAttribute('role')).toBe('tabpanel');
    expect(panel?.getAttribute('aria-labelledby')).toBe('cs-tab-spend');
  }, 60_000);
  it('the stale banner speaks through a live region that is always there', async () => {
    await renderLayerAtScale('', 'small');
    const live = document.querySelector('.cs-stale-live');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(document.querySelector('.ui-toasts')?.getAttribute('aria-live')).toBe('polite');
  }, 60_000);
});

describe('one keyboard session down the chain and back', () => {
  it('centre -> module -> view -> deal by keys, then Escape walks back with the focus where it was', async () => {
    await renderLayerAtScale('', 'small');
    const layerId = () => document.querySelector('.cs-layer')?.getAttribute('data-layer');
    // the module tabs are reachable (one tab stop) and arrows move along them
    const first = document.querySelector<HTMLElement>('[role="tablist"] [role="tab"][tabindex="0"]');
    expect(first?.id).toBe('cs-tab-tables');
    act(() => { first?.focus(); });
    fireEvent.keyDown(first as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement?.id).toBe('cs-tab-spend');
    // Enter on a tab is the browser's click
    await act(async () => { (document.activeElement as HTMLElement).click(); });
    await waitFor(() => expect(layerId()).toBe('spend'));
    await waitFor(() => expect(document.activeElement?.hasAttribute('data-layer-title')).toBe(true));
    // a card (a button): Enter opens its view, whose heading takes the focus
    const card = document.querySelector<HTMLElement>('.cs-layer [data-card="week"]');
    if (!card) throw new Error('no week card');
    act(() => { card.focus(); });
    await act(async () => { card.click(); });
    await waitFor(() => expect(location.hash).toBe('#m=spend&v=week'));
    // the list: arrows move, Enter opens the deal (a click would only pick it)
    const row = await waitFor(() => { const r = document.querySelector<HTMLElement>('.cs-layer .le-row[tabindex="0"]'); if (!r) throw new Error('no row'); return r; });
    act(() => { row.focus(); });
    fireEvent.keyDown(row, { key: 'ArrowDown' });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const focused = document.activeElement as HTMLElement;
    expect(focused.classList.contains('le-row')).toBe(true);
    const fk = focused.dataset.fk;
    fireEvent.keyDown(focused, { key: 'Enter' });
    await waitFor(() => expect(layerId()).toBe('deal'));
    expect(location.hash).toMatch(/^#d=.+&m=spend&v=week$/);
    await waitFor(() => expect(document.activeElement?.hasAttribute('data-layer-title')).toBe(true));
    // Escape: back to the view, the focus on the row that opened the deal
    fireEvent.keyDown(document.activeElement ?? window, { key: 'Escape' });
    await waitFor(() => expect(location.hash).toBe('#m=spend&v=week'));
    await waitFor(() => expect((document.activeElement as HTMLElement | null)?.dataset.fk).toBe(fk));
    // Escape: back to the summary, the focus on the card
    fireEvent.keyDown(document.activeElement ?? window, { key: 'Escape' });
    await waitFor(() => expect(location.hash).toBe('#m=spend'));
    await waitFor(() => expect((document.activeElement as HTMLElement | null)?.dataset.card).toBe('week'));
    // Escape: the centre
    fireEvent.keyDown(document.activeElement ?? window, { key: 'Escape' });
    await waitFor(() => expect(layerId()).toBe('centre'));
  }, 60_000);
});

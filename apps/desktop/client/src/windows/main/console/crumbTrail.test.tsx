// The crumbs fold on a narrow bar (polish A; the deal crumbs were cut at 1280 px, wp4a/wp4c open
// item): the middle layers fold into "…" with the whole way here in its title, the current layer
// is always drawn, a click on "…" lists the folded layers and moves to the one picked.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CRUMBS_MORE } from '../../../lib/words';
import { CrumbTrail, foldCrumbs, maxFold } from './CrumbTrail';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('which crumbs show at a fold level', () => {
  it('all of them, then the first + … + the last two, then … + the last two, then … + the last', () => {
    expect(foldCrumbs(5, 0)).toEqual([0, 1, 2, 3, 4]);
    expect(foldCrumbs(5, 1)).toEqual([0, -1, 3, 4]);
    expect(foldCrumbs(5, 2)).toEqual([-1, 3, 4]);
    expect(foldCrumbs(5, 3)).toEqual([-1, 4]);
  });
  it('a short chain never folds away its current layer', () => {
    expect(foldCrumbs(2, 3)).toEqual([0, 1]);
    expect(foldCrumbs(3, 1)).toEqual([-1, 1, 2]);
    expect(maxFold(2)).toBe(0);
    for (let n = 1; n <= 6; n++) for (let l = 0; l <= 3; l++) expect(foldCrumbs(n, l)).toContain(n - 1);
  });
});

const NAMES = ['What needs you', 'Spend', 'Needs you', 'Wide-format printer A2', 'Who you deal with'];

/** jsdom has no layout: every crumb name is "cut" while the trail holds more than `fits` crumbs. */
function narrowBar(fits: number) {
  const nav = () => document.querySelector('.cs-crumbs');
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    const shown = nav()?.querySelectorAll(':scope > .ui-crumb-wrap').length ?? 0;
    return shown > fits ? 100 : 10;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => 50);
}

describe('the trail on a narrow bar', () => {
  it('folds until it fits, keeps the current layer, and the whole way is in the title', () => {
    narrowBar(3);
    const go = NAMES.map(() => vi.fn());
    render(<CrumbTrail items={NAMES.map((n, i) => ({ label: n, onClick: i < NAMES.length - 1 ? go[i] : undefined }))} label="Where you are" depth={5} chainKey="a" />);
    const nav = screen.getByRole('navigation', { name: 'Where you are' });
    expect(nav.getAttribute('data-fold')).toBe('2');
    const shown = Array.from(nav.querySelectorAll(':scope > .ui-crumb-wrap')).map((c) => c.textContent?.replace('›', ''));
    expect(shown).toEqual(['…', 'Wide-format printer A2', 'Who you deal with']);
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Who you deal with');
    const more = screen.getByRole('button', { name: CRUMBS_MORE.label(3) });
    expect(more.getAttribute('title')).toBe(CRUMBS_MORE.title(NAMES.join(' › ')));

    // "…" lists the folded layers; picking one moves there.
    fireEvent.click(more);
    const items = screen.getAllByRole('menuitem').map((b) => b.textContent);
    expect(items).toEqual(['What needs you', 'Spend', 'Needs you']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Spend' }));
    expect(go[1]).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a wide bar draws the whole chain, with no "…"', () => {
    narrowBar(10);
    render(<CrumbTrail items={NAMES.map((n) => ({ label: n, onClick: () => undefined }))} label="Where you are" depth={5} chainKey="a" />);
    const nav = screen.getByRole('navigation', { name: 'Where you are' });
    expect(nav.getAttribute('data-fold')).toBeNull();
    expect(nav.querySelectorAll(':scope > .ui-crumb-wrap')).toHaveLength(5);
    expect(screen.queryByRole('button', { name: /more layers/ })).toBeNull();
    expect(nav.getAttribute('title')).toBeNull();
  });

  it('a new chain starts from the whole chain again', () => {
    narrowBar(2);
    const items = NAMES.map((n) => ({ label: n, onClick: () => undefined }));
    const r = render(<CrumbTrail items={items} label="Where you are" depth={5} chainKey="a" />);
    expect(screen.getByRole('navigation').getAttribute('data-fold')).toBe('3');
    r.rerender(<CrumbTrail items={items.slice(0, 2)} label="Where you are" depth={2} chainKey="b" />);
    expect(screen.getByRole('navigation').getAttribute('data-fold')).toBeNull();
    expect(screen.getByRole('navigation').querySelectorAll(':scope > .ui-crumb-wrap')).toHaveLength(2);
  });
});

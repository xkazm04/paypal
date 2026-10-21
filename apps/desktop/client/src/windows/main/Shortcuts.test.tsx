import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Shortcuts } from './Shortcuts';

/** Each group of the sheet as "title: keys = what" lines. */
function sheet(): string[] {
  return Array.from(document.querySelectorAll('.sc-group:not(.sc-exp)')).flatMap((g) => {
    const title = g.querySelector('h3')?.textContent ?? '';
    return Array.from(g.querySelectorAll('dt')).map((dt) => `${title}: ${Array.from(dt.children).map((k) => k.textContent).join(' ')} = ${dt.nextElementSibling?.textContent ?? ''}`);
  });
}

describe('the shortcuts sheet', () => {
  afterEach(cleanup);
  it('names the trial layouts in plain words, not by build round', () => {
    render(<Shortcuts onClose={() => {}} />);
    expect(screen.getByText('New layouts on trial')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/round [12]/i);
  });

  // The sheet is a promise: a key it names must do what it says. These are the keys the pages
  // answer to (Console.tsx, Centre.tsx, useWindowedRows, rewind/Scrubber, tables/Ladder,
  // counter/Prices + CounterLayer, rescue/parts Picks + modules/rescue/model moveCell). The Shield
  // checks have no keys of their own since the console rebuild (WP3): they are a list like any other.
  it('names only keys a page answers to', () => {
    render(<Shortcuts onClose={() => {}} />);
    const lines = sheet();
    expect(lines.filter((l) => l.startsWith('Shield:')), 'the Shield has no letter keys').toEqual([]);
    expect(lines.filter((l) => l.startsWith('Tables:') && l.includes('←')), 'Tables has no previous/next table key').toEqual([]);
    expect(lines.filter((l) => l.startsWith('Rescue:') && /subscriber/.test(l)), 'Up/Down on a fix choose a fix, not a subscriber').toEqual([]);
    // the keys every list answers to are named once
    expect(lines.some((l) => l.startsWith('Lists: ↑ ↓'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Lists: Enter'))).toBe(true);
  });
});

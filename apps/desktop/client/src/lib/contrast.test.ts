import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aaMinimum, contrast, hexTokens, luminance, mix, over, parseHex, type Rgb } from './contrast';

describe('contrast helper (WCAG 2.2)', () => {
  it('parses hex colours with and without alpha', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseHex('#101317')).toEqual([16, 19, 23, 1]);
    expect(parseHex('#00000080')?.[3]).toBeCloseTo(0.502, 2);
    expect(parseHex('red')).toBeNull();
    expect(parseHex('var(--teal)')).toBeNull();
  });

  it('matches the reference values: black on white is 21, a colour on itself is 1', () => {
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(luminance([0, 0, 0])).toBe(0);
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 2); // #767676, the classic AA grey
    expect(contrast([16, 19, 23], [16, 19, 23])).toBe(1);
  });

  it('composites alpha and color-mix like the browser', () => {
    expect(over([255, 255, 255, 0.5], [0, 0, 0])).toEqual([127.5, 127.5, 127.5]);
    expect(mix([255, 0, 0], 15, [255, 255, 255])).toEqual([255, 216.75, 216.75]);
  });

  it('knows the large-text threshold', () => {
    expect(aaMinimum(13)).toBe(4.5);
    expect(aaMinimum(24)).toBe(3);
    expect(aaMinimum(19, true)).toBe(3);
    expect(aaMinimum(19)).toBe(4.5);
  });
});

// The palette itself: every text ink must stay readable on every surface it is drawn on, in both
// themes (docs/ux/UX-GUIDE.md: 12 px is the floor, so 4.5:1 everywhere). A token edit that breaks
// this fails here instead of in a screenshot.
describe('design tokens meet WCAG AA in both themes', () => {
  // vitest runs from the client package root (pnpm --dir apps/desktop/client test)
  const css = readFileSync(resolve(process.cwd(), 'src/design/tokens.css'), 'utf8');
  const split = css.indexOf(':root[data-theme="light"]');
  const dark = hexTokens(css.slice(0, split));
  const light = { ...dark, ...hexTokens(css.slice(split)) };
  const rgb = (t: Record<string, string>, k: string): Rgb => {
    const v = t[k] ? parseHex(t[k]) : null;
    if (!v) throw new Error(`token --${k} is not a hex colour`);
    return [v[0], v[1], v[2]];
  };
  const SURFACES = ['bg', 'bg2', 'panel', 'panel2', 'panel3'];
  const INKS = ['text', 'muted', 'dim', 'teal-l', 'coral-l', 'gold-l', 'red-l', 'ok'];

  for (const [name, t, accent] of [['dark', dark, 'teal'], ['light', light, 'pp-blue']] as const) {
    it(`${name}: every text ink on every surface is at least 4.5:1`, () => {
      const low: string[] = [];
      for (const ink of INKS) for (const s of SURFACES) {
        const r = contrast(rgb(t, ink), rgb(t, s));
        if (r < 4.5) low.push(`--${ink} on --${s}: ${r.toFixed(2)}`);
      }
      expect(low).toEqual([]);
    });

    it(`${name}: secondary text stays readable on a selected row and inside state chips`, () => {
      // --sel is color-mix(accent 18% / 12%) over the sidebar or list surface (ui.css, palette.css)
      const sel = mix(rgb(t, accent), name === 'dark' ? 18 : 12, rgb(t, 'bg2'));
      expect(contrast(rgb(t, 'dim'), sel)).toBeGreaterThanOrEqual(4.5);
      // .ui-chip.<tone>: ink on color-mix(fill 14-18%) over a panel
      const chips: Array<[string, string, number]> = [['ok', 'ok', 14], ['teal-l', 'teal', 15], ['coral-l', 'coral', 15], ['gold-l', 'gold', 18], ['red-l', 'refuse', 15]];
      for (const [ink, fill, p] of chips) {
        for (const s of ['panel', 'bg2', 'panel3']) {
          const bg = mix(rgb(t, fill), p, rgb(t, s));
          expect(contrast(rgb(t, ink), bg), `${ink} chip on ${s}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }
});

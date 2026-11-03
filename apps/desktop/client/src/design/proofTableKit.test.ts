// The Proof Table's kit classes (design/kit.css, last section; spark the-proof-table WP1): the eight
// classes exist, the tone-to-ink mapping lives in one block that covers every `Tone` the board
// names (switchboard/lit.ts), every value is a token or one of the two tone locals, each tone's ink
// reads at AA on every surface the classes put it on in both themes, and the console wears the
// ground. The look itself is checked by screenshot (night and day).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, hexTokens, mix, parseHex, type Rgb } from '../lib/contrast';

const root = (p: string) => resolve(process.cwd(), p);
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const kitAll = strip(readFileSync(root('src/design/kit.css'), 'utf8'));
const kit = kitAll.slice(kitAll.indexOf(':where(.ui-fig'));
const tokensCss = readFileSync(root('src/design/tokens.css'), 'utf8');
const split = tokensCss.indexOf(':root[data-theme="light"]');
const dark = hexTokens(tokensCss.slice(0, split));
const light = { ...dark, ...hexTokens(tokensCss.slice(split)) };

const CLASSES = ['ui-ground', 'ui-sentence', 'ui-fig', 'ui-ghost', 'ui-lit', 'ui-sum', 'ui-key', 'ui-rail'];
const TONE_RULE = /\[data-tone="([a-z]+)"\] \{ --tc: var\(--([a-z0-9-]+)\); --tl: var\(--([a-z0-9-]+)\); \}/g;
const tones = [...kit.matchAll(TONE_RULE)].map((m) => ({ tone: m[1] ?? '', fill: m[2] ?? '', ink: m[3] ?? '' }));
/** The percentage a rule mixes `--<local>` at, read from the CSS so the contrast check follows it. */
const pct = (selector: string, local: string, base: string): number => {
  const body = new RegExp(`${selector.replace(/[.:()]/g, '\\$&')} \\{([^}]*)\\}`).exec(kit)?.[1] ?? '';
  const m = new RegExp(`color-mix\\(in srgb, var\\(--${local}\\) (\\d+)%, (?:var\\(--)?${base}`).exec(body);
  if (!m?.[1]) throw new Error(`${selector}: no mix of --${local} over ${base}`);
  return Number(m[1]);
};

describe('the Proof Table kit classes', () => {
  it('all eight exist as rules in kit.css', () => {
    const missing = CLASSES.filter((c) => !new RegExp(`\\.${c}(?![\\w-])[^{]*\\{`).test(kit));
    expect(missing).toEqual([]);
  });

  it('the tone block covers exactly the board’s Tone set', () => {
    const lit = readFileSync(root('src/windows/main/switchboard/lit.ts'), 'utf8');
    const union = /export type Tone = ([^;]+);/.exec(lit)?.[1] ?? '';
    const want = [...union.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
    expect(want.length).toBeGreaterThan(0);
    expect(tones.map((t) => t.tone).sort()).toEqual(want);
  });

  it('the tone locals are set in that one place only', () => {
    // the six tone rules and the neutral default, nowhere else in the stylesheet
    const sets = [...kitAll.matchAll(/--t[cl]\s*:/g)].length;
    expect(sets).toBe(2 * (tones.length + 1));
  });

  it('every value is a token or a tone local', () => {
    const declared = new Set([...tokensCss.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const unknown = [...new Set([...kit.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1] ?? ''))]
      .filter((n) => !declared.has(n) && n !== 'tc' && n !== 'tl');
    expect(unknown).toEqual([]);
  });

  for (const [name, t] of [['dark', dark], ['light', light]] as const) {
    it(`${name}: each tone's ink is at least 4.5:1 wherever the classes set it`, () => {
      const c = (k: string): Rgb => {
        const v = t[k] ? parseHex(t[k]) : null;
        if (!v) throw new Error(`--${k} is not a hex colour`);
        return [v[0], v[1], v[2]];
      };
      const low: string[] = [];
      for (const { tone, fill, ink } of tones) {
        const grounds: [string, Rgb][] = [
          ['the ground', c('bg')],
          ['a figure that is on', mix(c(ink), pct('.ui-fig:hover, .ui-fig:focus-visible, .ui-fig.is-on, .ui-fig.is-held', 'tl', 'transparent'), c('bg'))],
          ['a lit cell', mix(c(fill), pct('.ui-lit', 'tc', 'panel'), c('panel'))],
          ['a key under the pointer', mix(c(fill), pct('.ui-key:hover', 'tc', 'panel'), c('panel'))],
          ['a rail panel', mix(c(fill), pct('.ui-rail', 'tc', 'panel'), c('panel'))],
        ];
        for (const [where, g] of grounds) {
          const r = contrast(c(ink), g);
          if (r < 4.5) low.push(`${tone} (--${ink}) on ${where}: ${r.toFixed(2)}`);
        }
      }
      expect(low).toEqual([]);
    });
  }

  it('the console root wears the ground, and console.css no longer paints its own', () => {
    const tsx = readFileSync(root('src/windows/main/console/Console.tsx'), 'utf8');
    expect(tsx).toMatch(/className=\{`cs-app ui-ground[$`]/);
    const css = strip(readFileSync(root('src/windows/main/console/console.css'), 'utf8'));
    const rule = /\.cs-app \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).not.toMatch(/background/);
  });
});

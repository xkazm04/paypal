// The Calibre design layer (rebuild WP1a): every v2 token name survives, the new surfaces stay
// readable, motion in CSS matches motion in code, and the bundled fonts are present, licensed and
// small. lib/contrast.test.ts stays the arbiter for the v2 inks on the v2 surfaces.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, hexTokens, parseHex, type Rgb } from '../lib/contrast';
import { DUR, HOLD_MS } from './motion';

// vitest runs from the client package root
const root = (p: string) => resolve(process.cwd(), p);
const css = readFileSync(root('src/design/tokens.css'), 'utf8');
const split = css.indexOf(':root[data-theme="light"]');
const dark = hexTokens(css.slice(0, split));
const light = { ...dark, ...hexTokens(css.slice(split)) };
const rgb = (t: Record<string, string>, k: string): Rgb => {
  const v = t[k] ? parseHex(t[k]) : null;
  if (!v) throw new Error(`token --${k} is not a hex colour`);
  return [v[0], v[1], v[2]];
};
/** The value of `--name` in the dark (:root) block. */
const decl = (name: string): string | undefined => new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(css.slice(0, split))?.[1]?.trim();

describe('tokens keep every v2 name', () => {
  // Names the approval, tumbler, main and director CSS read (v2 tokens.css, 2026-10-06). WP4b removed
  // the two aliases nothing read any more (--on-accent, --sans); the second test keeps them gone.
  const V2 = ('accent bar bg bg2 coral coral-l ctl ctl-sm dim display ease focus font fs-body fs-display fs-mono fs-small fs-title1 fs-title2 fs-title3 ' +
    'fw-bold fw-medium fw-regular fw-semibold gold gold-l hover inspector lh lh-tight line line2 m-book m-counter m-rescue m-shield m-spend m-tables ' +
    'market material mono muted num ok on-gold on-ok on-refuse on-replay on-teal panel panel2 panel3 pp-blue pp-gold pp-navy pp-sky press ' +
    'r r-lg r-sm red-l refuse replay row row-2 scrim sel sel-line shadow-1 shadow-2 shadow-3 sheet-top sidebar sp-0 sp-1 sp-2 sp-3 sp-4 sp-5 sp-6 ' +
    'sp-8 steel t-fast t-med teal teal-l text z-app z-popover z-scrim z-sheet z-tip z-toast').split(' ');
  it('defines all of them', () => {
    const missing = V2.filter((n) => !new RegExp(`--${n}\\s*:`).test(css));
    expect(missing).toEqual([]);
  });
  it('the removed aliases stay removed', () => {
    for (const n of ['on-accent', 'sans']) expect(css, n).not.toMatch(new RegExp(`--${n}\\s*:`));
  });
});

describe('every token is read', () => {
  // A token nothing reads is a decision nobody made: its value drifts from the code it names (a
  // toast dwell of 3600 ms beside a TOAST_MS of 5200). Scale steps kept so the scale stays whole,
  // and names a test pins, are the only ones allowed to sit unread.
  const SCALE_OR_PINNED = ['accent', 'dur-instant', 'fs-micro', 'hold-ms', 'sp-0', 'sp-10', 'sp-16', 'well'];
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(css|tsx?)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
  it('no token is declared that no style, component or token reads', () => {
    const declared = new Set([...css.matchAll(/(?:^|[\s;{])--([a-z0-9-]+)\s*:/g)].map((m) => m[1] ?? ''));
    const read = new Set<string>();
    for (const f of [...files(root('src')), root('index.html'), root('approval.html'), root('tumbler.html'), root('director.html')]) {
      if (!existsSync(f)) continue;
      for (const m of readFileSync(f, 'utf8').matchAll(/var\(--([a-z0-9-]+)/g)) read.add(m[1] ?? '');
    }
    const unread = [...declared].filter((n) => !read.has(n) && !SCALE_OR_PINNED.includes(n)).sort();
    expect(unread).toEqual([]);
  });
});

describe('tokens.css holds the only colour literals', () => {
  // Its header: "This is the ONLY file in the client allowed to hold colour literals". Comments are
  // stripped first (they name colours in prose), and mask declarations are skipped (a mask reads
  // only alpha, so #000 there is not a colour anyone sees). The dev inspector is a dev-only overlay;
  // the scenario director's stage (src/director/director.css) reads tokens like every window.
  const COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(|(?<![-\w.])(?:white|black)(?![-\w])/gi;
  const cssFiles = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? cssFiles(p) : f.endsWith('.css') ? [p] : [];
  });
  it('no other stylesheet writes a colour by value', () => {
    const over: string[] = [];
    for (const f of cssFiles(root('src'))) {
      const rel = f.slice(root('.').length + 1).split('\\').join('/');
      if (rel === 'src/design/tokens.css' || rel.startsWith('src/lib/dev/')) continue;
      const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?:-webkit-)?mask[a-z-]*\s*:[^;}]*/g, '');
      const n = text.match(COLOUR)?.length ?? 0;
      if (n > 0) over.push(`${rel}: ${n}`);
    }
    expect(over).toEqual([]);
  });
});

describe('type and targets', () => {
  it('body is 14px and nothing a person reads is under 12px', () => {
    expect(decl('fs-body')).toBe('14px');
    expect(decl('fs-small')).toBe('12px');
    for (const n of ['fs-mono', 'fs-title3', 'fs-title2', 'fs-title1', 'fs-display']) expect(parseFloat(decl(n) ?? '0'), n).toBeGreaterThanOrEqual(12);
  });
  it('controls are at least the 24px target', () => {
    for (const n of ['ctl', 'ctl-sm', 'target', 'row']) expect(parseFloat(decl(n) ?? '0'), n).toBeGreaterThanOrEqual(24);
  });
  it('the story kit’s text buttons outside a sentence reach the 24px target (WCAG 2.5.8)', () => {
    const ui = readFileSync(root('src/design/ui.css'), 'utf8');
    for (const sel of ['.ui-decision .dc-more', '.ui-checks .cs-all']) {
      const rule = new RegExp(`${sel.replace(/\./g, '\\.')} \\{([^}]*)\\}`).exec(ui)?.[1] ?? '';
      expect(rule, sel).toMatch(/min-height: var\(--target\)/);
    }
  });
});

describe('Calibre surfaces and fills meet WCAG AA in both themes', () => {
  const SHEETS = ['sheet', 'sheet-hi', 'sheet-lo', 'tab-on', 'tab-mix', 'toolbar', 'disc', 'well', 'quar'];
  const INKS = ['text', 'muted', 'dim', 'teal-l', 'coral-l', 'gold-l', 'red-l', 'ok'];
  for (const [name, t] of [['dark', dark], ['light', light]] as const) {
    it(`${name}: every text ink on every sheet surface is at least 4.5:1`, () => {
      const low: string[] = [];
      for (const ink of INKS) for (const s of SHEETS) {
        const r = contrast(rgb(t, ink), rgb(t, s));
        if (r < 4.5) low.push(`--${ink} on --${s}: ${r.toFixed(2)}`);
      }
      expect(low).toEqual([]);
    });
    it(`${name}: labels on filled controls are at least 4.5:1`, () => {
      for (const [ink, fill] of [['on-gold', 'gold'], ['on-gold', 'gold-d'], ['on-teal', 'teal'], ['on-refuse', 'refuse'], ['on-ok', 'ok'], ['on-replay', 'replay']] as const) {
        expect(contrast(rgb(t, ink), rgb(t, fill)), `${ink} on ${fill}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

describe('focus is one colour, and it can be seen', () => {
  const ui = readFileSync(root('src/design/ui.css'), 'utf8');
  it('a focused field paints only in --focus (border and halo), like every other focus ring', () => {
    const rule = /\.ui-field:focus \{([^}]*)\}/.exec(ui)?.[1] ?? '';
    expect(rule).toMatch(/border-color: var\(--focus\)/);
    const painted = [...rule.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]);
    expect(painted.length).toBeGreaterThan(1);
    expect(painted.filter((t) => t !== 'focus')).toEqual([]);
  });
  // WCAG 2.2 1.4.11 / 2.4.13: a focus ring is a non-text indicator, 3:1 against what it sits on.
  for (const [name, t, focus] of [['dark', dark, 'gold-l'], ['light', light, 'pp-blue']] as const) {
    it(`${name}: the focus ring (--${focus}) is at least 3:1 on every surface and sheet`, () => {
      const low: string[] = [];
      for (const s of ['bg', 'bg2', 'panel', 'panel2', 'panel3', 'sheet', 'sheet-hi', 'sheet-lo', 'tab-on', 'tab-mix', 'toolbar', 'disc', 'well']) {
        const r = contrast(rgb(t, focus), rgb(t, s));
        if (r < 3) low.push(`--${focus} on --${s}: ${r.toFixed(2)}`);
      }
      expect(low).toEqual([]);
    });
  }
});

describe('motion: CSS and code agree', () => {
  it('the hold is 1200 ms in both', () => {
    expect(HOLD_MS).toBe(1200);
    expect(decl('hold-ms')).toBe(`${HOLD_MS}ms`);
  });
  it('every named duration matches', () => {
    for (const [k, v] of Object.entries(DUR)) expect(decl(`dur-${k}`), k).toBe(`${v}ms`);
  });
});

describe('bundled fonts', () => {
  const dir = root('src/assets/fonts');
  const fonts = readFileSync(root('src/design/fonts.css'), 'utf8');
  it('ships each family with its OFL licence', () => {
    for (const fam of ['archivo', 'sofia-sans']) {
      const lic = join(dir, fam, 'OFL.txt');
      expect(existsSync(lic), fam).toBe(true);
      expect(readFileSync(lic, 'utf8')).toContain('SIL Open Font License, Version 1.1');
    }
  });
  it('every @font-face file exists, swaps, and is local (no network at runtime)', () => {
    const urls = [...fonts.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1] ?? '');
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u.startsWith('../assets/fonts/'), u).toBe(true);
      expect(existsSync(root(join('src/design', u))), u).toBe(true);
    }
    expect(fonts).not.toMatch(/https?:/);
    const faces = fonts.match(/@font-face \{/g)?.length ?? 0;
    expect(fonts.match(/font-display: swap;/g)?.length).toBe(faces);
  });
  it('adds less than 600 KB', () => {
    let total = 0;
    for (const fam of readdirSync(dir)) for (const f of readdirSync(join(dir, fam))) if (f.endsWith('.woff2')) total += statSync(join(dir, fam, f)).size;
    expect(total).toBeLessThan(600 * 1024);
  });
  it('the type tokens name the bundled faces first, with system fallbacks', () => {
    expect(decl('font')).toMatch(/^"Archivo", .*sans-serif$/);
    expect(decl('num')).toMatch(/^"Sofia Sans", .*sans-serif$/);
  });
});

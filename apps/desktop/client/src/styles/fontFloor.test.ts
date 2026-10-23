// U4 (static half): "At 1280 x 800, no UI text is under 12 px." jsdom has no layout, so this cannot
// measure a rendered screen; it reads every stylesheet and every inline font size in the client and
// resolves each font-size (and the size in a `font:` shorthand) to px: var(--fs-*) through the token
// file, rem against the root size the client sets (html { font-size: var(--fs-body) } = 14px, the
// Tumbler's 13px), vw against 1280 (the Tumbler's own window is 440 wide), and min/max/clamp by their
// lower bound. A size that depends on its parent (em, %) or its container (cq*) is counted, not judged.
// The known sub-12px sizes are pinned in KNOWN_UNDER_FLOOR: a new one fails here, and so does one that
// has been fixed and not removed from the list. STATUS.md acceptance U4 lists them.
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest stubs imported CSS to an empty string, so the sources are read from disk.
const SRC = join(process.cwd(), 'src');
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}
const files = walk(SRC).map((f) => f.replaceAll(sep, '/'));
const read = (ext: RegExp, skip?: RegExp) => Object.fromEntries(files.filter((f) => ext.test(f) && !skip?.test(f)).map((f) => [f.slice(f.lastIndexOf('/src/')), readFileSync(f, 'utf8')]));
const css = read(/\.css$/);
const code = read(/\.tsx?$/, /\.test\./);

const FLOOR = 12;
type Ctx = { root: number; vw: number; vars: Record<string, string> };

/** Rules and their declarations, comments removed; an at-rule's inner rules are read as plain rules. */
function rules(src: string): { selector: string; decls: [string, string][] }[] {
  const text = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { selector: string; decls: [string, string][] }[] = [];
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls: [string, string][] = [];
    for (const d of m[2]!.split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decls.push([d.slice(0, i).trim(), d.slice(i + 1).trim()]);
    }
    out.push({ selector: m[1]!.split(';').pop()!.trim().replace(/\s+/g, ' '), decls });
  }
  return out;
}

/** Splits at top-level commas. */
function args(s: string): string[] {
  const out: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) { out.push(s.slice(from, i)); from = i + 1; }
  }
  out.push(s.slice(from));
  return out.map((a) => a.trim());
}

/** A lower bound in px, or null when the size depends on a parent or a container. */
function px(expr: string, c: Ctx): number | null {
  const s = expr.trim();
  const v = /^var\((--[\w-]+)(?:,(.*))?\)$/s.exec(s);
  if (v) { const next = c.vars[v[1]!] ?? v[2]; return next === undefined ? null : px(next, c); }
  const f = /^(clamp|min|max)\((.*)\)$/s.exec(s);
  if (f) {
    const a = args(f[2]!).map((x) => px(x, c));
    if (f[1] === 'max') { const known = a.filter((x): x is number => x !== null); return known.length ? Math.max(...known) : null; }
    if (f[1] === 'clamp') return a[0] ?? null;
    return a.every((x) => x !== null) ? Math.min(...(a as number[])) : null;
  }
  const n = /^(-?[\d.]+)(px|rem|vw)$/.exec(s);
  if (!n) return null;
  const k = Number(n[1]);
  return n[2] === 'px' ? k : n[2] === 'rem' ? k * c.root : (k * c.vw) / 100;
}

/** The size in a `font:` shorthand: the first --fs-* token or length before an optional /line-height. */
function shorthandSize(v: string): string | null {
  return /(var\(--fs-[\w-]+\)|-?[\d.]+(?:px|rem|em))(?=\s*\/|\s|$)/.exec(v)?.[1] ?? null;
}

const tokenFile = Object.entries(css).find(([f]) => f.endsWith('/design/tokens.css'))![1];
const tokens = (re: RegExp) => {
  const vars: Record<string, string> = {};
  for (const r of rules(tokenFile)) if (re.test(r.selector)) for (const [p, v] of r.decls) if (p.startsWith('--')) vars[p] = v;
  return vars;
};
const base = tokens(/^:root$/);
const tumblerVars = { ...base, ...tokens(/^:root:has\(> body\.w-tumbler\)$/) };
const ctxFor = (file: string): Ctx => {
  const vars = file.includes('/windows/tumbler/') ? tumblerVars : base;
  return { root: px(vars['--fs-body']!, { root: 0, vw: 0, vars }) ?? 14, vw: file.includes('/windows/tumbler/') ? 4.4 : 12.8, vars };
};

type Hit = { key: string; px: number | null };
const hits: Hit[] = [];
for (const [file, src] of Object.entries(css)) {
  const c = ctxFor(file);
  for (const r of rules(src)) for (const [p, v] of r.decls) {
    const size = p === 'font-size' ? v : p === 'font' ? shorthandSize(v) : null;
    if (size && size !== 'inherit') hits.push({ key: `${file.replace('/src/', '')} | ${r.selector} | ${p}: ${size}`, px: px(size, c) });
  }
}
const under = hits.filter((h) => h.px !== null && h.px < FLOOR);
const relative = hits.filter((h) => h.px === null);

/** Sub-12px sizes in the stylesheets today (recorded, not fixed by this test). Five are single
 *  numerals or marks inside a small aria-hidden badge (a step number, a review mark), one is the
 *  mini-window legend's numeral drawn in an SVG, and two are SVG text in the brand seal, whose size is
 *  in the drawing's own units (the seal is scaled by its box, so its on-screen size is not 1.85px). */
const KNOWN_UNDER_FLOOR: string[] = [
  'shared/brand/brand.css | .br-seal text | font-size: 1.85px = 1.85px',
  'shared/brand/brand.css | .br-seal text.deg | font-size: 1.9px = 1.9px',
  'windows/approval/approval.css | .dr-hint > .dr-mark | font-size: 9px = 9px',
  'windows/approval/approval.css | .dr-mark | font: 10px = 10px',
  'windows/approval/approval.css | .nx-n | font: 11px = 11px',
  'windows/tumbler/tumbler.css | .fr-n | font: 10px = 10px',
  'windows/tumbler/tumbler.css | .mini .m-n | font: 9px = 9px',
];

describe('U4: no UI text under 12 px (static check; the 1280 x 800 inspection on the native shell is still pending)', () => {
  it('reads a useful number of font sizes', () => {
    expect(Object.keys(css).length).toBeGreaterThan(30);
    expect(hits.length).toBeGreaterThan(300);
    expect(hits.length - relative.length).toBeGreaterThan(300);
  });

  it('the type scale itself keeps the floor: every --fs-* token except the unused micro token is 12px or more', () => {
    for (const vars of [base, tumblerVars]) {
      for (const [name, v] of Object.entries(vars)) {
        if (!name.startsWith('--fs-') || name === '--fs-micro') continue;
        expect(px(v, { root: 14, vw: 12.8, vars }), name).toBeGreaterThanOrEqual(FLOOR);
      }
    }
  });

  it('the microprint token is declared but used by no font-size', () => {
    expect(hits.filter((h) => h.key.includes('--fs-micro'))).toEqual([]);
  });

  it('every font-size in the stylesheets resolves to 12px or more, but the known ones', () => {
    expect(under.map((h) => `${h.key} = ${h.px}px`).sort()).toEqual([...KNOWN_UNDER_FLOOR].sort());
  });

  it('no component sets a font size inline', () => {
    const inline = Object.entries(code).flatMap(([f, s]) => [...s.matchAll(/font-?[sS]ize\s*[:=]\s*\{?\s*['"`]?([^,;}'"`)]*)/g)].map((m) => `${f}: ${m[0]}`));
    expect(inline).toEqual([]);
  });

  it('sizes that depend on a parent or a container are few (they are not judged here)', () => {
    expect(relative.length).toBeLessThan(40);
  });
});

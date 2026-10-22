// The Tumbler's controls are at least the 24 px target floor (WCAG 2.5.8; tokens.css --target).
// A census over tumbler.css and the Tumbler token block: every rule that sizes a control (a button,
// a step link, a pager arrow, the row that holds them) to under 24 px is listed. The other half of
// the card, that no row overflows its fixed form (440 x 152 / 228, puck top and bottom), needs layout
// and is a browser check on the preview at each FORM_SIZE; jsdom cannot measure it.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const FLOOR = 24;
/** Selectors that size something a pointer lands on, or the track that holds those. */
const TARGET = /\.ui-btn|\.fr-step\b|\.fr-steps|\.c-acts|\.t-ico|\.t-info|\.arr\b|\.chipbtn|\.nav\b/;
const SIZE = /(?:^|[;\s])(width|height|min-width|min-height|grid-auto-rows)\s*:\s*([^;]+)/g;

/** The Tumbler's own `--ctl-sm` / `--ctl` / `--row` ... as the cascade gives them (root, then the Tumbler block). */
export function tumblerTokens(tokens: string): Record<string, number> {
  const css = strip(tokens);
  const out: Record<string, number> = {};
  const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const tum = /:root:has\(>\s*body\.w-tumbler\)\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  for (const block of [root, tum]) for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*(\d+(?:\.\d+)?)px/g)) out[m[1] ?? ''] = Number(m[2]);
  return out;
}

/** Every target-sizing declaration under 24 px, as "selector { prop: value }". */
export function smallTargets(sheet: string, tokens: Record<string, number>): string[] {
  const found: string[] = [];
  for (const m of strip(sheet).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? '').trim();
    if (!TARGET.test(sel) || / svg/.test(sel)) continue; // a glyph inside a control is not the target
    for (const d of (m[2] ?? '').matchAll(SIZE)) {
      const v = (d[2] ?? '').trim();
      const px = /^(\d+(?:\.\d+)?)px$/.exec(v)?.[1] ?? (/^var\(--([a-z0-9-]+)\)$/.exec(v)?.[1] ? tokens[/^var\(--([a-z0-9-]+)\)$/.exec(v)?.[1] ?? ''] : undefined);
      if (px !== undefined && Number(px) < FLOOR) found.push(`${sel} { ${d[1]}: ${v} }`);
    }
  }
  return found;
}

describe('Tumbler target census', () => {
  it('the census sees a 20 px step link and a token under the floor (seeded)', () => {
    expect(smallTargets('.fr-step { width: 100%; height: 20px; }', {})).toEqual(['.fr-step { height: 20px }']);
    expect(smallTargets('.ui-btn.t-info { width: var(--ctl-sm); }', { 'ctl-sm': 22 })).toEqual(['.ui-btn.t-info { width: var(--ctl-sm) }']);
    expect(smallTargets('.ui-btn.t-info { width: var(--ctl-sm); }', { 'ctl-sm': 24 })).toEqual([]);
  });

  it('the Tumbler token block keeps every control size at the floor', () => {
    const t = tumblerTokens(read('src/design/tokens.css'));
    expect(['ctl', 'ctl-sm', 'target'].filter((k) => (t[k] ?? 0) < FLOOR)).toEqual([]);
  });

  it('no control, step link, pager arrow or holder row in tumbler.css is sized under 24 px', () => {
    const t = tumblerTokens(read('src/design/tokens.css'));
    expect(smallTargets(read('src/windows/tumbler/tumbler.css'), t)).toEqual([]);
  });
});

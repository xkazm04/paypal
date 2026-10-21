// legacy.css is frozen: "delete a rule here once nothing uses it". This holds it to that: every class
// a legacy selector names must still be drawn by something in the main window (src/windows/main or
// src/shared, tests aside). A class counts as drawn when it appears as a word inside a quoted string
// on a line that sets a class (className=, class=, cx(...)), so a dynamic class (`le${x ? ' stack' :
// ''}`) still counts; a rule nothing draws fails here and is deleted, not kept "just in case".
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

/** Every word inside a quoted string on a line that sets a class. */
function drawnClasses(): Set<string> {
  const out = new Set<string>();
  for (const f of [...files(join(SRC, 'windows', 'main')), ...files(join(SRC, 'shared'))]) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (!/className=|class=|\bcx\(/.test(line)) continue;
      for (const m of line.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)) {
        for (const w of (m[1] ?? m[2] ?? m[3] ?? '').split(/[^A-Za-z0-9_-]+/)) if (w) out.add(w);
      }
    }
  }
  return out;
}

/** Each selector of legacy.css (comments and keyframe steps aside) with the classes it names. */
function legacySelectors(): { sel: string; classes: string[] }[] {
  const css = readFileSync(join(__dirname, 'legacy.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { sel: string; classes: string[] }[] = [];
  for (const rule of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const raw of (rule[1] ?? '').split(',')) {
      const sel = raw.trim();
      if (!sel || /^(from|to|\d+%)$/.test(sel)) continue;
      out.push({ sel, classes: [...sel.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((x) => x[1] ?? '') });
    }
  }
  return out;
}

describe('legacy.css', () => {
  it('reads its selectors (the instrument sees the file)', () => {
    const sels = legacySelectors();
    expect(sels.length).toBeGreaterThan(5);
    expect(sels.some((s) => s.sel === '.lockg')).toBe(true);
  });

  it('keeps only rules whose classes the main window still draws', () => {
    const drawn = drawnClasses();
    expect(drawn.has('lockg'), 'the scan sees ui.tsx').toBe(true);
    const dead = legacySelectors().filter((s) => s.classes.some((c) => !drawn.has(c))).map((s) => s.sel);
    expect(dead, 'legacy selectors nothing draws: delete them').toEqual([]);
  });
});

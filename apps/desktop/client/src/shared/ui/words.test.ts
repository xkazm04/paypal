// shared/ui keeps no English of its own: every label, default and accessible name arrives from
// lib/words (UI_WORDS in words/framework.ts) or from the caller. This reads each primitive's source
// (comments stripped) and counts the text a person would read: JSX text, and string literals given to
// a label / title / aria-label / placeholder / alt slot or used as a default (`?? '…'`, `= '…'`).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const WORDY = /[A-Za-z]{2,}/;
const SLOT = String.raw`(?:aria-label|aria-description|title|label|detailsLabel|placeholder|alt|empty|what)`;
const LIT = String.raw`(?:'([^'\n]*)'|"([^"\n]*)"|\x60([^\x60\n]*)\x60)`;

/** The visible-English literals in one source file. */
export function inlineEnglish(source: string): string[] {
  const src = stripComments(source);
  const found: string[] = [];
  const keep = (t: string | undefined): void => {
    if (t === undefined || /\n/.test(t) || /^var\(/.test(t) || /^[a-z][a-z0-9-]*$/.test(t)) return; // a css var, class or enum word is not copy
    if (WORDY.test(t.replace(/\$\{[^}]*\}/g, ''))) found.push(t);
  };
  // a literal in a text slot: label="…", title={'…'}, label = '…', label: '…'
  for (const m of src.matchAll(new RegExp(String.raw`\b${SLOT}\s*(?:=\s*\{?|:)\s*${LIT}`, 'g'))) keep(m[1] ?? m[2] ?? m[3]);
  // a literal default: `x ?? '…'`, `x || '…'`
  for (const m of src.matchAll(new RegExp(String.raw`(?:\?\?|\|\|)\s*${LIT}`, 'g'))) keep(m[1] ?? m[2] ?? m[3]);
  // either arm of a ternary: `all ? 'Hide passed' : 'Show all'`
  for (const m of src.matchAll(new RegExp(String.raw`\?\s*${LIT}\s*:\s*${LIT}`, 'g'))) { keep(m[1] ?? m[2] ?? m[3]); keep(m[4] ?? m[5] ?? m[6]); }
  // a record of words: `{ pass: 'passed', … }` typed Record<…, string>
  for (const m of src.matchAll(/Record<[^>]*,\s*string>\s*=\s*\{([^}]*)\}/g)) {
    for (const v of (m[1] ?? '').matchAll(/:\s*'([^']*)'/g)) keep(v[1]);
  }
  // JSX text between a tag and the next tag or expression: >Close</b>, >{x} not checked here: <
  for (const m of src.matchAll(/(?<![=\-<])>([^<>{}=;()?&|]*)(?=[<{])/g)) keep(m[1]);
  for (const m of src.matchAll(/\}([^<>{}=;()?&|]*)(?=<)/g)) keep(m[1]);
  return found;
}

const dir = __dirname;
const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));

describe('shared/ui words', () => {
  it('the counter sees what it must (a seeded literal per slot)', () => {
    expect(inlineEnglish(`<button aria-label="Close" onClick={x}>Save</button>`)).toEqual(['Close', 'Save']);
    expect(inlineEnglish(`const a = x ?? 'Details'; const t = label = 'Why?';`)).toEqual(['Why?', 'Details']);
    expect(inlineEnglish(`<b>{n} not checked here: </b>`)).toEqual([' not checked here: ']);
    expect(inlineEnglish(`const c = cx('ui-btn plain'); <i className="x">✕</i> // Close`)).toEqual([]);
  });

  it('no non-test shared/ui file carries an inline English string', () => {
    const hits = files.flatMap((f) => inlineEnglish(readFileSync(join(dir, f), 'utf8')).map((t) => `${f}: ${JSON.stringify(t)}`));
    expect(hits).toEqual([]);
  });
});

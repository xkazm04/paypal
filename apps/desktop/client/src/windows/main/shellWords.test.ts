// The main window shell's words guard (UX-GUIDE checklist: strings live in lib/words): these files
// hold no owner-facing sentence of their own, only references into lib/words. A string literal,
// template text or JSX text of two or more words counts, except where it is not copy (an import
// path, a class name, a role or other attribute value). A small scanner, not a parser: it only has
// to tell code from text in files that are plain TSX.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FILES = ['Shortcuts.tsx', 'Status.tsx', 'QuitSheet.tsx', 'paletteCopy.ts', 'console/Find.tsx', 'quit.ts', 'ui.tsx'];
const NOT_COPY = /(?:\b(?:className|role|type|kind|key|id|size|from|import)|\bdata-[\w-]+|\baria-(?:live|haspopup|autocomplete|expanded|controls))\s*=?\s*\{?\s*$/;

const BS = String.fromCharCode(92);
const reads = (t: string): boolean => /[A-Za-z’]{2,}\s+[A-Za-z’]{2,}/.test(t);

/** Every string, template text and JSX text of the source that reads as words. */
export function inlineCopy(src: string): string[] {
  const out: string[] = [];
  const keep = (text: string, before: string): void => { if (reads(text) && !NOT_COPY.test(before)) out.push(text.trim()); };
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i] as string;
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c) j += src[j] === BS ? 2 : 1;
      keep(src.slice(i + 1, j), src.slice(Math.max(0, i - 24), i));
      i = j + 1; continue;
    }
    if (c === '`') {
      let j = i + 1;
      let text = '';
      while (j < n && src[j] !== '`') {
        if (src[j] === '$' && src[j + 1] === '{') {
          keep(text, src.slice(Math.max(0, i - 24), i)); text = '';
          let depth = 1; j += 2;
          while (j < n && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
        } else { text += src[j]; j += src[j] === BS ? 2 : 1; }
      }
      keep(text, src.slice(Math.max(0, i - 24), i));
      i = j + 1; continue;
    }
    if (c === '>' && src[i - 1] !== '=') {
      // JSX text: from a tag's end to the next tag or brace, on the one line.
      let j = i + 1;
      while (j < n && !'<{}>\n;'.includes(src[j] as string)) j++;
      if (src[j] === '<') keep(src.slice(i + 1, j), '');
    }
    i++;
  }
  return out;
}

describe('the shell keeps its copy in lib/words', () => {
  for (const f of FILES) {
    it(`${f} has no inline owner-facing string`, () => {
      expect(inlineCopy(readFileSync(new URL(f, import.meta.url), 'utf8'))).toEqual([]);
    });
  }
  it('the scanner sees words and skips what is not copy', () => {
    expect(inlineCopy(`const a = 'Two words'; const b = <p className="a b c">Hello there</p>; import x from 'a b';`)).toEqual(['Two words', 'Hello there']);
  });
});

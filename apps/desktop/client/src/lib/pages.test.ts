// The window pages' <head>s are hand-written HTML: four copies of one head. The browser paints the
// theme-color before any CSS loads, so it must be the --bg of tokens.css in each theme, and the
// four pages must not drift apart (a favicon or a theme colour fixed in one page only).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const PAGES = ['index.html', 'tumbler.html', 'approval.html', 'director.html'];
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** The --bg of the first block whose selector starts with `selector`. */
function bg(css: string, selector: string): string | undefined {
  const at = css.indexOf(`${selector} {`) >= 0 ? css.indexOf(`${selector} {`) : css.indexOf(`${selector},`);
  const block = css.slice(at, css.indexOf('}', at));
  return /--bg:\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(block)?.[1]?.toLowerCase();
}

/** The head lines every window page shares: charset, viewport, icons, theme colours. */
function sharedHead(html: string): string[] {
  return html.split('\n').map((l) => l.trim()).filter((l) => /^<meta (charset|name="viewport"|name="theme-color")|^<link rel="icon"/.test(l));
}

describe('window pages', () => {
  const tokens = read('src/design/tokens.css');
  const dark = bg(tokens, ':root');
  const light = bg(tokens, ':root[data-theme="light"]');

  it('read both theme backgrounds from tokens.css', () => {
    expect(dark).toMatch(/^#/);
    expect(light).toMatch(/^#/);
  });

  it.each(PAGES)('%s paints the token background as its theme colour in both themes', (page) => {
    const html = read(page);
    const color = (scheme: string) => new RegExp(`<meta name="theme-color" content="(#[0-9a-fA-F]+)" media="\\(prefers-color-scheme: ${scheme}\\)"`).exec(html)?.[1]?.toLowerCase();
    expect(color('dark')).toBe(dark);
    expect(color('light')).toBe(light);
  });

  it('share one head (charset, viewport, icons, theme colours)', () => {
    const [first, ...rest] = PAGES.map((p) => sharedHead(read(p)));
    expect(first?.length).toBe(6);
    for (const h of rest) expect(h).toEqual(first);
  });
});

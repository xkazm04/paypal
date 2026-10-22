// ui.css styles what renders. The explainer, stepper, sidebar and title-bar components were deleted
// (6105919); their rules must not outlive them. The consumer half is a grep over every source file
// (a class built from a prefix would still contain the prefix), so a family only comes back with a
// component that uses it. The screenshot half (no visual change in both themes) needs a browser.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = (p: string) => resolve(process.cwd(), p);
const FAMILIES = ['ui-explainer', 'ui-stepper', 'ui-sidebar', 'ui-sb-', 'ui-titlebar', 'ui-title'];
const sources = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  if (statSync(p).isDirectory()) return sources(p);
  return /\.(tsx?|html)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
});

describe('ui.css carries no rule for a component that is gone', () => {
  const ui = readFileSync(root('src/design/ui.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('no selector of a deleted family', () => {
    const left = FAMILIES.filter((f) => ui.includes(f));
    expect(left).toEqual([]);
  });
  it('no source file builds one of those classes either', () => {
    const files = [...sources(root('src')), root('index.html'), root('approval.html'), root('tumbler.html'), root('director.html')];
    const users = files.filter((f) => { try { const t = readFileSync(f, 'utf8'); return FAMILIES.some((x) => t.includes(x)); } catch { return false; } });
    expect(users.map((f) => f.slice(root('.').length + 1))).toEqual([]);
  });
});

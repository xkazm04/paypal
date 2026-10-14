// A source-level guard: no file of the main window calls a command that releases money or acts with
// the owner's authority (every `release: true` row of the authority table, @bindings/authority). The
// main window's only way to money is approval_open. A release command whose name has an underscore
// may not appear as a string at all; `unlock` is also an approval_open target (the page the approval
// window opens on), so for it only a call is forbidden.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTHORITY } from '@bindings/authority';

const root = join(__dirname, '..');
function sources(dir: string): { path: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [{ path: p, text: readFileSync(p, 'utf8') }] : [];
  });
}

const RELEASE = Object.entries(AUTHORITY).filter(([, a]) => a.release).map(([name]) => name);
const CALL = (name: string) => new RegExp(`(useMutation|useQuery|useCommand|readCommand|invoke)\\s*(<[^>]*>)?\\(\\s*['"\`]${name}['"\`]`);
const LITERAL = (name: string) => new RegExp(`['"\`]${name}['"\`]`);

describe('the main window never names a release command', () => {
  const files = sources(root);
  it('reads the authority table and the sources', () => {
    expect(RELEASE).toEqual(expect.arrayContaining(['deal_countersign', 'deal_capture', 'deal_void', 'shield_release', 'rescue_approve', 'set_credentials', 'mandate_sign', 'pairing_confirm', 'unlock']));
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.path.endsWith(join('console', 'Centre.tsx')))).toBe(true);
  });
  it('no call and no string of one, anywhere under windows/main', () => {
    const found: string[] = [];
    for (const f of files) {
      for (const name of RELEASE) {
        if (CALL(name).test(f.text)) found.push(`${f.path}: calls ${name}`);
        if (name.includes('_') && LITERAL(name).test(f.text)) found.push(`${f.path}: names ${name}`);
      }
    }
    expect(found).toEqual([]);
  });
  it('the decision centre opens the approval window and nothing else', () => {
    const centre = files.find((f) => f.path.endsWith(join('console', 'Centre.tsx')))?.text ?? '';
    const calls = [...centre.matchAll(/useMutation\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect(calls).toEqual(['approval_open']);
  });
});

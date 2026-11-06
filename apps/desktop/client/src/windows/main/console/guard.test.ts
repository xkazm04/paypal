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
  it('the home, the board model and the assistant never name a decision, owner or session command; they call only reads, approval_open and act-tier commands', () => {
    const lib = join(root, '..', '..', 'lib', 'assistant');
    const board = [...sources(join(root, 'home')), ...sources(join(root, 'switchboard')), ...sources(lib)];
    expect(board.some((f) => f.path.endsWith(join('home', 'Home.tsx')))).toBe(true);
    expect(board.some((f) => f.path.endsWith(join('secure', 'SecureStep.tsx')))).toBe(true);
    expect(board.some((f) => f.path.endsWith(join('switchboard', 'resolve.ts')))).toBe(true);
    expect(board.some((f) => f.path.endsWith(join('assistant', 'vocabulary.ts')))).toBe(true);
    const high = Object.entries(AUTHORITY).filter(([, a]) => a.tier === 'decision' || a.tier === 'owner' || a.tier === 'session').map(([name]) => name);
    expect(high).toEqual(expect.arrayContaining(['deal_capture', 'mandate_sign', 'approval_token', 'unlock']));
    const found: string[] = [];
    for (const f of board) {
      for (const name of high) {
        if (CALL(name).test(f.text)) found.push(`${f.path}: calls ${name}`);
        // `unlock` is also the approval window's setup target; for it only a call is forbidden.
        if (name.includes('_') && LITERAL(name).test(f.text)) found.push(`${f.path}: names ${name}`);
      }
    }
    expect(found).toEqual([]);
    const called = board.flatMap((f) => [...f.text.matchAll(/(?:useMutation|useCommand|readCommand|invoke)\s*(?:<[^>]*>)?\(\s*['"`]([a-z_]+)['"`]/g)].map((m) => m[1]!));
    for (const name of called) {
      const a = AUTHORITY[name as keyof typeof AUTHORITY];
      expect(a, name).toBeDefined();
      expect(a.release, name).toBe(false);
      expect(['read', 'ui', 'act'], name).toContain(a.tier);
    }
    expect(called).toEqual(expect.arrayContaining(['approval_open', 'assistant_ask', 'assistant_status', 'assistant_act']));
    // the only mutations: the approval window's door, the consent-path safe acts, and the setup guide's
    // own act-tier steps (the agent app, joining the practice shop, waking it)
    const muts = board.flatMap((f) => [...f.text.matchAll(/useMutation\s*(?:<[^>]*>)?\(\s*['"`]([a-z_]+)['"`]/g)].map((m) => m[1]!));
    expect(new Set(muts)).toEqual(new Set(['approval_open', 'assistant_act', 'engine_select', 'pairing_join', 'house_wake']));
  });
  it('the decision centre opens the approval window and nothing else', () => {
    const centre = files.find((f) => f.path.endsWith(join('console', 'Centre.tsx')))?.text ?? '';
    const calls = [...centre.matchAll(/useMutation\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect(calls).toEqual(['approval_open']);
  });
});

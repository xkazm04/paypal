import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The desktop app ships on Windows, whose file system ignores case: `Groups.tsx` and `groups.ts` in one
// folder are one file there, so a checkout keeps only one of them and the build breaks. An extension-less
// import cannot tell them apart either. Guard every source folder.
function collisions(dir: string, out: string[] = []): string[] {
  const seen = new Map<string, string>();
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { collisions(path, out); continue; }
    const m = /^(.*)\.(ts|tsx|js|jsx|mts)$/.exec(name);
    const key = (m?.[1] ?? name).toLowerCase();
    const other = seen.get(key);
    if (other !== undefined) out.push(`${join(dir, other)} <-> ${path}`);
    else seen.set(key, name);
  }
  return out;
}

describe('source file names', () => {
  it('never differ only in case or script extension within a folder (Windows checkouts)', () => {
    expect(collisions(join(__dirname, '..'))).toEqual([]);
  });
});

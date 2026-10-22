// A doc that says "(`SOME_KEY`)" promises a screen reads that key. Five keys were named by live docs
// after the screens that read them went (the Dial legend, the Home "Under way" section) or moved to
// the rescue / settings word groups; the keys went and the docs follow. This pins both halves: the
// keys stay out of lib/words.ts, and the UX guide names no export that does not exist.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as words from './words';

const repo = (p: string) => readFileSync(resolve(process.cwd(), '../../..', p), 'utf8');
const GONE = ['BEAD_UNKNOWN_LEGEND', 'START_UNDERWAY', 'RESCUE_COUNTED', 'RESCUE_SENT_NOT_COUNTED', 'CHARTER_OPEN'];

describe('words keys and the docs that name them', () => {
  it('the five keys no screen reads are not exported', () => {
    expect(GONE.filter((k) => k in words)).toEqual([]);
  });
  it('no live doc names them', () => {
    const named = ['docs/ux/UX-GUIDE.md', 'docs/features/rescue.md', 'docs/build/rebuild/wp3c.md', 'docs/build/DECISIONS.md']
      .flatMap((f) => GONE.filter((k) => repo(f).includes(k)).map((k) => `${f}: ${k}`));
    expect(named).toEqual([]);
  });
  it('every `UPPER_CASE` key the UX guide names exists in lib/words', () => {
    const names = new Set([...repo('docs/ux/UX-GUIDE.md').matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g)].map((m) => m[1] ?? ''));
    const missing = [...names].filter((n) => !(n in words));
    expect(missing).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { buildChain, dedupeChain, isLibraryPath, parseLoc, pickDefaultIndex } from './devLocate';

describe('devLocate', () => {
  it('parses a stamp', () => {
    expect(parseLoc('src/windows/main/App.tsx:88:7')).toEqual({
      path: 'src/windows/main/App.tsx',
      line: 88,
      loc: 'src/windows/main/App.tsx:88',
    });
    expect(parseLoc('nonsense')).toBeNull();
  });

  it('walks the chain and lands on the call site', () => {
    document.body.innerHTML =
      '<div data-loc="src/windows/main/Home.tsx:10:3"><button data-loc="src/shared/ui/Btn.tsx:5:1"><span data-loc="src/shared/ui/Btn.tsx:6:2" id="t"></span></button></div>';
    const chain = buildChain(document.getElementById('t'));
    expect(chain.map((c) => c.loc)).toEqual([
      'src/shared/ui/Btn.tsx:6',
      'src/shared/ui/Btn.tsx:5',
      'src/windows/main/Home.tsx:10',
    ]);
    expect(pickDefaultIndex(chain)).toBe(2);
    expect(dedupeChain(chain)).toHaveLength(3);
    expect(isLibraryPath('src/lib/x.ts')).toBe(true);
  });
});

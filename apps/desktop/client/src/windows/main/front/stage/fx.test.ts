// STAGE round 3: the framer-motion curves are a copy of tokens.css until design/motion.ts exports them.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DUR } from '../../../../design/motion';
import { direction, EASE, tr } from './fx';

const css = readFileSync(resolve(__dirname, '../../../../design/tokens.css'), 'utf8');
const curve = (name: string): number[] => {
  const m = new RegExp(`--${name}:\\s*cubic-bezier\\(([^)]*)\\)`).exec(css);
  return (m?.[1] ?? '').split(',').map((x) => Number(x.trim()));
};

describe('stage fx', () => {
  it('the easings equal --ease / --ease-out / --ease-in in tokens.css', () => {
    expect([...EASE.settle]).toEqual(curve('ease'));
    expect([...EASE.out]).toEqual(curve('ease-out'));
    expect([...EASE.in]).toEqual(curve('ease-in'));
  });

  it('a transition takes its duration from DUR, and calm is instant', () => {
    expect(tr('med', false)).toEqual({ duration: DUR.med / 1000, ease: [...EASE.settle] });
    expect(tr('fast', true)).toEqual({ duration: 0 });
  });

  it('direction follows the order; unknown or same is none', () => {
    expect(direction(0, 3)).toBe(1);
    expect(direction(3, 1)).toBe(-1);
    expect(direction(-1, 2)).toBe(0);
    expect(direction(2, 2)).toBe(0);
  });
});

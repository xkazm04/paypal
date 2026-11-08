import { describe, expect, it } from 'vitest';
import { DUR, EASE } from '../../../design/motion';
import { direction, tr } from './fx';

describe('home fx', () => {
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

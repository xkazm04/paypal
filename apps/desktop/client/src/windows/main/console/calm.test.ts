// Calm motion: the footer's switch sets the calm class (design/motion.ts) and is remembered per viewer.
import { afterEach, describe, expect, it } from 'vitest';
import { isCalm } from '../../../design/motion';
import { CALM_KEY, calmToggled, initCalm, readCalm, writeCalm } from './calm';

afterEach(() => { writeCalm(false); localStorage.clear(); });

describe('calm motion', () => {
  it('turns on, is remembered under table-calm, and comes back on the next start', () => {
    expect(readCalm()).toBe(false);
    writeCalm(true);
    expect(localStorage.getItem(CALM_KEY)).toBe('1');
    expect(calmToggled()).toBe(true);
    expect(isCalm()).toBe(true);
    document.documentElement.classList.remove('calm');
    initCalm();
    expect(calmToggled()).toBe(true);
    writeCalm(false);
    expect(localStorage.getItem(CALM_KEY)).toBeNull();
    expect(calmToggled()).toBe(false);
  });
  it('a blocked storage only lasts the session', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(readCalm(blocked)).toBe(false);
    expect(() => writeCalm(true, blocked)).not.toThrow();
    expect(calmToggled()).toBe(true);
  });
});

// A purchase's path (asked, rules, hold, paid or released). The one rule that matters: a hold never
// reads as paid, and a purchase with no hold on record does not claim one.
import { describe, expect, it } from 'vitest';
import { SPEND } from '../../../../../lib/words';
import { pathSteps } from './Purchase';

const textOf = (key: string, s: ReturnType<typeof pathSteps>) => s.find((x) => x.key === key)?.text;

describe('pathSteps', () => {
  it('a hold is the current step, says not paid, and leaves paying to the owner', () => {
    const s = pathSteps('held', 'pass', { hadHold: true });
    expect(s.find((x) => x.key === 'hold')).toMatchObject({ text: SPEND.path.held, state: 'now' });
    expect(s.find((x) => x.key === 'end')).toMatchObject({ text: SPEND.path.you, state: 'next' });
    expect(s.some((x) => x.state === 'paid')).toBe(false);
  });

  it('only a paid purchase has a paid step', () => {
    for (const kind of ['held', 'waiting', 'refused', 'voided', 'other'] as const) {
      expect(pathSteps(kind, 'pass', { hadHold: true }).filter((x) => x.state === 'paid')).toEqual([]);
    }
    expect(pathSteps('paid', 'pass', { hadHold: true }).at(-1)).toMatchObject({ text: SPEND.path.paid, state: 'paid' });
  });

  it('a payment being checked with PayPal is not called a hold', () => {
    const s = pathSteps('held', 'pass', { checking: true, hadHold: true });
    expect(textOf('hold', s)).toBe(SPEND.checking);
    expect(s.map((x) => x.text)).not.toContain(SPEND.path.held);
  });

  it('a refused purchase never reached PayPal, and no hold is claimed without one on record', () => {
    const r = pathSteps('refused', 'fail');
    expect(textOf('rules', r)).toBe(SPEND.path.rulesNo);
    expect(textOf('hold', r)).toBe(SPEND.path.neverAsked);
    expect(pathSteps('paid', 'pass', { hadHold: false }).map((x) => x.key)).toEqual(['asked', 'rules', 'end']);
  });

  it('rules it could not place are not said to have passed', () => {
    expect(textOf('rules', pathSteps('held', 'unknown'))).toBe(SPEND.path.rulesOther);
  });
});

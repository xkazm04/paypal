// The scale harness's settle(): a read that starts just after the first quiet window still counts.
// (One 120 ms window returned before a late answer reached React; two quiet windows in a row, as
// windows/main/world.test.tsx quiet(), do not.)
import { describe, expect, it } from 'vitest';
import { readBudget, resetReadBudget } from '../../../../lib/data/invoke';
import { settle } from './scaleSmoke';

describe('settle', () => {
  it('waits through a read that starts after the first quiet window', async () => {
    resetReadBudget();
    setTimeout(() => {
      readBudget.total += 1;
      readBudget.inFlight += 1;
      setTimeout(() => { readBudget.inFlight -= 1; }, 10);
    }, 150);
    await settle();
    expect(readBudget.total).toBe(1);
    expect(readBudget.inFlight).toBeLessThanOrEqual(0);
  });

  it('returns after two quiet windows when nothing reads', async () => {
    resetReadBudget();
    await settle();
    expect(readBudget.total).toBe(0);
  });
});

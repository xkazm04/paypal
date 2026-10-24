// The rules one purchase met (Trace): a purchase the wallet cleared that waits for the owner reads as
// passed, and says PayPal has not been asked yet; one that reached PayPal says it passed before.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Clause } from '@bindings/Clause';
import type { Deal } from '@bindings/Deal';
import type { PaypalRefs } from '@bindings/PaypalRefs';
import { SPEND } from '../../../../../lib/words';
import { gateColumns, laneCells } from '../../../modules/spend/gate';
import { Trace } from './Purchase';

afterEach(cleanup);

const usd = (d: number) => ({ minor: d * 100, currency: 'USD' as const });
const CLAUSES: Clause[] = [
  { type: 'roles', roles: ['buy'] },
  { type: 'per_deal', kind: 'purchase', max_amount: usd(200), categories: ['office'] },
  { type: 'velocity', max_deals_day: 12, max_total_day: usd(900) },
  { type: 'human_present_over', amount: usd(250) },
];
const NONE: PaypalRefs = { order: null, authorization: null, capture: null, subscription: null };
const deal = (state: Deal['state'], paypal: PaypalRefs = NONE): Pick<Deal, 'kind' | 'terms' | 'state' | 'paypal'> => ({
  kind: 'purchase', state, paypal, terms: { item_ref: 'x', qty: 1, unit_price: usd(64), currency: 'USD', delivery: { type: 'digital_now' } },
});

describe('the rules a purchase met', () => {
  const cols = gateColumns(CLAUSES);
  it('a cleared purchase that waits for you passed every rule, and PayPal has not been asked', () => {
    const d = deal('AGREED');
    const { container } = render(<Trace cells={laneCells(d, cols)} cols={cols} waiting />);
    expect([...container.querySelectorAll('.sp-trace li')].map((li) => li.className)).toEqual(['pass', 'pass', 'pass', 'pass']);
    expect(container.textContent).toContain(SPEND.allPassedWaiting);
    expect(container.textContent).not.toContain(SPEND.allPassed);
  });
  it('one cleared under an earlier version of the rules is not shown as passed these', () => {
    const d = { ...deal('AGREED'), mandate_version: 2 };
    const { container } = render(<Trace cells={laneCells(d, cols, null, { version: 3 })} cols={cols} waiting />);
    expect([...container.querySelectorAll('.sp-trace li')].map((li) => li.className)).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
    expect(container.textContent).toContain(SPEND.clearedEarlierLine);
    expect(container.textContent).not.toContain(SPEND.allPassedWaiting);
  });
  it('one that reached PayPal says it passed before PayPal was asked', () => {
    const d = deal('CAPTURED', { ...NONE, order: 'O', authorization: 'A', capture: 'C' });
    const { container } = render(<Trace cells={laneCells(d, cols)} cols={cols} />);
    expect(container.textContent).toContain(SPEND.allPassed);
  });
});

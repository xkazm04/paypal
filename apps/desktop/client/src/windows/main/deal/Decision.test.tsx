// The deal page's figures tell an ended money check as it is: PayPal never showed what happened,
// and the wallet is no longer asking. A live deal still says PayPal is being asked.
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../lib/contract';
import { MONEY_CHECK_ENDED, MONEY_CHECK_ENDED_NOW, MONEY_CHECK_NOW } from '../../../lib/words';
import { mockBackend, resetMockState } from '../../../mock/backend';
import { buildMockState } from '../../../mock/fixtures';
import { WorldProvider } from '../world';
import { Summary } from './Decision';
import { mirrorStrip } from './model';

const hoisted = vi.hoisted(() => ({ current: null as Backend | null }));
vi.mock('../../../lib/runtime', () => ({ backend: () => hoisted.current }));

const NOW = 1_800_000_000;
const parked = buildMockState(NOW).deals.find((d) => d.display.label === 'D-0194')!;
const check = parked.evidence.money_check!;

const view = (state: 'EXPIRED' | 'AUTHORIZED') => {
  const deal = { ...parked.deal, state };
  return render(<WorldProvider><Summary deal={deal} strip={mirrorStrip(deal)} deadline={null} check={check} /></WorldProvider>);
};
const moneyRightNow = (c: HTMLElement) => [...c.querySelectorAll('.dv-f')].find((f) => f.querySelector('.k')?.textContent === 'Money right now')?.querySelector('.v')?.textContent;

describe('Summary while a money check is open', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); resetMockState(); hoisted.current = mockBackend('main'); history.replaceState(null, '', '/index.html'); });
  afterEach(() => { cleanup(); hoisted.current = null; });

  it('an expired deal: PayPal never showed, and nothing says it is still being asked', () => {
    const { container } = view('EXPIRED');
    const pill = container.querySelector('.dv-pills .ui-chip');
    expect(pill?.textContent).toBe('Not shown by PayPal');
    expect(pill?.getAttribute('title')).toBe(MONEY_CHECK_ENDED);
    expect(moneyRightNow(container)).toBe(MONEY_CHECK_ENDED_NOW);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/PayPal is being asked/i);
    expect(text).not.toMatch(/Checking with PayPal/i);
    expect(text).not.toMatch(/no money moved/i);
  });

  it('a live deal: Checking with PayPal, and PayPal is being asked', () => {
    const { container } = view('AUTHORIZED');
    const pill = container.querySelector('.dv-pills .ui-chip');
    expect(pill?.textContent).toBe('Checking with PayPal');
    expect(moneyRightNow(container)).toBe(MONEY_CHECK_NOW);
  });
});

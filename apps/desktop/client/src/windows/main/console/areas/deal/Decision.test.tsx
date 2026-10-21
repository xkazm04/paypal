// The deal page's figures tell an ended money check as it is: PayPal never showed what happened,
// and the wallet is no longer asking. A live deal still says PayPal is being asked.
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../../../lib/contract';
import { DEAL_FIGS, MONEY_CHECK_ENDED, MONEY_CHECK_ENDED_NOW, MONEY_CHECK_NOW } from '../../../../../lib/words';
import { mockBackend, resetMockState } from '../../../../../mock/backend';
import { buildMockState } from '../../../../../mock/fixtures';
import { WorldProvider } from '../../../world';
import { StateStrip, Summary } from './Decision';
import { mirrorStrip } from '../../../deal/model';

const hoisted = vi.hoisted(() => ({ current: null as Backend | null }));
vi.mock('../../../../../lib/runtime', () => ({ backend: () => hoisted.current }));

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

describe('the milestones, read aloud', () => {
  afterEach(cleanup);
  const said = (li: Element) => [...li.querySelectorAll('.sr-only')].map((s) => s.textContent).join(' ');

  it('a done milestone and one not reached yet are told apart without the ✓ or the dimming', () => {
    const deal = { ...parked.deal, kind: 'purchase' as const, side: 'buyer' as const, state: 'AUTHORIZED' as const, shield: null };
    const { container } = render(<StateStrip strip={mirrorStrip(deal)} />);
    const items = [...container.querySelectorAll('li.ms')];
    const by = (s: string) => items.filter((li) => li.classList.contains(s));
    expect(by('done').length).toBeGreaterThan(0);
    expect(by('todo').length).toBeGreaterThan(0);
    for (const li of by('done')) expect(said(li)).toBe(DEAL_FIGS.msDone);
    for (const li of by('todo')) expect(said(li)).toBe(DEAL_FIGS.msTodo);
    expect(by('cur')[0]?.getAttribute('aria-current')).toBe('step');
  });

  it('after an early ending, the milestones never reached say they were skipped', () => {
    const deal = { ...parked.deal, kind: 'purchase' as const, side: 'buyer' as const, state: 'VOIDED' as const, shield: null };
    const { container } = render(<StateStrip strip={mirrorStrip(deal)} />);
    const skipped = [...container.querySelectorAll('li.ms.todo')];
    expect(skipped.length).toBeGreaterThan(0);
    for (const li of skipped) expect(said(li)).toBe(DEAL_FIGS.msSkipped);
  });
});

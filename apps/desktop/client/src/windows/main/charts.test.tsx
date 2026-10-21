// The market band's picture is named for a screen reader in the same plain words it shows: where the
// deal's price sits is "a bit above typical", never the percentile behind it ("p63").
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { MarketRef } from '@bindings/MarketRef';
import { marketWords } from '../../lib/words';
import { MarketBand } from './charts';

const usd = (minor: number) => ({ minor, currency: 'USD' as const });
const market = { p25: usd(30_000), median: usd(31_800), p75: usd(33_600), retrieved_at: 0, response_hash: [], cached: false } as unknown as MarketRef;

beforeAll(() => {
  // jsdom lays nothing out: give the band a width so it draws.
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  HTMLElement.prototype.getBoundingClientRect = () => ({ width: 480, height: 74, top: 0, left: 0, right: 480, bottom: 74, x: 0, y: 0, toJSON: () => ({}) });
});
afterEach(cleanup);

describe('MarketBand', () => {
  it.each([29_000, 31_000, 32_900, 35_000])('names a price of %i in the words it shows', (minor) => {
    const { container } = render(<MarketBand market={market} price={usd(minor)} />);
    const svg = container.querySelector('svg[role="img"]');
    expect(svg).not.toBeNull();
    const name = svg!.getAttribute('aria-label') ?? '';
    const words = marketWords(minor, 30_000, 31_800, 33_600).text;
    expect(svg!.textContent).toContain(words);
    expect(name).toContain(words);
    expect(name).not.toMatch(/\bp\d+\b/);
  });
});

// The mock finder answers as Rust's runtime does: display hits, "cheaper" on the identical id only,
// a buyer only, the owner's window only, nothing kept.
import { afterEach, describe, expect, it } from 'vitest';
import { FINDER_WIRE_NO_KEY } from '../lib/words';
import { mockBackend, resetMockState } from './backend';
import { SAMPLE_CATALOGUE, sampleComparables, sampleLookup, sampleSearch } from './finder';

afterEach(() => resetMockState());

describe('the sample finder', () => {
  it('searches by every word, drops blank words and caps at eight', () => {
    expect(sampleSearch('27 inch lg').map((h) => h.id)).toEqual(['lg-27uk850-w']);
    expect(sampleSearch('   ')).toEqual([]);
    expect(sampleSearch('zzzz nothing')).toEqual([]);
    expect(sampleSearch('monitor').length).toBeLessThanOrEqual(8);
    for (const h of sampleSearch('monitor')) {
      expect(Object.keys(h).every((k) => ['id', 'title', 'brand', 'price_minor', 'currency', 'shop'].includes(k))).toBe(true);
    }
  });

  it('reads a pasted https shop link by the product it shows, and nothing else', () => {
    expect(sampleLookup('https://bayside-shop.example/p/dell-p2422h?x=1')?.id).toBe('dell-p2422h');
    expect(sampleLookup('http://bayside-shop.example/p/dell-p2422h')).toBeNull();
    expect(sampleLookup('https://bayside-shop.example/p/unknown-thing')).toBeNull();
  });

  it('names a cheaper shop for the identical product only, for a buyer only', () => {
    const lg = SAMPLE_CATALOGUE.find((s) => s.id === 'lg-27uk850-w')!;
    const best = Math.min(...lg.offers.map((o) => o.minor));
    const a = sampleComparables('lg-27uk850-w', best + 3000, 'buyer');
    expect(a.cheaper.length).toBeGreaterThan(0);
    expect(a.cheaper.every((c) => c.price_minor < best + 3000 && c.saving_minor === best + 3000 - c.price_minor)).toBe(true);
    // Another product that is cheaper is a comparable, never "the same item cheaper".
    expect(a.comparables.some((c) => (c.price_minor ?? Infinity) < best)).toBe(true);
    expect(a.comparables.some((c) => c.id === 'lg-27uk850-w')).toBe(false);
    expect(sampleComparables('lg-27uk850-w', best, 'buyer').cheaper).toEqual([]);
    expect(sampleComparables('lg-27uk850-w', best + 3000, 'seller').cheaper).toEqual([]);
    expect(sampleComparables('not-in-the-catalogue', 99999, 'buyer').cheaper).toEqual([]);
  });
});

describe('the mock backend finder commands', () => {
  it('are the approval window only and need its capability', async () => {
    await expect(mockBackend('main').invoke('market_search', { query: 'monitor' })).rejects.toMatchObject({ code: 'PERMISSION' });
    await expect(mockBackend('approval').invoke('market_search', { query: 'monitor' })).rejects.toMatchObject({ code: 'PERMISSION' });
  });

  it('answer from the sample catalogue and write no audit row', async () => {
    const a = mockBackend('approval');
    const token = await a.invoke('approval_token', null);
    const rows = async () => (await mockBackend('main').invoke('audit_page', { before: null, limit: 200 } as never)).rows.length;
    const before = await rows();
    const hits = await a.invoke('market_search', { query: 'monitor' }, { token });
    expect(hits.length).toBeGreaterThan(0);
    const first = await a.invoke('market_lookup', { url: 'https://corner-store.example/hp-v27i' }, { token });
    expect(first.id).toBe('hp-v27i');
    await expect(a.invoke('market_lookup', { url: 'https://corner-store.example/who-knows' }, { token })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(await rows()).toBe(before);
    expect(FINDER_WIRE_NO_KEY).toMatch(/No market key/);
  });
});

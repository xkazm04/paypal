// Sample answers for the product finder (market_search, market_lookup, market_comparables) in the
// browser preview and the director. Sample data only: the shops are invented, the prices are not a
// market reading. The rules mirror Rust's: hits are display words, a "cheaper" offer is on the
// identical product id only and only for a buyer, and nothing here is kept in the wallet.
import type { CheaperOffer } from '@bindings/CheaperOffer';
import type { Currency } from '@bindings/Currency';
import type { MarketComparablesAnswer } from '@bindings/MarketComparablesAnswer';
import type { ProductHit } from '@bindings/ProductHit';

type Offer = { shop: string; minor: number };
type Sample = { id: string; title: string; brand: string; offers: readonly Offer[]; slug: string };

/** The invented catalogue. The first three are the products the sample rules bind. */
export const SAMPLE_CATALOGUE: readonly Sample[] = [
  { id: 'lg-27uk850-w', slug: 'lg-27uk850', brand: 'LG', title: 'LG 27UK850-W 27-inch 4K IPS monitor', offers: [{ shop: 'northwind-tech.example', minor: 28900 }, { shop: 'bayside-shop.example', minor: 31200 }, { shop: 'corner-store.example', minor: 32900 }] },
  { id: 'dell-p2422h', slug: 'dell-p2422h', brand: 'Dell', title: 'Dell P2422H 24-inch Full HD IPS monitor', offers: [{ shop: 'bayside-shop.example', minor: 17900 }, { shop: 'corner-store.example', minor: 18900 }] },
  { id: 'ergotron-lx-45-241', slug: 'ergotron-lx', brand: 'Ergotron', title: 'Ergotron LX desk monitor arm', offers: [{ shop: 'northwind-tech.example', minor: 13500 }, { shop: 'corner-store.example', minor: 14900 }] },
  { id: 'benq-gw2790q', slug: 'benq-gw2790q', brand: 'BenQ', title: 'BenQ GW2790Q 27-inch 1440p monitor', offers: [{ shop: 'bayside-shop.example', minor: 19900 }] },
  { id: 'hp-v27i', slug: 'hp-v27i', brand: 'HP', title: 'HP V27i 27-inch Full HD monitor', offers: [{ shop: 'corner-store.example', minor: 14900 }, { shop: 'northwind-tech.example', minor: 15500 }] },
  { id: 'samsung-s27c', slug: 'samsung-s27c', brand: 'Samsung', title: 'Samsung S27C 27-inch curved monitor' , offers: [{ shop: 'northwind-tech.example', minor: 22900 }] },
];

const USD: Currency = 'USD';

function lowest(s: Sample): Offer {
  return s.offers.reduce((a, b) => (b.minor < a.minor ? b : a));
}
function hitOf(s: Sample): ProductHit {
  const best = lowest(s);
  return { id: s.id, title: s.title, brand: s.brand, price_minor: best.minor, currency: USD, shop: best.shop };
}

/** Products whose words contain every word asked; none for blank words. At most eight. */
export function sampleSearch(query: string): ProductHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return SAMPLE_CATALOGUE.filter((s) => words.every((w) => `${s.title} ${s.brand} ${s.id}`.toLowerCase().includes(w))).slice(0, 8).map(hitOf);
}

/** The product a shop page shows: the invented shops' pages carry the product's slug. */
export function sampleLookup(url: string): ProductHit | null {
  if (!/^https:\/\/\S+$/.test(url.trim())) return null;
  const u = url.toLowerCase();
  const found = SAMPLE_CATALOGUE.find((s) => u.includes(s.slug));
  return found ? hitOf(found) : null;
}

/** Other products first, then the identical product's cheaper shops, for a buyer only. */
export function sampleComparables(productId: string, unitPriceMinor: number, side: 'buyer' | 'seller'): MarketComparablesAnswer {
  const comparables = SAMPLE_CATALOGUE.filter((s) => s.id !== productId).slice(0, 6).map(hitOf);
  const same = SAMPLE_CATALOGUE.find((s) => s.id === productId);
  const cheaper: CheaperOffer[] =
    side === 'buyer' && same
      ? [...same.offers]
          .filter((o) => o.minor < unitPriceMinor)
          .sort((a, b) => a.minor - b.minor)
          .slice(0, 3)
          .map((o) => ({ shop: o.shop, price_minor: o.minor, currency: USD, saving_minor: unitPriceMinor - o.minor }))
      : [];
  return { comparables, cheaper };
}

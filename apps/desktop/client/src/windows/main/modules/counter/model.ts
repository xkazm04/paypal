// Counter (shop) page logic - pure, no React, no IPC. Tested in model.test.ts.
//
// What the contract gives the Counter today (bindings/, 2026-10-06):
//   - its deals: list_deals filtered to the counter module (kind shop_order, seller side);
//   - floors: a seller floor is the `floor` of a `band` clause in a signed mandate that governs
//     shop_order (mandate_list; the mandate check needs a per_deal clause naming the kind);
//   - market: MarketRef on any deal for the same item_ref.
// What it does not give: the catalog itself (list price, stock, description, feed fields), quotes
// before checkout, and a way to hand a floor draft to the approval window. Those stay unknown here.
import type { Clause } from '@bindings/Clause';
import type { Currency } from '@bindings/Currency';
import type { Deal } from '@bindings/Deal';
import type { DealState } from '@bindings/DealState';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import type { MarketRef } from '@bindings/MarketRef';
import type { Money } from '@bindings/Money';
import { currencyMark, exponent, formatMinor, minorToText, parseMoneyText, shortMoney } from '../../../../lib/format';
import { COUNTER, itemWords } from '../../../../lib/words';
import { isLive, mandatesGoverning } from '../../logic';

// ---- money input ------------------------------------------------------------------------------
// One parser, one input renderer and one short formatter for the whole client: lib/format.ts.
export { currencyMark, minorToText, parseMoneyText };
export const fmtShort = shortMoney;

// ---- the catalog as the contract knows it -------------------------------------------------------

export type FloorSource = { mandateId: string; version: number; clause: number };

export type CatalogRow = {
  itemRef: string;
  /** deal_display title of the newest deal on this item; null when no deal names it. */
  title: string | null;
  currency: Currency;
  /** The signed floor (seller mandate band clause), or null when none is signed. */
  signed: Money | null;
  ceiling: Money | null;
  source: FloorSource | null;
  market: MarketRef | null;
  /** Counter deals on this item, newest first. */
  deals: Deal[];
};

/** Latest version of each mandate that governs shop_order (the seller mandate for the Counter). */
export function sellerMandates(list: readonly MandateListEntry[]): MandateListEntry[] {
  const latest = new Map<string, MandateListEntry>();
  for (const m of mandatesGoverning(list, 'shop_order')) {
    const cur = latest.get(m.payload.id);
    if (!cur || m.payload.version > cur.payload.version) latest.set(m.payload.id, m);
  }
  return [...latest.values()];
}

type BandClause = Extract<Clause, { type: 'band' }>;

const stamp = (d: Deal): number => d.updated_at ?? d.created_at ?? 0;

/** An item's name for the page: the title an order gave it, or else a plain name made from the code
 *  in your shop rules ("dp-cable-2m" → "DP cable 2m"). The code itself stays in Details. */
export const itemName = (row: Pick<CatalogRow, 'title' | 'itemRef'>): string => row.title ?? itemWords(row.itemRef);

/** One row per item the Counter knows: every item a seller-mandate band names, plus every item a
 *  counter deal is for. Market comes from the freshest MarketRef on any deal for that item. */
export function buildCatalog(seller: readonly MandateListEntry[], counterDeals: readonly Deal[], allDeals: readonly Deal[], titleOf: (d: Deal) => string | null): CatalogRow[] {
  const rows = new Map<string, CatalogRow>();
  const row = (itemRef: string, currency: Currency): CatalogRow => {
    let r = rows.get(itemRef);
    if (!r) { r = { itemRef, title: null, currency, signed: null, ceiling: null, source: null, market: null, deals: [] }; rows.set(itemRef, r); }
    return r;
  };
  for (const m of seller) {
    m.payload.clauses.forEach((c, i) => {
      if (c.type !== 'band') return;
      const b: BandClause = c;
      const cur = b.floor?.currency ?? b.ceiling?.currency;
      for (const item of b.item_refs) {
        const r = row(item, cur ?? 'USD');
        if (b.floor && !r.signed) { r.signed = b.floor; r.currency = b.floor.currency; r.source = { mandateId: m.payload.id, version: m.payload.version, clause: i + 1 }; }
        if (b.ceiling && !r.ceiling) r.ceiling = b.ceiling;
      }
    });
  }
  const sorted = [...counterDeals].sort((a, b) => stamp(b) - stamp(a));
  for (const d of sorted) {
    const r = row(d.terms.item_ref, r0Currency(rows.get(d.terms.item_ref), d));
    r.deals.push(d);
    if (r.title === null) r.title = titleOf(d);
  }
  for (const d of allDeals) {
    const r = rows.get(d.terms.item_ref);
    if (!r || !d.market) continue;
    if (!r.market || d.market.retrieved_at > r.market.retrieved_at) r.market = d.market;
  }
  return [...rows.values()].sort((a, b) => (a.title ?? a.itemRef).localeCompare(b.title ?? b.itemRef));
}
const r0Currency = (r: CatalogRow | undefined, d: Deal): Currency => r?.currency ?? d.terms.currency;

// ---- floors vs the market (facts only, no forecast) ---------------------------------------------

export type VsMarket = { cls: 'over' | 'above' | 'at' | 'under' | 'none'; short: string; long: string };

/** Where a floor sits against the market reference. Different currencies are never compared. */
export function vsMarket(floor: Money | null, market: MarketRef | null): VsMarket {
  const W = COUNTER.model;
  if (!floor) return { cls: 'none', ...W.noFloor };
  if (!market || market.median.currency !== floor.currency) return { cls: 'none', ...W.noMarket };
  const c = floor.currency;
  const f = floor.minor;
  if (f > market.p75.minor) {
    const d = fmtShort(f - market.p75.minor, c);
    return { cls: 'over', short: W.aboveUsual.short(d), long: W.aboveUsual.long(d, fmtShort(market.p75.minor, c)) };
  }
  const d = f - market.median.minor;
  const typical = fmtShort(market.median.minor, c);
  if (d === 0) return { cls: 'at', short: W.typical.short, long: W.typical.long(typical) };
  return d > 0
    ? { cls: 'above', short: W.over.short(fmtShort(d, c)), long: W.over.long(fmtShort(d, c), typical) }
    : { cls: 'under', short: W.under.short(fmtShort(-d, c)), long: W.under.long(fmtShort(-d, c), typical) };
}

// ---- the floor draft (a proposed new seller-mandate version; only approval can sign it) ---------

/** itemRef → the text the owner typed. Absent = unchanged from the signed floor. */
export type FloorDraft = Readonly<Record<string, string>>;

export type DraftEntry = { row: CatalogRow; from: Money | null; to: Money };
export type DraftError = { row: CatalogRow; text: string; error: string };

export function floorError(row: Pick<CatalogRow, 'ceiling'>, minor: number | null): string | null {
  if (minor === null) return COUNTER.model.enterAmount;
  if (minor <= 0) return COUNTER.model.aboveZero;
  if (row.ceiling && minor > row.ceiling.minor) return COUNTER.model.aboveCeiling(formatMinor(row.ceiling.minor, row.ceiling.currency));
  return null;
}

/** The changed floors and the ones that do not parse. An entry equal to the signed floor is no change. */
export function draftState(rows: readonly CatalogRow[], draft: FloorDraft): { diff: DraftEntry[]; errors: DraftError[] } {
  const diff: DraftEntry[] = [];
  const errors: DraftError[] = [];
  for (const row of rows) {
    const text = draft[row.itemRef];
    if (text === undefined) continue;
    if (!text.trim() && !row.signed) continue; // cleared a floor that was never signed
    const minor = parseMoneyText(text, row.currency);
    const err = floorError(row, minor);
    if (err || minor === null) { errors.push({ row, text, error: err ?? COUNTER.model.notAmount }); continue; }
    if (row.signed && row.signed.minor === minor) continue;
    diff.push({ row, from: row.signed, to: { minor, currency: row.currency } });
  }
  return { diff, errors };
}

/** The draft value a row shows (the typed text, else the signed floor, else empty). */
export function floorText(row: CatalogRow, draft: FloorDraft): string {
  const t = draft[row.itemRef];
  if (t !== undefined) return t;
  return row.signed ? minorToText(row.signed.minor, row.currency) : '';
}

/** Step the row's floor by `delta` minor units (from the draft, else the signed floor, else 0), never below one unit. */
export function stepFloor(row: CatalogRow, draft: FloorDraft, delta: number): string {
  const cur = parseMoneyText(floorText(row, draft), row.currency) ?? row.signed?.minor ?? 0;
  const unit = 10 ** exponent(row.currency);
  let next = Math.max(unit, cur + delta);
  if (row.ceiling) next = Math.min(next, row.ceiling.minor);
  return minorToText(next, row.currency);
}

/** The draft's floor for a row as Money, when it parses (for the inspector and impact). */
export function draftFloor(row: CatalogRow, draft: FloorDraft): Money | null {
  const minor = parseMoneyText(floorText(row, draft), row.currency);
  return minor === null || minor <= 0 ? null : { minor, currency: row.currency };
}

// ---- what signing the draft would do to deals at the counter ------------------------------------

/** Before an order exists, a quote is still the counter's to withdraw. */
const QUOTE_STAGE: ReadonlySet<DealState> = new Set(['LISTED', 'NEGOTIATING', 'AGREED']);

export type Impact = { deal: Deal; kind: 'withdraw' | 'stays' | 'keeps' };

/** The price a floor binds: the unit price, as clause 4 checks it (never the order total). */
export const unitPrice = (d: Deal): Money => d.terms.unit_price;

/** Live counter deals on a changed item: a quote under the new floor is withdrawn (no money moves);
 *  an order the buyer already holds keeps its terms. Rust decides; this only previews. */
export function draftImpact(diff: readonly DraftEntry[]): Impact[] {
  const out: Impact[] = [];
  for (const e of diff) {
    for (const d of e.row.deals) {
      if (!isLive(d)) continue;
      const t = unitPrice(d);
      if (QUOTE_STAGE.has(d.state)) out.push({ deal: d, kind: t.currency === e.to.currency && t.minor < e.to.minor ? 'withdraw' : 'stays' });
      else out.push({ deal: d, kind: 'keeps' });
    }
  }
  return out;
}

/** True when a live quote on this item sits under the draft floor (signing would withdraw it). */
export function underDraft(d: Deal, row: CatalogRow | undefined, draft: FloorDraft): boolean {
  if (!row || !QUOTE_STAGE.has(d.state) || draft[row.itemRef] === undefined) return false;
  const f = draftFloor(row, draft);
  const t = unitPrice(d);
  return !!f && f.currency === t.currency && t.minor < f.minor;
}

// ---- catalog filters ---------------------------------------------------------------------------

export type CatalogFilter = 'all' | 'live' | 'over' | 'draft';

export function matchesFilter(row: CatalogRow, f: CatalogFilter, draft: FloorDraft): boolean {
  switch (f) {
    case 'all': return true;
    case 'live': return row.deals.some(isLive);
    case 'over': { const c = vsMarket(draftFloor(row, draft), row.market).cls; return c === 'over' || c === 'above'; }
    // The same verdict as the tray's: a change draftState lists, or a price still to fix.
    case 'draft': { const s = draftState([row], draft); return s.diff.length > 0 || s.errors.length > 0; }
  }
}

// ---- the price scale (Layer 2): positions on a shared axis ---------------------------------------

/** Maps amounts (one currency) to 0-100 % on an axis padded a little on both sides. */
export function scaleOf(values: readonly number[]): ((v: number) => number) | null {
  if (!values.length) return null;
  const lo0 = Math.min(...values);
  const hi0 = Math.max(...values);
  const span = Math.max(hi0 - lo0, Math.abs(hi0) * 0.1, 1);
  const lo = lo0 - span * 0.14;
  const hi = hi0 + span * 0.12;
  return (v) => ((v - lo) / (hi - lo)) * 100;
}

// Opening or joining a table from the approval window (TableSheet): which signed rules can carry it
// and the exact deal_join / deal_create arguments. Pure, so the args are pinned by tests. Nothing
// here is authority: Rust re-checks the rules, the counterparty and, for the house, the table it
// kept when the owner confirmed its words, before any deal exists. Neither command calls PayPal.
import type { Category } from '@bindings/Category';
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import type { Currency } from '@bindings/Currency';
import type { DealCreateArgs } from '@bindings/DealCreateArgs';
import type { DealJoinArgs } from '@bindings/DealJoinArgs';
import type { HouseTableDraft } from '@bindings/HouseTableDraft';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import type { Side } from '@bindings/Side';
import { APPROVAL_TABLE } from '../../lib/words';
import { type DecodeFailure, type ListingTable } from './listingCode';
import { isMandateActive } from './model';

type Clauses = MandateListEntry['payload']['clauses'];
const perDealHaggle = (c: Clauses) => c.find((x): x is Extract<Clauses[number], { type: 'per_deal' }> => x.type === 'per_deal' && x.kind === 'haggle');

/** Signed rules in force that let an agent haggle on this side (roles buy / sell, a per-deal haggle limit). */
export function tableMandates(entries: readonly MandateListEntry[], side: Side, now: number): MandateListEntry[] {
  const role = side === 'buyer' ? 'buy' : 'sell';
  return entries.filter((m) => isMandateActive(m, now) && !m.refusal
    && m.payload.clauses.some((c) => c.type === 'roles' && c.roles.includes(role))
    && !!perDealHaggle(m.payload.clauses));
}

/** The categories a set of rules lets an agent haggle in. */
export function tableCategories(m: MandateListEntry): Category[] {
  return perDealHaggle(m.payload.clauses)?.categories ?? [];
}

/** The items a set of rules names in its price band (what a seller can list under it). */
export function tableItems(m: MandateListEntry): string[] {
  return m.payload.clauses.flatMap((c) => (c.type === 'band' ? c.item_refs : []));
}

/** The currency of the rules' per-deal limit. */
export function tableCurrency(m: MandateListEntry): Currency | null {
  return perDealHaggle(m.payload.clauses)?.max_amount.currency ?? null;
}

/** Connected wallets a seller can open a table for: confirmed by four words, not the house. */
export function tableCounterparties(list: readonly CounterpartyDisplay[]): CounterpartyDisplay[] {
  return list.filter((c) => !c.house && c.pairing === 'words_confirmed');
}

/** deal_join for the house's practice table: its own deal id, category and terms, under the
 *  owner's chosen buyer rules. Rust refuses it unless the table is the one it kept at pairing. */
export function houseJoinArgs(table: HouseTableDraft, counterparty: string, m: MandateListEntry): DealJoinArgs {
  return {
    deal_id: table.deal_id,
    create: {
      kind: 'haggle',
      side: 'buyer',
      counterparty,
      mandate_id: m.payload.id,
      mandate_version: m.payload.version,
      terms: table.terms,
      category: table.category,
    },
  };
}

export type ListingDraft = { counterparty: string; mandateId: string; category: Category | ''; item: string; qty: string; price: string };
export type Built<T> = { ok: true; args: T } | { ok: false; problems: string[] };

/** deal_create for a seller's table: the counterparty, the rules, the category and the first price.
 *  Rust signs and queues the listing; this only shapes what the owner typed. */
export function buildListing(d: ListingDraft, rules: readonly MandateListEntry[], parseMoney: (text: string, c: Currency) => number | null): Built<DealCreateArgs> {
  const m = rules.find((x) => x.payload.id === d.mandateId);
  const currency = m ? tableCurrency(m) : null;
  const qty = /^\d+$/.test(d.qty.trim()) ? Number(d.qty.trim()) : NaN;
  const minor = currency ? parseMoney(d.price, currency) : null;
  const problems = [
    !d.counterparty ? APPROVAL_TABLE.needWho : null,
    !m || !currency ? APPROVAL_TABLE.needRules : null,
    m && (!d.category || !tableCategories(m).includes(d.category)) ? APPROVAL_TABLE.needCategory : null,
    m && !tableItems(m).includes(d.item) ? APPROVAL_TABLE.needItem : null,
    !(qty >= 1 && qty <= 1000) ? APPROVAL_TABLE.needQty : null,
    minor === null || minor <= 0 ? APPROVAL_TABLE.needPrice : null,
  ].filter((p) => p !== null);
  if (problems.length || !m || !currency || minor === null || !d.category) return { ok: false, problems };
  return {
    ok: true,
    args: {
      kind: 'haggle',
      side: 'seller',
      counterparty: d.counterparty,
      mandate_id: m.payload.id,
      mandate_version: m.payload.version,
      terms: { item_ref: d.item, qty, unit_price: { minor, currency }, currency, delivery: { type: 'digital_now' } },
      category: d.category,
    },
  };
}

/** deal_join for another owner's table, from a decoded listing code: the seller's own deal id and
 *  terms under the owner's chosen buyer rules. Rust refuses an unpaired seller or a deal id it
 *  already knows, and the seller's signed listing must match these terms before any offer. */
export function codeJoinArgs(table: ListingTable, counterparty: string, m: MandateListEntry): DealJoinArgs {
  return {
    deal_id: table.dealId,
    create: {
      kind: 'haggle',
      side: 'buyer',
      counterparty,
      mandate_id: m.payload.id,
      mandate_version: m.payload.version,
      terms: table.terms,
      category: table.category,
    },
  };
}

/** The plain message for a code the sheet cannot use. */
export function codeProblem(why: DecodeFailure): string {
  return why === 'checksum' ? APPROVAL_TABLE.codeBadSum
    : why === 'version' ? APPROVAL_TABLE.codeBadVersion
    : why === 'unsupported' ? APPROVAL_TABLE.codeBadDelivery
    : APPROVAL_TABLE.codeBadFormat;
}

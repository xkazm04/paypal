// Browser mock of the wallet's exposure fold and wallet limits (Rust: table-core exposure.rs,
// table-app `envelope_check`). Money out only (buyer deals); released deals never count. The mock
// keeps no agreement moments, so a deal counts in the day it last changed (Rust: the day it first
// agreed, in audit order). Sums are integer minor units; currencies are never added together.
import type { Currency } from '@bindings/Currency';
import type { CurrencyExposure } from '@bindings/CurrencyExposure';
import type { Deal } from '@bindings/Deal';
import type { DealState } from '@bindings/DealState';
import type { ExposureView } from '@bindings/ExposureView';
import type { WalletEnvelope } from '@bindings/WalletEnvelope';

export type MockEnvelope = { payload: WalletEnvelope; signedAt: number; forged?: boolean };

const DAY = 86_400;
const RELEASED = new Set<DealState>(['REFUSED', 'WITHDRAWN', 'EXPIRED', 'VOIDED', 'AUTO_VOIDED']);
const AGREED_OR_LATER = new Set<DealState>(['AGREED', 'SETTLING', 'AWAITING_APPROVAL', 'APPROVED', 'AUTHORIZED', 'CAPTURED', 'RECEIPTED', 'RECONCILED', 'REFUNDED', 'DISPUTED', 'UNCONFIRMED']);
const COMMITTED = new Set<DealState>(['AGREED', 'SETTLING', 'AWAITING_APPROVAL', 'APPROVED']);
// UNCONFIRMED counts as spent (Rust paid_state): the money may have left.
const PAID = new Set<DealState>(['CAPTURED', 'RECEIPTED', 'RECONCILED', 'REFUNDED', 'DISPUTED', 'UNCONFIRMED']);

const total = (d: Deal) => d.terms.unit_price.minor * d.terms.qty;
const day = (t: number) => Math.floor(t / DAY);

/** The wallet now, one row per currency with money out, sorted by code (Rust `fold_exposure`). */
export function mockFold(deals: readonly Deal[], now: number, exclude?: string): CurrencyExposure[] {
  const rows = new Map<Currency, CurrencyExposure>();
  for (const d of deals) {
    if (d.side !== 'buyer' || RELEASED.has(d.state) || d.id === exclude) continue;
    const c = d.terms.currency;
    const r = rows.get(c) ?? { currency: c, paid_today: { minor: 0, currency: c }, held: { minor: 0, currency: c }, committed: { minor: 0, currency: c }, out_today: { minor: 0, currency: c }, deals_today: 0 };
    const add = (k: 'paid_today' | 'held' | 'committed' | 'out_today') => { r[k] = { minor: r[k].minor + total(d), currency: c }; };
    if (d.state === 'AUTHORIZED') add('held');
    else if (COMMITTED.has(d.state)) add('committed');
    if (AGREED_OR_LATER.has(d.state) && day(d.updated_at ?? d.created_at ?? now) === day(now)) {
      add('out_today');
      r.deals_today += 1;
      if (PAID.has(d.state)) add('paid_today');
    }
    rows.set(c, r);
  }
  const empty = (r: CurrencyExposure) => !r.held.minor && !r.committed.minor && !r.out_today.minor && !r.deals_today;
  return [...rows.values()].filter((r) => !empty(r)).sort((a, b) => a.currency.localeCompare(b.currency));
}

/** envelope_get as Runtime::envelope_view answers it. */
export function mockExposureView(deals: readonly Deal[], envelope: MockEnvelope | null, now: number): ExposureView {
  const status = !envelope ? 'none' : envelope.forged ? 'unverified' : now >= envelope.payload.expires ? 'expired' : 'active';
  return {
    status,
    limits: envelope && !envelope.forged ? envelope.payload : null,
    signed_at: envelope && !envelope.forged ? envelope.signedAt : null,
    currencies: mockFold(deals, now),
    day_start: day(now) * DAY,
  };
}

/** The wallet limit's verdict on a buyer deal (Rust `WalletEnvelope::check` after the mandate):
 *  null = allowed, else the refusal as the wallet words it. Money in is never limited. */
export function mockEnvelopeRefusal(deals: readonly Deal[], deal: Deal, envelope: MockEnvelope | null, now: number): string | null {
  if (!envelope || deal.side !== 'buyer') return null;
  if (envelope.forged) return 'signature: the wallet limits could not be verified; sign them again';
  const e = envelope.payload;
  if (now >= e.expires) return 'expires: the wallet limits expired; sign new ones';
  if (deal.terms.currency !== e.currency) return `currency: wallet limits cover ${e.currency} only; this deal is in ${deal.terms.currency}`;
  const row = mockFold(deals, now, deal.id).find((r) => r.currency === e.currency);
  const amount = total(deal);
  const outToday = row?.out_today.minor ?? 0;
  const stake = (row?.held.minor ?? 0) + (row?.committed.minor ?? 0);
  if ((row?.deals_today ?? 0) >= e.max_deals_day) return `max_deals_day: ${row?.deals_today ?? 0} deals agreed today of ${e.max_deals_day} allowed`;
  if (outToday + amount > e.max_out_day.minor) return 'max_out_day: over the most your agents can pay out in a day';
  if (stake + amount > e.max_held.minor) return 'max_held: over the most on hold at once';
  return null;
}

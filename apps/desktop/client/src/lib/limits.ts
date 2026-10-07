// The wallet limits' meters (T14), from the wallet's own exposure fold (ExposureView): money out
// today, on hold now and deals today, each against the owner's signed limit. Pure: no React, no
// IPC. Amounts stay integer minor units; a mixed-currency wallet is never added up.
import type { Currency } from '@bindings/Currency';
import type { CurrencyExposure } from '@bindings/CurrencyExposure';
import type { ExposureView } from '@bindings/ExposureView';
import { formatMinor } from './format';
import { LIMITS_EXPIRED, LIMITS_UNVERIFIED, LIMIT_WORDS, NO_WALLET_LIMIT } from './words';

export type LimitKey = 'out' | 'held' | 'deals';
export type LimitMeter = {
  key: LimitKey;
  /** "Paid out today". */
  label: string;
  /** "$24.00" or "2". */
  value: string;
  /** "of $30.00 a day"; null without a limit. */
  of: string | null;
  /** 0..1 against the limit (may pass 1 after the owner tightened); null without a limit. */
  fill: number | null;
  /** At or past 80 % of the limit: the bar turns gold. */
  near: boolean;
  /** One sentence for the tooltip. */
  why: string;
};
export type LimitsReading = {
  status: ExposureView['status'];
  /** The one line under the meters: the limits' state in plain words. */
  line: string;
  /** Money out in more than one currency and no limit to pick one: nothing is added up. */
  mixed: boolean;
  meters: LimitMeter[];
};

/** At or past four fifths of the limit (integer arithmetic, no float rounding). */
export function nearLimit(used: number, limit: number): boolean {
  return limit > 0 && used * 5 >= limit * 4;
}
export function meterFill(used: number, limit: number | null): { fill: number | null; near: boolean } {
  if (limit === null || limit <= 0) return { fill: null, near: false };
  return { fill: used / limit, near: nearLimit(used, limit) };
}

const zero = (currency: Currency): CurrencyExposure => {
  const z = { minor: 0, currency };
  return { currency, paid_today: z, held: z, committed: z, out_today: z, deals_today: 0 };
};

/** The currency row the meters read: the limits' currency when limits exist, else the only
 *  currency with money out. Null when nothing is out yet, or when it is out in several currencies. */
export function meterRow(view: ExposureView): CurrencyExposure | null {
  const cur = view.limits?.currency;
  if (cur) return view.currencies.find((c) => c.currency === cur) ?? zero(cur);
  return view.currencies.length === 1 ? view.currencies[0]! : null;
}

/** "Until 7 Nov" in the viewer's locale-neutral short form. */
const until = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** The meters and their one line, or null while the wallet has not answered. */
export function readLimits(view: ExposureView | null | undefined): LimitsReading | null {
  if (!view) return null;
  const limits = view.status === 'active' ? view.limits ?? null : null;
  const row = meterRow(view);
  const line = view.status === 'expired' ? LIMITS_EXPIRED
    : view.status === 'unverified' ? LIMITS_UNVERIFIED
      : limits ? `Wallet limits you signed, until ${until(limits.expires)}.` : `${NO_WALLET_LIMIT}: only each set of rules limits your agents.`;
  if (!row) {
    return { status: view.status, line, mixed: view.currencies.length > 1, meters: [] };
  }
  const money = (minor: number) => formatMinor(minor, row.currency);
  // A limit is a round number the owner typed: "$1,000", not "$1,000.00" (cents kept when set).
  const whole = (minor: number) => money(minor).replace(/\.0+(?=\s|$)/, '');
  const stake = row.held.minor + row.committed.minor;
  // The wallet's day starts at midnight UTC: said as the owner's own clock time.
  const since = new Date(view.day_start * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const out = meterFill(row.out_today.minor, limits ? limits.max_out_day.minor : null);
  const held = meterFill(stake, limits ? limits.max_held.minor : null);
  const deals = meterFill(row.deals_today, limits ? limits.max_deals_day : null);
  return {
    status: view.status,
    line,
    mixed: false,
    meters: [
      {
        key: 'out', label: LIMIT_WORDS.out.short, value: money(row.out_today.minor),
        of: limits ? `of ${whole(limits.max_out_day.minor)} ${LIMIT_WORDS.out.per}` : null, ...out,
        why: `What your agents agreed to pay since ${since} your time, across every set of rules. ${money(row.paid_today.minor)} of it is already paid.`,
      },
      {
        key: 'held', label: LIMIT_WORDS.held.short, value: money(stake),
        of: limits ? `of ${whole(limits.max_held.minor)} ${LIMIT_WORDS.held.per}` : null, ...held,
        why: `Held at PayPal (${money(row.held.minor)}) or agreed and waiting to be paid (${money(row.committed.minor)}). Not paid yet.`,
      },
      {
        key: 'deals', label: LIMIT_WORDS.deals.short, value: String(row.deals_today),
        of: limits ? `of ${limits.max_deals_day} ${LIMIT_WORDS.deals.per}` : null, ...deals,
        why: `Deals your agents agreed to pay for since ${since} your time, across every set of rules.`,
      },
    ],
  };
}

/** The draft the approval window signs: three plain fields, parsed without floats. */
export type LimitsDraft = { out: string; held: string; deals: string; days: number };
export type LimitsBuilt =
  | { ok: true; args: { currency: Currency; max_out_day: { minor: number; currency: Currency }; max_held: { minor: number; currency: Currency }; max_deals_day: number; expires: number } }
  | { ok: false; problems: string[] };

/** Builds envelope_sign's arguments, or says in plain words what is missing. `parse` is the
 *  approval window's money parser (minor units or null). */
export function buildLimits(d: LimitsDraft, currency: Currency, now: number, parse: (s: string, c: Currency) => number | null): LimitsBuilt {
  const problems: string[] = [];
  const money = (s: string, what: string) => {
    const minor = s.trim() ? parse(s, currency) : null;
    if (minor === null || minor <= 0) problems.push(`${what}: enter an amount above zero in ${currency}`);
    return minor ?? 0;
  };
  const out = money(d.out, LIMIT_WORDS.out.name);
  const held = money(d.held, LIMIT_WORDS.held.name);
  const deals = /^\d+$/.test(d.deals.trim()) ? Number(d.deals.trim()) : NaN;
  if (!Number.isInteger(deals) || deals < 1 || deals > 65535) problems.push(`${LIMIT_WORDS.deals.name}: enter a whole number from 1`);
  if (!(d.days >= 1)) problems.push('Choose how long the limits last');
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    args: {
      currency,
      max_out_day: { minor: out, currency },
      max_held: { minor: held, currency },
      max_deals_day: deals,
      expires: now + Math.trunc(d.days) * 86_400,
    },
  };
}

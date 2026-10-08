import type { Currency } from '@bindings/Currency';
import type { Money } from '@bindings/Money';
import type { H256 } from '@bindings/H256';
import { clockNow } from './clock';

/** Minor-unit exponents, matching the Rust Currency table. Money never touches floats in Rust;
 *  the client only formats it for display. */
const EXPONENT: Record<Currency, number> = {
  USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, CHF: 2, NZD: 2, CZK: 2, SEK: 2, NOK: 2, DKK: 2, PLN: 2,
  JPY: 0, HUF: 2, KWD: 3, BHD: 3,
};
const SYMBOL: Partial<Record<Currency, string>> = { USD: '$', EUR: '€', GBP: '£' };

/** "$" for currencies with a familiar symbol, else the ISO code ("CHF"). */
export function currencyMark(c: Currency): string {
  return SYMBOL[c] ?? c;
}

export function exponent(c: Currency): number {
  return EXPONENT[c];
}

/** "$329.00" - exact string arithmetic on the integer, no float rounding. */
export function formatMinor(minor: number, currency: Currency, opts: { code?: boolean } = {}): string {
  const exp = EXPONENT[currency];
  const neg = minor < 0;
  const digits = Math.abs(Math.trunc(minor)).toString().padStart(exp + 1, '0');
  const whole = exp ? digits.slice(0, -exp) : digits;
  const frac = exp ? digits.slice(-exp) : '';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = frac ? `${grouped}.${frac}` : grouped;
  const sym = SYMBOL[currency];
  const text = sym && !opts.code ? `${sym}${body}` : `${body} ${currency}`;
  return neg ? `−${text}` : text;
}

export function formatMoney(m: Money | null | undefined, opts?: { code?: boolean }): string {
  return m ? formatMinor(m.minor, m.currency, opts) : '—';
}

/** Total of a unit price times quantity, still in minor units. */
export function lineTotal(unit: Money, qty: number): Money {
  return { minor: unit.minor * qty, currency: unit.currency };
}

/** Short, stable display for a ULID or key id: "01JD…7Q". */
export function shortId(id: string, head = 4, tail = 2): string {
  // slice(-0) is the whole string, so a zero tail must be guarded.
  return id.length <= head + tail + 1 ? id : `${id.slice(0, head)}…${tail > 0 ? id.slice(-tail) : ''}`;
}

/** A key id in groups of four characters ("5e3a 91c0 …"), so a person can read it out and
 *  compare it group by group. Every character is kept: the full id is the anchor. */
export function keyGroups(id: string): string[] {
  return id.match(/.{1,4}/g) ?? [];
}

/** A proof file's owner key against this wallet's own: 'mine', 'other', or null while this
 *  wallet's key is not known. Compared in full, case-insensitively (both are hex). */
export function keyMatch(fileKey: string, ownKey: string | null | undefined): 'mine' | 'other' | null {
  if (!ownKey) return null;
  return fileKey.toLowerCase() === ownKey.toLowerCase() ? 'mine' : 'other';
}

/** Hex prefix of a 32-byte digest: "7c1e…94". */
export function shortHash(h: H256 | null | undefined): string {
  if (!h) return '—';
  const hex = h.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 4)}…${hex.slice(-2)}`;
}

/** Remaining time as a ticking clock "3:57:56" under a day; over a day it reads as words, the
 *  way UX-GUIDE spells time in sentences: "2 days 19 h", "1 day 3 h", "3 days" (no "0 h").
 *  Negative → "0:00:00". */
export function countdown(deadline: number, now: number): string {
  let s = Math.max(0, Math.floor(deadline - now));
  if (s >= 86400) {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    return `${d} ${d === 1 ? 'day' : 'days'}${h ? ` ${h} h` : ''}`;
  }
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** "Thu 18:00" in local time from Unix seconds, within six days of `now`; further away a weekday
 *  would read as this week, so it says the date: "3 Nov 18:00". */
export function clockLabel(unix: number, now: number = nowUnix()): string {
  const d = new Date(unix * 1000);
  const near = Math.abs(unix - now) < 6 * 86400;
  const day = near ? d.toLocaleDateString('en-US', { weekday: 'short' }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day} ${t}`;
}

/** Unix seconds from the one client clock (wall time in the shell; see lib/clock.ts). */
export function nowUnix(): number {
  return clockNow();
}

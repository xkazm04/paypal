import type { Currency } from '@bindings/Currency';
import type { Money } from '@bindings/Money';
import type { H256 } from '@bindings/H256';

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

/** Hex prefix of a 32-byte digest: "7c1e…94". */
export function shortHash(h: H256 | null | undefined): string {
  if (!h) return '—';
  const hex = h.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 4)}…${hex.slice(-2)}`;
}

/** Remaining time as "3:57:56" (or "2 d 19 h" when over a day). Negative → "0:00:00". */
export function countdown(deadline: number, now: number): string {
  let s = Math.max(0, Math.floor(deadline - now));
  if (s >= 86400) {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    return `${d} d ${h} h`;
  }
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** "Thu 18:00" in local time from Unix seconds. */
export function clockLabel(unix: number): string {
  const d = new Date(unix * 1000);
  const day = d.toLocaleDateString('en-US', { weekday: 'short' });
  const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day} ${t}`;
}

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

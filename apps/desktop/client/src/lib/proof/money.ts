// Money as a proof file writes it: integer minor units and a currency. Never a float; the checker only
// reads, compares and prints it.
import { oneOf, rec, whole } from './read';

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'NZD', 'CZK', 'SEK', 'NOK', 'DKK', 'PLN', 'JPY', 'HUF', 'KWD', 'BHD'] as const;
const EXPONENT: Record<string, number> = { JPY: 0, KWD: 3, BHD: 3 };
export const exponentOf = (currency: string): number => EXPONENT[currency] ?? 2;
export interface Money {
  minor: number;
  currency: string;
}
export function readMoney(value: unknown): Money {
  const r = rec(value, ['minor', 'currency']);
  return { minor: whole(r.minor, 0), currency: oneOf(r.currency, CURRENCIES) };
}
/** "212.00": the amount the way PayPal writes it, from integer minor units (no floats). */
export function decimal(m: Money): string {
  const exp = exponentOf(m.currency);
  if (exp === 0) return String(m.minor);
  const scale = 10 ** exp;
  return `${Math.floor(m.minor / scale)}.${String(m.minor % scale).padStart(exp, '0')}`;
}
/** "212.00 USD", as the verifier's own lines write an amount. */
export const showMoney = (m: Money): string => `${decimal(m)} ${m.currency}`;
export const sameMoney = (a: Money, b: Money): boolean => a.minor === b.minor && a.currency === b.currency;

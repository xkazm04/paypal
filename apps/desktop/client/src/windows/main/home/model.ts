// Pure helpers the console shares from the old Dial home: the one-line default on silence, state chip
// tones, the week label, money lists and what is on hold at PayPal. No React, no IO.
import type { Deal } from '@bindings/Deal';
import type { Money } from '@bindings/Money';
import { formatMoney } from '../../../lib/format';
import { timeLeftWords } from '../../../lib/words';
import type { ChipTone } from '../../../shared/ui';
import { dealTotal, sumByCurrency, type ChipClass } from '../logic';

/** "the offer lapses at 18:00 · no money moves" -> head "the offer lapses at 18:00", rest "no money moves". */
export function silenceParts(text: string): { head: string; rest: string | null } {
  const i = text.indexOf(' · ');
  return i < 0 ? { head: text, rest: null } : { head: text.slice(0, i), rest: text.slice(i + 3) };
}

const TONE: Record<ChipClass, ChipTone> = { live: 'teal', wait: 'gold', held: 'gold', done: 'ok', bad: 'red', off: 'line' };
/** The v2 chip tone for a deal's state class (text + colour, never colour alone). */
export const chipTone = (c: ChipClass): ChipTone => TONE[c];

const dayMonth = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
/** "5 Oct – 11 Oct" for a [start, end) week in Unix seconds (local time). */
export const weekLabel = (start: number, end: number): string => `${dayMonth(start)} – ${dayMonth(end - 1)}`;

/** Amounts per currency, never summed across currencies; zero shows as $0.00. */
export const moneyList = (ms: readonly Money[]): string =>
  ms.length ? ms.map((m) => formatMoney(m)).join(' + ') : formatMoney({ minor: 0, currency: 'USD' });

/** How long a decision can wait, in words ("2 h 14 min left"); null when it has no clock.
 *  The default on silence stays on its own line; this is only the time. */
export function timeLeft(deadline: number | null, now: number): { text: string; urgent: boolean } | null {
  if (deadline === null) return null;
  const left = deadline - now;
  if (left <= 0) return { text: 'time is up', urgent: true };
  return { text: `${timeLeftWords(left)} left`, urgent: left <= 15 * 60 };
}

/** Drops the noise a one-line row cannot afford ("Refurbished ", a trailing "(…)"). */
export const shortTitle = (t: string): string => t.replace(/^Refurbished /, '').replace(/ \(.*\)$/, '');

/** What is on hold at PayPal (AUTHORIZED), per direction and currency: the same figures as Book's
 *  "On hold" tile. Money going out and coming in are never added together, and a payment a scam
 *  check paused is not on hold at PayPal (nothing was sent): it shows under Needs you instead. A
 *  payment being checked with PayPal (`checking` holds its deal ids) is not counted as on hold
 *  either: it shows under Needs you with the check's words. */
export function heldAtPayPal(held: readonly Deal[], checking: ReadonlySet<string> = new Set()): { deals: Deal[]; out: Money[]; inn: Money[] } {
  const deals = held.filter((d) => d.state === 'AUTHORIZED' && !checking.has(d.id));
  return {
    deals,
    out: sumByCurrency(deals.filter((d) => d.side === 'buyer').map(dealTotal)),
    inn: sumByCurrency(deals.filter((d) => d.side === 'seller').map(dealTotal)),
  };
}
/** "$64.00 out · $118.00 in", "$64.00 out", "nothing": what is on hold, each direction named. */
export function heldLine(h: { out: Money[]; inn: Money[] }): string {
  const parts = [h.out.length ? `${moneyList(h.out)} out` : '', h.inn.length ? `${moneyList(h.inn)} in` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'nothing';
}

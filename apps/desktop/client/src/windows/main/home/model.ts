// Pure helpers for the Dial home (Home.tsx): the one-line default on silence, state chip tones,
// the week label and the ledger's Layer-2 lists. No React, no IO.
import type { Deal } from '@bindings/Deal';
import type { Money } from '@bindings/Money';
import { formatMoney } from '../../../lib/format';
import { timeLeftWords } from '../../../lib/words';
import type { ChipTone } from '../../../shared/ui';
import { dealTotal, stateLabel, type ChipClass, type LedgerSummary } from '../logic';

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

export type LedgerKind = 'held' | 'moving' | 'stopped';
export const LEDGER_TITLE: Record<LedgerKind, string> = {
  held: 'On hold · not paid',
  moving: 'In progress · nothing for you to decide',
  stopped: 'Stopped before any money moved',
};

/** "1 deal", "3 deals", "none": a count as Maya would say it. */
export const dealCount = (n: number): string => (n === 0 ? 'none' : `${n} ${n === 1 ? 'deal' : 'deals'}`);

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

/** The deals behind one ledger row. */
export const ledgerDeals = (kind: LedgerKind, s: LedgerSummary): Deal[] => s[kind];

/** One line for a deal in a ledger list: what it is and why it sits there. */
export function ledgerLine(kind: LedgerKind, d: Deal, title: string): string {
  if (kind === 'held') return `${formatMoney(dealTotal(d))} · ${d.state === 'AUTHORIZED' ? 'on hold at PayPal' : 'paused by a scam check'}`;
  if (kind === 'stopped') return `${(d.shield === 'BLOCK' ? 'blocked' : stateLabel(d.state, d)).toLowerCase()} · ${shortTitle(title)}`;
  return `${stateLabel(d.state, d).toLowerCase()} · ${shortTitle(title)}`;
}

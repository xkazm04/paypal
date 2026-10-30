// The right of "now" on the Rewind: the walk-away forecast as ticks, one tick per forecast line (the
// timeline never merges, drops or invents one, so a test can pin them one to one), and the headline over
// the whole timeline, which counts only what the forecast states. Pure: no React, no IPC. The forecast
// itself is Rust's (AttentionSnapshot.forecast, crates/table-attention forecast.rs; the browser mock
// mirrors it); nothing here decides what happens, it only draws what Rust says silence does.
import type { Currency } from '@bindings/Currency';
import type { ForecastLine } from '@bindings/ForecastLine';
import { formatMinor } from '../../../../../lib/format';
import type { Reach } from '../../../../../lib/say/draft';
import { REWIND_AHEAD } from '../../../../../lib/words';
import { plainMoney, walkAway, walkHeadline } from '../../../../tumbler/logic';

export { plainMoney };

/** The forecast's reach (crates/table-runtime FORECAST_HORIZON_SECS; windows/tumbler/walkaway.test.ts pins it). */
export const HORIZON_SECS = 72 * 3600;

/** Who acts at a step, as the legend colours it: safe default, a rule of yours, a buyer who already approved, or a maybe. */
export type FutureTone = 'default' | 'rule' | 'buyer' | 'maybe';
export type FutureTick = {
  key: string;
  /** Where it sits on the timeline, Unix seconds. */
  at: number;
  line: ForecastLine;
  tone: FutureTone;
  /** Depends on a buyer approving on PayPal: drawn hollow and only promised as "if". */
  conditional: boolean;
  /** The line has no time of its own ("the next time The Table checks", or a buyer's approval with no deadline). */
  untimed: boolean;
};

const toneOf = (l: ForecastLine): FutureTone =>
  l.trigger === 'buyer_approves' ? 'maybe' : l.authority === 'safe_default' ? 'default' : l.authority === 'seller_mandate' ? 'buyer' : 'rule';

/** One tick per forecast line, in time order. null = the forecast could not be read: nothing is drawn and nothing is promised. */
export function futureTicks(forecast: readonly ForecastLine[] | null | undefined, now: number): FutureTick[] | null {
  if (!forecast) return null;
  return forecast
    .map((line, i): FutureTick => {
      const at = line.trigger === 'deadline' && line.at !== null ? line.at
        : line.trigger === 'buyer_approves' ? (line.before ?? line.at ?? now + HORIZON_SECS)
          : now;
      const untimed = line.trigger === 'next_tick' || (line.trigger === 'buyer_approves' && line.before === null && line.at === null);
      return { key: `${line.deal_id}:${line.action}:${line.trigger}:${i}`, at: Math.min(Math.max(at, now), now + HORIZON_SECS), line, tone: toneOf(line), conditional: line.trigger === 'buyer_approves', untimed };
    })
    .sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}

/** A step ahead in the owner's words. `title` is the deal's short title (never the counterparty's own text). */
export function futureSaid(l: ForecastLine, title: string): string {
  const amt = formatMinor(l.amount_minor, l.currency);
  const s = REWIND_AHEAD.said;
  switch (l.action) {
    case 'lapse': return s.lapse(title);
    case 'expire': return s.expire(title);
    case 'auto_void': return s.auto_void(title, amt);
    case 'unconfirm': return s.unconfirm(title);
    case 'create_order': return s.create_order(title);
    case 'authorize': return s.authorize(title, amt);
    case 'capture': return s.capture(title, amt);
  }
}

export type Headline = {
  /** "If you walk away" */
  lead: string;
  /** "$0 leaves. 2 holds end on their own." (or why it cannot be said) */
  rest: string;
  /** The forecast could not be read: shown dashed, never as zero. */
  known: boolean;
  /** The money out, per currency, as the Tumbler words it ("$0.00"); null when it cannot be said. */
  out: string | null;
  holds: number;
};

/** The headline over the whole timeline. The Tumbler builds its own from the same walkAway(), so they agree. */
export function headlineOf(forecast: ForecastLine[] | null | undefined, walletCurrency: Currency | null = 'USD'): Headline {
  const lead = REWIND_AHEAD.walkAway;
  const w = walkAway({ forecast, wallet_spend_today_currency: walletCurrency });
  if (!w.known) return { lead, rest: REWIND_AHEAD.unknown, known: false, out: null, holds: 0 };
  const h = walkHeadline(w, forecast?.length ?? 0);
  return { lead, rest: h.sentences.join(' '), known: true, out: w.out, holds: w.releases };
}

/** What the rules the owner said would allow, as one sentence for under the headline. */
export function ruleLine(reach: Reach, until: string): string {
  const per = reach.perDay !== null ? ` ${REWIND_AHEAD.rule.perDay(plainMoney(formatMinor(reach.perDay, reach.currency)))}` : '';
  return reach.alone === 0
    ? REWIND_AHEAD.rule.asks(until)
    : `${REWIND_AHEAD.rule.alone(plainMoney(formatMinor(reach.alone, reach.currency)), until)}${per}`;
}

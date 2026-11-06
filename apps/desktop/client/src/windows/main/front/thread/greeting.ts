// The opening message, composed locally (no model, no latency, no invented figures): one status
// sentence from the standing answers, the away summary in ONE line (the rest one chip away), the ONE
// first need, and at most two suggested replies the scripted engine (or a local answer) handles well.
// Budget (round 2): status, away line, need card, two chips, ask box = 6 items on first paint.
// Pure: no React, no IO.
import type { BoardKey, BoardModel } from '../../switchboard/useBoardModel';
import type { StandingAnswer } from '../../switchboard/standing';
import type { AwaySummary } from '../../home/away';
import { GREET } from './words';

/** A suggested reply: a question for the assistant, or a local move. */
export type Chip =
  | { kind: 'ask'; label: string }
  | { kind: 'away'; label: string }
  | { kind: 'everything'; label: string }
  | { kind: 'steps'; label: string };

export type Greeting = {
  mode: 'setup' | 'everyday' | 'reading';
  /** The status sentence, plain words. */
  status: string;
  /** One quiet line under it, or null. */
  sub: string | null;
  tone: 'ok' | 'gold' | 'refuse' | 'dim';
  /** Up to two away lines and how many more there are; null when there is no away news. */
  away: { since: string; lines: string[]; more: number } | null;
  /** The first need (soonest deadline first), or null. */
  need: BoardKey | null;
  needs: number;
  chips: Chip[];
};

export type DayPart = 'morning' | 'afternoon' | 'evening' | null;

/** The local part of the day, or null in the small hours (no "good morning" at 2 a.m.). */
export function partOfDay(nowMs: number): DayPart {
  const h = new Date(nowMs).getHours();
  return h < 5 ? null : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

/** Needs-you keys, soonest deadline first, none last, then id. */
export function needsFirst(model: Pick<BoardModel, 'keys'>): BoardKey[] {
  return model.keys.filter((k) => k.fate === 'needs').sort((a, b) => (a.deadline_s ?? Infinity) - (b.deadline_s ?? Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export const AWAY_SHOWN = 1;
export const CHIPS_SHOWN = 2;

export function compose(o: {
  model: Pick<BoardModel, 'ready' | 'firstRun' | 'keys' | 'instruments'>;
  standing: readonly [StandingAnswer, StandingAnswer, StandingAnswer];
  away: AwaySummary | null;
  setup: boolean;
  /** The part of the day the caller's ticking clock reads (useDayPart), so the hello follows it. */
  part: DayPart;
}): Greeting {
  const { model, standing, away, setup } = o;
  if (setup) {
    return {
      mode: 'setup', status: GREET.welcome, sub: GREET.welcomeSub, tone: 'gold', away: null, need: null, needs: 0,
      chips: [{ kind: 'ask', label: GREET.chipAllowed }, { kind: 'steps', label: GREET.chipSteps }],
    };
  }
  if (!model.ready) return { mode: 'reading', status: GREET.reading, sub: null, tone: 'dim', away: null, need: null, needs: 0, chips: [] };

  const [safe] = standing;
  const list = needsFirst(model);
  const n = list.length;
  const safePart = safe.tone === 'ok' ? GREET.safe : safe.tone === 'refuse' ? GREET.broken : GREET.safeUnknown;
  const needsPart = n === 0 ? GREET.needsNone : n === 1 ? GREET.needsOne : GREET.needsSome(n);
  const status = [GREET.hello(o.part), safePart, needsPart].filter(Boolean).join(' ');
  const tone = safe.tone === 'refuse' ? 'refuse' : n ? 'gold' : safe.tone === 'ok' ? 'ok' : 'dim';

  const awayOut = away
    ? (away.quiet || away.lines.length === 0
      ? { since: away.sinceWords, lines: [away.lead ?? GREET.awayAnswerQuiet], more: 0 }
      : { since: away.sinceWords, lines: away.lines.slice(0, AWAY_SHOWN).map((l) => l.text), more: Math.max(0, away.lines.length - AWAY_SHOWN) })
    : null;

  const chips: Chip[] = [];
  if (awayOut && awayOut.more > 0) chips.push({ kind: 'away', label: GREET.chipAway });
  if (n) chips.push({ kind: 'ask', label: GREET.chipSilence });
  chips.push({ kind: 'everything', label: GREET.chipEverything });
  return { mode: 'everyday', status, sub: n === 0 ? GREET.needsNoneSub : null, tone, away: awayOut, need: list[0] ?? null, needs: n, chips: chips.slice(0, CHIPS_SHOWN) };
}

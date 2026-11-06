// The opening message, composed locally (no model, no latency, no invented figures): one status
// sentence from the standing answers, the away summary in at most two lines, the ONE first need,
// and two or three suggested replies the scripted engine (or a local answer) handles well.
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
  /** The away news: ONE line on first paint (the budget), the rest behind "n more"; null when none. */
  away: { since: string; lines: string[]; more: number; all: string[] } | null;
  /** The first need (soonest deadline first), or null. */
  need: BoardKey | null;
  needs: number;
  chips: Chip[];
};

export type PartOfDay = 'morning' | 'afternoon' | 'evening' | null;

/** The salutation follows the wallet's clock in local time; deep night (23:00-04:59) gets none. */
export function partOfDay(nowMs: number): PartOfDay {
  const h = new Date(nowMs).getHours();
  return h < 5 || h >= 23 ? null : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

/** Needs-you keys, soonest deadline first, none last, then id. */
export function needsFirst(model: Pick<BoardModel, 'keys'>): BoardKey[] {
  return model.keys.filter((k) => k.fate === 'needs').sort((a, b) => (a.deadline_s ?? Infinity) - (b.deadline_s ?? Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export const AWAY_SHOWN = 1;

export function compose(o: {
  model: Pick<BoardModel, 'ready' | 'firstRun' | 'keys' | 'instruments'>;
  standing: readonly [StandingAnswer, StandingAnswer, StandingAnswer];
  away: AwaySummary | null;
  setup: boolean;
  part: PartOfDay;
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
  const status = `${o.part ? `${GREET.hello(o.part)} ` : ''}${safePart} ${needsPart}`;
  const tone = safe.tone === 'refuse' ? 'refuse' : n ? 'gold' : safe.tone === 'ok' ? 'ok' : 'dim';

  const awayOut = away
    ? (away.quiet || away.lines.length === 0
      ? { since: away.sinceWords, lines: [away.lead ?? GREET.awayAnswerQuiet], more: 0, all: [] }
      : { since: away.sinceWords, lines: away.lines.slice(0, AWAY_SHOWN).map((l) => l.text), more: Math.max(0, away.lines.length - AWAY_SHOWN), all: away.lines.map((l) => l.text) })
    : null;

  const chips: Chip[] = [];
  if (n) chips.push({ kind: 'ask', label: GREET.chipSilence });
  chips.push({ kind: 'everything', label: GREET.chipEverything });
  return { mode: 'everyday', status, sub: n === 0 ? GREET.needsNoneSub : null, tone, away: awayOut, need: list[0] ?? null, needs: n, chips: chips.slice(0, 2) };
}

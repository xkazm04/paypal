// The opening message, composed locally (no model, no latency, no invented figures): one status
// sentence from the standing answers, the away summary as ONE line (its first group, and how many
// more), the ONE first need, and two suggested replies the scripted engine (or a local answer)
// handles well. FOCUS round 2: the greeting word follows the clock (none at night), and the away
// news is one item so the first paint stays inside the 7-item budget.
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
  /** The away news as one line and how many more groups there are; null when there is no away news. */
  away: { since: string; line: string; more: number } | null;
  /** The first need (soonest deadline first), or null. */
  need: BoardKey | null;
  needs: number;
  chips: Chip[];
};

export type PartOfDay = 'morning' | 'afternoon' | 'evening';

/** The greeting word for the viewer's local hour: morning 05-11, afternoon 12-17, evening 18-22, and
 *  none in the small hours (a "good morning" at 02:00 reads as a bug, not a welcome). */
export function partOfDay(nowMs: number): PartOfDay | null {
  const h = new Date(nowMs).getHours();
  return h < 5 ? null : h < 12 ? 'morning' : h < 18 ? 'afternoon' : h < 23 ? 'evening' : null;
}

/** Needs-you keys, soonest deadline first, none last, then id. */
export function needsFirst(model: Pick<BoardModel, 'keys'>): BoardKey[] {
  return model.keys.filter((k) => k.fate === 'needs').sort((a, b) => (a.deadline_s ?? Infinity) - (b.deadline_s ?? Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}


export function compose(o: {
  model: Pick<BoardModel, 'ready' | 'firstRun' | 'keys' | 'instruments'>;
  standing: readonly [StandingAnswer, StandingAnswer, StandingAnswer];
  away: AwaySummary | null;
  setup: boolean;
  nowMs: number;
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
  const part = partOfDay(o.nowMs);
  const status = [part ? GREET.hello(part) : null, safePart, needsPart].filter(Boolean).join(' ');
  const tone = safe.tone === 'refuse' ? 'refuse' : n ? 'gold' : safe.tone === 'ok' ? 'ok' : 'dim';

  const awayOut = away
    ? (away.quiet || away.lines.length === 0
      ? { since: away.sinceWords, line: away.lead ?? GREET.awayAnswerQuiet, more: 0 }
      : { since: away.sinceWords, line: (away.lines[0] as { text: string }).text, more: away.lines.length - 1 })
    : null;

  // The rest of the away news is the line's own "and n more" link, not a third chip.
  const chips: Chip[] = [];
  if (n) chips.push({ kind: 'ask', label: GREET.chipSilence });
  chips.push({ kind: 'everything', label: GREET.chipEverything });
  return { mode: 'everyday', status, sub: n === 0 ? GREET.needsNoneSub : null, tone, away: awayOut, need: list[0] ?? null, needs: n, chips: chips.slice(0, 2) };
}

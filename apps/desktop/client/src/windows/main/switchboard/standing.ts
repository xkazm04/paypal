// The three standing questions, always answered (spark the-proof-table, WP0 contract; WP2 implements):
// Is my money safe right now? Does anything need me? What happens if I do nothing? (docs/ux/UX-GUIDE.md)
// Derived only from what the board model already reads: the safety record (instruments.records),
// the needs column (colCount.needs, its cells' soonest_s) and the needs keys' on_silence. A source
// that is null gives tone 'dim' and the "not available yet" words; never 0, never green.
// Pure: no React, no IO. Words come from lib/words/board.ts (BOARD_STANDING).
import type { Tone } from './lit';
import type { BoardModel } from './useBoardModel';

export type StandingKey = 'safe' | 'needs' | 'nothing';

export type StandingAnswer = {
  readonly key: StandingKey;
  readonly tone: Tone | 'dim';
  /** The short answer ("Safe", "6 need you", "Nothing moves by itself"). */
  readonly headline: string;
  /** One line under it ("158 entries checked · nothing broke your rules"), or null. */
  readonly detail: string | null;
};

/** Safe, needs, nothing, in that order. WP2. */
export function standingAnswers(_model: BoardModel): readonly [StandingAnswer, StandingAnswer, StandingAnswer] {
  const dim = (key: StandingKey): StandingAnswer => ({ key, tone: 'dim', headline: '', detail: null });
  return [dim('safe'), dim('needs'), dim('nothing')];
}

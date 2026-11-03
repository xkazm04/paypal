// The figures in the board's sentence (spark the-proof-table, WP0 contract; WP2 implements).
// A reply is plain text (lib/assistant/contract.ts `say`). A figure in it becomes a key only when it
// EQUALS the board's data: a deal label that exists, an amount equal to that deal's or a money fact,
// a count equal to the column or row it names, an area name. Anything else stays plain text, so a live
// model's wording links less, never wrongly. Each figure carries what it lights (a LitSet) and a line
// saying what it is. Figure refs on the wire wait for the assistant contract (pinned to 2026-11-12).
// Pure: no React, no IO. Words come from lib/words/board.ts (BOARD_FIGURE).
import type { LitSet, Tone } from './lit';
import type { BoardModel } from './useBoardModel';

export type Figure = {
  /** UTF-16 offsets into the sentence, start inclusive, end exclusive. */
  readonly start: number;
  readonly end: number;
  /** The sentence's own text for the figure (say.slice(start, end)). */
  readonly text: string;
  readonly tone: Tone;
  /** What the figure is, in plain words ("6 deals need you: Tables 2, Spend 1, ..."). */
  readonly what: string;
  readonly lit: LitSet;
};

/** Non-overlapping figures, ascending by start. WP2. */
export function findFigures(_say: string, _model: BoardModel): Figure[] {
  return [];
}

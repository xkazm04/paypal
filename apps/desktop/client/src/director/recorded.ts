// BROWSER PREVIEW ONLY. The haggle figures the director's captions and its rehearsal name, read from
// the engine's recording (mock/haggle.json through mock/haggle.ts, written and checked by the Rust
// recorder). A caption can never name a price the wallet's practice agent would not sign: change the
// engine and the recorder's test fails until the file, the sample tables and these lines agree again.
// Dollars, as the captions and `usdText` take them.
import { pricesOf, RECORDED, signedSteps } from '../mock/haggle';

const dollars = (minor: number): number => minor / 100;
const dan = pricesOf(RECORDED.dan);
/** The house seller's table as the story opens (mock fixture D-0204): its run, three offers in. */
const houseNow = signedSteps(RECORDED.house, 6).filter((s) => s.by === 'seller');
const at = (xs: readonly number[], i: number): number => {
  const v = i < 0 ? xs[xs.length + i] : xs[i];
  if (v === undefined) throw new Error('haggle.json: the director needs a step the recording does not have');
  return v;
};

export const HAGGLE_FIGS = {
  /** Dan's list price. */
  danAsks: dollars(at(dan.seller, 0)),
  /** Dan's last counter: the price the agent would take and the wallet stops for Maya. */
  danLast: dollars(RECORDED.dan.outcome.price),
  /** Her agent's first offer, its third (the trade beat, MIDWAY) and its last (HER_LAST). */
  herFirst: dollars(at(dan.agent, 0)),
  herMid: dollars(at(dan.agent, 2)),
  herLast: dollars(at(dan.agent, -1)),
  /** The house seller's latest counter as the story opens. */
  houseNow: dollars(at(houseNow.map((s) => s.price), -1)),
} as const;

/** "$340" as the captions write a whole-dollar price. */
export const capUsd = (v: number): string => (Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`);

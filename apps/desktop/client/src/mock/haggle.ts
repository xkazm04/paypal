// The recorded haggle. `haggle.json` is written by the Rust recorder
// (crates/table-runtime/src/haggle_record_tests.rs): the shipped practice agent plays a monitor table
// against the house seller's own concession rule, through the wallet's MCP door and mandate check,
// and that test fails when the file and the engine drift apart. The browser preview's house table
// D-0205 is built from it here, so every price the corridor draws is one the engine signed. Nothing
// in this file types a price.
import recording from './haggle.json';

export type RecordedBy = 'seller' | 'agent' | 'owner';
export type RecordedAct = 'listing' | 'offer' | 'counter' | 'accept' | 'withdraw' | 'refused';
/** One step, in the order it happened. `refused` is an agent intent the wallet refused: nothing was sent. */
export type RecordedStep = { by: RecordedBy; act: RecordedAct; price: number; clause?: number };
/** Every amount in minor units of `currency`. */
export type RecordedHaggle = {
  currency: 'USD';
  item: string;
  rules: { ceiling: number; floor: number | null; max_offers: number; ask_above: number };
  market: { p25: number; median: number; p75: number };
  seller: { who: 'house'; ask: number; floor: number; rounds: number };
  steps: RecordedStep[];
  outcome: { state: 'AGREED'; price: number; decided_by: 'owner'; paypal_calls: number };
};

const BY: ReadonlySet<string> = new Set<RecordedBy>(['seller', 'agent', 'owner']);
const ACT: ReadonlySet<string> = new Set<RecordedAct>(['listing', 'offer', 'counter', 'accept', 'withdraw', 'refused']);
const minor = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** The file, checked: a shape this file does not know is an error, never a guess. */
export function parseRecording(raw: unknown): RecordedHaggle {
  const r = raw as RecordedHaggle;
  const ok =
    r?.currency === 'USD' &&
    typeof r.item === 'string' &&
    minor(r.rules?.ceiling) && (r.rules.floor === null || minor(r.rules.floor)) && minor(r.rules.max_offers) && minor(r.rules.ask_above) &&
    minor(r.market?.p25) && minor(r.market.median) && minor(r.market.p75) &&
    minor(r.seller?.ask) && minor(r.seller.floor) && minor(r.seller.rounds) &&
    Array.isArray(r.steps) && r.steps.length > 0 &&
    r.steps.every((s) => BY.has(s?.by) && ACT.has(s.act) && minor(s.price) && (s.clause === undefined || minor(s.clause))) &&
    r.outcome?.state === 'AGREED' && minor(r.outcome.price);
  if (!ok) throw new Error('haggle.json: not a recording this preview can read');
  return r;
}

export const RECORDED_HAGGLE: RecordedHaggle = parseRecording(recording);

/** When each step happened, on a table the house listed at `start` (Unix seconds): the two agents
 *  answer within minutes, the refusal is the agent's own turn, and Maya's decision comes once the
 *  wallet has put it in front of her. */
export function recordedTimes(rec: RecordedHaggle, start: number): number[] {
  let t = start;
  return rec.steps.map((s, i) => {
    if (i > 0) t += s.act === 'refused' ? 2 : s.by === 'owner' ? 11 * 60 : s.by === 'seller' && s.act === 'accept' ? 20 : 3 * 60;
    return t;
  });
}

/** The house table's label in the browser preview. */
export const RECORDED_LABEL = 'D-0205';
/** It listed yesterday afternoon, so its agreement is never counted in today's limits (usage_for keys on the agreement day). */
export const RECORDED_AGO = 26 * 3600 + 40 * 60;

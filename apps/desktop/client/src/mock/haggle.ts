// The recorded haggles. `haggle.json` is written by the Rust recorder
// (crates/table-runtime/src/haggle_record_tests.rs): the shipped practice agent plays the demo's
// monitor tables through the wallet's MCP door and mandate check, and that test fails when the file
// and the engine drift apart. Two tables, one set of rules and one market:
// - `house`: against the house seller's own rule, to the wallet's refusal of the agent's yes, Maya's
//   own accept and the agreement. The preview's D-0205 is this run; the shop-around table D-0204 is
//   its opening (the house's rule is deterministic, so a table midway shows exactly these prices).
// - `dan`: against Dan's given counters, up to the refusal that waits for Maya: the preview's D-0193.
//   The arena's recorder (crates/table-app/tests/gauntlet/arena.rs) replays this very table, on these
//   rules and this market, before every attack, so Break The Table's attacks land on D-0193 too.
// Nothing in this file, the fixtures, the arena or the director's captions types one of these prices.
// The house table's agreed deal, as the wallet exported it, is the proof checker's recorded sample
// lib/proof/sample/d-0205.tableproof.
import recording from './haggle.json';
import { RECORDED_DEAL_LABEL } from '../lib/proof/sampleId';

export type RecordedBy = 'seller' | 'agent' | 'owner';
export type RecordedAct = 'listing' | 'offer' | 'counter' | 'accept' | 'withdraw' | 'refused';
/** One step, in the order it happened. `refused` is an agent intent the wallet refused: nothing was sent. */
export type RecordedStep = { by: RecordedBy; act: RecordedAct; price: number; clause?: number };
export type RecordedOutcome =
  | { state: 'AGREED'; price: number; decided_by: 'owner'; paypal_calls: number }
  | { state: 'NEGOTIATING'; price: number; waiting_for: 'owner'; paypal_calls: number };
/** One table: the rules and market are the recording's, shared by every table. Minor units. */
export type RecordedHaggle = {
  currency: 'USD';
  item: string;
  rules: { ceiling: number; floor: number | null; max_offers: number; ask_above: number; per_deal: number };
  market: { p25: number; median: number; p75: number; comparables: number[] };
  steps: RecordedStep[];
  outcome: RecordedOutcome;
};
export type Recording = { house: RecordedHaggle; dan: RecordedHaggle };

const BY: ReadonlySet<string> = new Set<RecordedBy>(['seller', 'agent', 'owner']);
const ACT: ReadonlySet<string> = new Set<RecordedAct>(['listing', 'offer', 'counter', 'accept', 'withdraw', 'refused']);
const minor = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

type Raw = {
  schema?: unknown; currency?: unknown; item?: unknown;
  rules?: RecordedHaggle['rules']; market?: RecordedHaggle['market'];
  tables?: Record<string, { steps?: RecordedStep[]; outcome?: RecordedOutcome }>;
};

/** The file, checked: a shape this file does not know is an error, never a guess. */
export function parseRecording(raw: unknown): Recording {
  const r = raw as Raw;
  const bad = (): never => { throw new Error('haggle.json: not a recording this preview can read'); };
  if (r?.schema !== 2 || r.currency !== 'USD' || typeof r.item !== 'string') bad();
  const item = r.item as string;
  const rules = r.rules;
  const market = r.market;
  if (!rules || !minor(rules.ceiling) || !(rules.floor === null || minor(rules.floor)) || !minor(rules.max_offers) || !minor(rules.ask_above) || !minor(rules.per_deal)) return bad();
  if (!market || !minor(market.p25) || !minor(market.median) || !minor(market.p75) || !Array.isArray(market.comparables) || !market.comparables.every(minor)) return bad();
  const table = (name: string): RecordedHaggle => {
    const t = r.tables?.[name];
    const steps = t?.steps;
    const outcome = t?.outcome;
    if (!Array.isArray(steps) || !steps.length || !steps.every((s) => BY.has(s?.by) && ACT.has(s.act) && minor(s.price) && (s.clause === undefined || minor(s.clause)))) return bad();
    if (!outcome || !(outcome.state === 'AGREED' || outcome.state === 'NEGOTIATING') || !minor(outcome.price)) return bad();
    return { currency: 'USD', item, rules, market, steps, outcome };
  };
  return { house: table('house'), dan: table('dan') };
}

export const RECORDED: Recording = parseRecording(recording);
/** The house table, played to the agreement. */
export const RECORDED_HAGGLE: RecordedHaggle = RECORDED.house;

/** The first `n` signed steps of a table (refusals are not signed messages, so they are skipped). */
export const signedSteps = (rec: RecordedHaggle, n = Infinity): RecordedStep[] => rec.steps.filter((s) => s.act !== 'refused').slice(0, n);
/** Prices by who said them, in order: the seller's (listing first) and the agent's offers. */
export const pricesOf = (rec: RecordedHaggle): { seller: number[]; agent: number[] } => ({
  seller: rec.steps.filter((s) => s.by === 'seller' && (s.act === 'listing' || s.act === 'counter')).map((s) => s.price),
  agent: rec.steps.filter((s) => s.by === 'agent' && s.act === 'offer').map((s) => s.price),
});

/** When each step happened, on a table the seller listed at `start` (Unix seconds): the two agents
 *  answer within minutes, the refusal is the agent's own turn, and Maya's decision comes once the
 *  wallet has put it in front of her. */
export function recordedTimes(rec: RecordedHaggle, start: number): number[] {
  let t = start;
  return rec.steps.map((s, i) => {
    if (i > 0) t += s.act === 'refused' ? 2 : s.by === 'owner' ? 11 * 60 : s.by === 'seller' && s.act === 'accept' ? 20 : 3 * 60;
    return t;
  });
}

/** The house table's label in the browser preview (the deal whose signed file the preview carries). */
export const RECORDED_LABEL = RECORDED_DEAL_LABEL;
/** Dan's table's label in the browser preview, defined here once: the fixtures, the director's haggle
 *  and the arena all name D-0193 through this. */
export const DAN_LABEL = 'D-0193';
/** It listed yesterday afternoon, so its agreement is never counted in today's limits (usage_for keys on the agreement day). */
export const RECORDED_AGO = 26 * 3600 + 40 * 60;

// The three standing questions, always answered (spark the-proof-table, WP0 contract; WP2 implements):
// Is my money safe right now? Does anything need me? What happens if I do nothing? (docs/ux/UX-GUIDE.md)
// Derived only from what the board model already reads: the safety record (instruments.records),
// the needs column (colCount.needs, its cells' soonest_s) and the needs keys' on_silence. A source
// that is null gives tone 'dim' and the "not available yet" words; never 0, never green.
// Pure: no React, no IO. Words come from lib/words/board.ts (BOARD_STANDING).
//
// Decisions (WP2):
// - safe: intact = ok "Safe"; broken = refuse with the safety page's own words; null = dim.
// - needs: counted from colCount.needs (never recomputed); a board that has not read yet (`!ready`) is
//   dim, never "Nothing needs you". The detail names the areas that carry it and the soonest deadline
//   as a clock time ("soonest Fri 23:28"), which does not go stale the way a countdown string would.
// - nothing: each needs key's If-you-do-nothing line is read into one of a few outcomes (silenceOutcome
//   below). Silence never sends money out (the core's forecast guarantees it: crates/table-attention
//   silence.rs), so the only money that can move is money coming IN: a payment the buyer approved that
//   the wallet collects or holds under the owner's rules. Any of those = teal "A payment can come in
//   by itself". A line the board cannot read = dim "Nothing goes out by itself" (it promises only what
//   the core guarantees). Otherwise ok "Nothing moves by itself", the detail saying what does happen:
//   at most two happenings by name, then "and N more" (it is read in two seconds).
// - first run: safe is dim "Not set up yet"; needs is "Not set up yet" with the next setup step unless
//   something already needs her (a practice deal is real and gold); nothing is dim "Nothing moves by
//   itself" (true: no rules, no money) with "Nothing can be paid until setup is done".
import { clockLabel } from '../../../lib/format';
import { MODULE_KEYS } from '../../../lib/assistant';
import { ASSISTANT_MODULE_NAME, ASSISTANT_SETUP_STEP } from '../../../lib/words/assistant';
import { BOARD_STANDING } from '../../../lib/words/board';
import type { BoardKey, BoardModel } from './useBoardModel';

/** The tone a standing answer is drawn in (the board's lit tones, kept for the home's opening). */
export type Tone = 'gold' | 'teal' | 'coral' | 'refuse' | 'ok' | 'market';

export type StandingKey = 'safe' | 'needs' | 'nothing';

export type StandingAnswer = {
  readonly key: StandingKey;
  readonly tone: Tone | 'dim';
  /** The short answer ("Safe", "6 need you", "Nothing moves by itself"). */
  readonly headline: string;
  /** One line under it ("158 entries checked · nothing broke your rules"), or null. */
  readonly detail: string | null;
};

/** What one needs-you key does if she does nothing. `in` = money comes in by itself (the only money
 *  silence can move); `unknown` = the line promises nothing the board can read. */
export type SilenceOutcome = 'in' | 'unknown' | 'release' | 'lapse' | 'retry' | 'check' | 'stays';

/** Read one If-you-do-nothing line. The lines are the core's closed set (crates/table-attention:
 *  lib.rs defaults, silence.rs forecast lines) in raw or plain words (lib/words.ts silenceWords) and the
 *  mock's equivalents. Order matters: money in first, then "could not be checked", then the rest. */
export function silenceOutcome(text: string | null): SilenceOutcome {
  const s = (text ?? '').toLowerCase();
  if (!s.trim()) return 'unknown';
  if (/\bis collected\b|\bput on hold for you\b/.test(s)) return 'in';
  if (/could not be checked/.test(s)) return 'unknown';
  if (/\bpaypal shows decides\b|\balready took stays paid\b/.test(s)) return 'check';
  if (/\bretries\b/.test(s)) return 'retry';
  if (/\breleas|\bauto-voids?\b/.test(s)) return 'release';
  if (/\blapses?\b|\bexpires?\b/.test(s)) return 'lapse';
  if (/\bno money moves\b|\bnothing is (?:paid|taken|sent|charged)\b|\bchanges nothing\b|\bstays as it is\b|\bmoved (?:no money|nothing)\b|\bno capture\b/.test(s)) return 'stays';
  return 'unknown';
}

const HAPPENS_ORDER = ['release', 'lapse', 'retry', 'check'] as const;
/** How many happenings the detail names before it counts the rest (Director, WP2 review). */
const HAPPENS_SHOWN = 2;

const dim = (key: StandingKey, headline: string, detail: string | null = null): StandingAnswer => ({ key, tone: 'dim', headline, detail });

function safeAnswer(model: BoardModel): StandingAnswer {
  if (model.firstRun) return dim('safe', BOARD_STANDING.notSetUp, BOARD_STANDING.setUpFirst);
  const { records, records_count } = model.instruments;
  if (records === 'intact') return { key: 'safe', tone: 'ok', headline: BOARD_STANDING.safe, detail: BOARD_STANDING.safeDetail(records_count) };
  if (records === 'broken') return { key: 'safe', tone: 'refuse', headline: BOARD_STANDING.broken, detail: BOARD_STANDING.brokenDetail };
  return dim('safe', BOARD_STANDING.notYet);
}

function needsAnswer(model: BoardModel): StandingAnswer {
  const n = model.colCount.needs;
  if (model.firstRun && n === 0) {
    const next = model.setup.find((s) => s.done !== true);
    return dim('needs', BOARD_STANDING.notSetUp, next ? BOARD_STANDING.nextStep(ASSISTANT_SETUP_STEP[next.key]) : null);
  }
  if (!model.ready) return dim('needs', BOARD_STANDING.notYet);
  if (n === 0) return { key: 'needs', tone: 'ok', headline: BOARD_STANDING.needsNone, detail: null };
  const cells = MODULE_KEYS.map((m) => model.cells[m].needs).filter((c) => c.count > 0);
  const areas = cells.map((c) => BOARD_STANDING.area(ASSISTANT_MODULE_NAME[c.module], c.count));
  const soonest = cells.reduce<number | null>((s, c) => (c.soonest_s !== null && (s === null || c.soonest_s < s) ? c.soonest_s : s), null);
  const now = Math.floor(model.digest.now_ms / 1000);
  return { key: 'needs', tone: 'gold', headline: BOARD_STANDING.needsSome(n), detail: BOARD_STANDING.needsWhere(areas, soonest === null ? null : clockLabel(soonest, now)) };
}

function nothingAnswer(model: BoardModel): StandingAnswer {
  if (model.firstRun && model.colCount.needs === 0) return dim('nothing', BOARD_STANDING.stays, BOARD_STANDING.setUpFirst);
  if (!model.ready) return dim('nothing', BOARD_STANDING.notYet);
  const needs: BoardKey[] = MODULE_KEYS.flatMap((m) => model.cells[m].needs.keys);
  if (needs.length === 0) return { key: 'nothing', tone: 'ok', headline: BOARD_STANDING.stays, detail: null };
  const by = new Map<SilenceOutcome, BoardKey[]>();
  for (const k of needs) {
    const o = silenceOutcome(k.on_silence);
    by.set(o, [...(by.get(o) ?? []), k]);
  }
  const labels = (o: SilenceOutcome): string[] => (by.get(o) ?? []).map((k) => k.label);
  const comesIn = labels('in');
  if (comesIn.length) return { key: 'nothing', tone: 'teal', headline: BOARD_STANDING.comesIn(comesIn.length), detail: BOARD_STANDING.comesInDetail(comesIn) };
  const unknown = labels('unknown');
  if (unknown.length) return dim('nothing', BOARD_STANDING.goesOutNothing, BOARD_STANDING.unknownDetail(unknown));
  const happens: string[] = HAPPENS_ORDER.filter((o) => by.has(o)).map((o) => BOARD_STANDING.happens[o]);
  if (happens.length === 0) return { key: 'nothing', tone: 'ok', headline: BOARD_STANDING.stays, detail: BOARD_STANDING.staysOnly };
  const all = by.has('stays') ? [...happens, BOARD_STANDING.happens.stays] : happens;
  // A two-second answer: at most two happenings by name, the rest counted.
  const parts = all.length > HAPPENS_SHOWN ? [...all.slice(0, HAPPENS_SHOWN), BOARD_STANDING.happensMore(all.length - HAPPENS_SHOWN)] : all;
  const detail = BOARD_STANDING.happensLine(parts);
  return { key: 'nothing', tone: 'ok', headline: BOARD_STANDING.stays, detail };
}

/** Safe, needs, nothing, in that order. */
export function standingAnswers(model: BoardModel): readonly [StandingAnswer, StandingAnswer, StandingAnswer] {
  return [safeAnswer(model), needsAnswer(model), nothingAnswer(model)];
}

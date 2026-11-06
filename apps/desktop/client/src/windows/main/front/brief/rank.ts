// spark abstract-first-home, variant "brief": which items the morning brief leads with, and in what
// order. Pure: no React, no IO.
//
// THE RANKING RULE (one rule, first difference wins):
//   1. urgency     an item with a deadline outranks one without; the sooner deadline wins.
//                  A deal that needs the owner and has a deadline is this tier. A broken safety
//                  record has no deadline but is treated as "now" (deadline -Infinity): nothing
//                  else on the brief is true until it is looked at.
//   2. money at risk  then, among items without a deadline, the one where money can move or be lost
//                  if she does nothing: a need with no deadline (larger amount first), and the
//                  "if you do nothing" line, but only when silence actually moves something
//                  (a payment comes in by itself, a hold is released, an ask lapses, a renewal
//                  retries, or the line cannot be read). "Nothing moves by itself" is not news and
//                  is not shown at all.
//   3. news        last, what already happened: "while you were away".
// Only the FIRST need gets an item; the others are counted on it ("and 2 more"), so the brief stays at
// one to three items however much is waiting. A getting-started wallet leads with its setup items.
import type { AwaySummary } from '../../home/away';
import { silenceOutcome, type StandingAnswer } from '../../switchboard/standing';
import type { BoardKey, BoardModel } from '../../switchboard/useBoardModel';

export type BriefItem =
  | { kind: 'need'; id: 'need'; key: BoardKey; more: number }
  | { kind: 'risk'; id: 'risk'; answer: StandingAnswer; broken: boolean }
  | { kind: 'away'; id: 'away'; summary: AwaySummary }
  | { kind: 'try'; id: 'try'; done: boolean }
  | { kind: 'real'; id: 'real'; done: boolean };

/** At most this many items on first paint. */
export const BRIEF_MAX = 3;

const TIER = { urgent: 0, risk: 1, news: 2 } as const;
type Ranked = { item: BriefItem; tier: number; deadline: number; amount: number };

/** The needs, most urgent first: deadline (soonest first, none last), then amount (larger first). */
export function needsByUrgency(model: BoardModel): BoardKey[] {
  return model.keys.filter((k) => k.fate === 'needs').sort((a, b) =>
    (a.deadline_s ?? Infinity) - (b.deadline_s ?? Infinity) || (b.amount_minor ?? 0) - (a.amount_minor ?? 0) || a.label.localeCompare(b.label));
}

/** Does doing nothing move or lose anything? (see rule 2) */
export function silenceMatters(model: BoardModel): boolean {
  return model.keys.some((k) => k.fate === 'needs' && ['in', 'release', 'lapse', 'retry', 'unknown'].includes(silenceOutcome(k.on_silence)));
}

export function rankBrief(model: BoardModel, standing: readonly [StandingAnswer, StandingAnswer, StandingAnswer], away: AwaySummary | null, setup: { tryDone: boolean; realDone: boolean } | null): BriefItem[] {
  const out: Ranked[] = [];
  const [safe, , nothing] = standing;
  if (safe.tone === 'refuse') out.push({ item: { kind: 'risk', id: 'risk', answer: safe, broken: true }, tier: TIER.urgent, deadline: -Infinity, amount: 0 });
  const needs = needsByUrgency(model);
  const first = needs[0];
  if (first) {
    out.push({ item: { kind: 'need', id: 'need', key: first, more: needs.length - 1 }, tier: first.deadline_s !== null ? TIER.urgent : TIER.risk, deadline: first.deadline_s ?? Infinity, amount: first.amount_minor ?? 0 });
  }
  if (safe.tone !== 'refuse' && needs.length && silenceMatters(model)) {
    out.push({ item: { kind: 'risk', id: 'risk', answer: nothing, broken: false }, tier: TIER.risk, deadline: Infinity, amount: -1 });
  }
  if (away) out.push({ item: { kind: 'away', id: 'away', summary: away }, tier: TIER.news, deadline: Infinity, amount: 0 });
  out.sort((a, b) => a.tier - b.tier || a.deadline - b.deadline || b.amount - a.amount);
  const ranked = out.map((r) => r.item);
  if (!setup) return ranked.slice(0, BRIEF_MAX);
  // Getting started: try first, sign last. A step left to do leads; a finished one sinks to the end.
  const steps: BriefItem[] = [{ kind: 'try', id: 'try', done: setup.tryDone }, { kind: 'real', id: 'real', done: setup.realDone }];
  const todo = steps.filter((s) => !(s as { done: boolean }).done);
  const done = steps.filter((s) => (s as { done: boolean }).done);
  // A real need (a practice deal waiting on her) still comes first: it has a clock.
  const urgent = ranked.filter((i) => i.kind === 'need' || (i.kind === 'risk' && i.broken));
  return [...urgent, ...todo, ...done, ...ranked.filter((i) => !urgent.includes(i))].slice(0, BRIEF_MAX);
}
